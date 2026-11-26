import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { AccountDb, type AccountTx } from '../../database/scoped-db.js';
import { JournalService } from '../../journal/journal.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { ProjectContext } from '../projects/project-context.js';
import { addDays, todayIn } from './days.js';
import {
  CreateMetricDto,
  MetricResponseDto,
  type MetricSourceDto,
  PointDto,
  UpdateMetricDto,
} from './dto/metric.dto.js';
import { type MetricCollectRequestedEvent, METRICS_EVENTS } from './events/metrics.events.js';
import { MAX_METRICS, MAX_PINNED, METRIC_SOURCES, type MetricSource } from './metrics.constants.js';
import { METRICS_ERRORS, MetricsException } from './metrics.errors.js';
import { type MetricRow, MetricsRepository } from './repositories/metrics.repository.js';

const SOURCE_KEYS: Partial<Record<MetricSource['kind'], string>> = {
  'yookassa.revenue': 'revenue',
  'yookassa.payments': 'payments',
  'metrika.visits': 'visits',
  'metrika.users': 'users',
};

/**
 * Official metrics. Only people change them, and only admins:
 * agents read them through `metrics.read` and have no tool that writes here.
 */
@Injectable()
export class MetricsService {
  constructor(
    private readonly accountDb: AccountDb,
    private readonly metrics: MetricsRepository,
    private readonly journal: JournalService,
    private readonly outbox: OutboxService,
    private readonly projectContext: ProjectContext,
  ) {}

  async list(): Promise<MetricResponseDto[]> {
    const { projectId } = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) =>
      (await this.metrics.list(tx.db, projectId)).map((row) => MetricResponseDto.from(row)),
    );
  }

  async create(dto: CreateMetricDto): Promise<MetricResponseDto> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const existing = await this.metrics.list(tx.db, actor.projectId);
      if (existing.length >= MAX_METRICS) {
        throw new MetricsException(METRICS_ERRORS.METRIC_LIMIT_REACHED);
      }
      if (dto.pinned && existing.filter((m) => m.pinned).length >= MAX_PINNED) {
        throw new MetricsException(METRICS_ERRORS.METRIC_PINNED_LIMIT);
      }
      const source = dto.source ? toSource(dto.source) : null;
      const connectionId = source ? (dto.connectionId ?? null) : null;
      await this.assertSource(tx, actor.projectId, source, connectionId);
      const fixed = source ? METRIC_SOURCES[source.kind] : null;
      const taken = new Set(existing.map((m) => m.key));
      const preferred = dto.key ?? (source ? SOURCE_KEYS[source.kind] : undefined);
      if (dto.key && taken.has(dto.key)) throw new MetricsException(METRICS_ERRORS.METRIC_KEY_TAKEN);
      const key = preferred && !taken.has(preferred) ? preferred : `m_${randomBytes(3).toString('hex')}`;
      const row = await this.metrics.insert(tx.db, {
        account_id: actor.accountId,
        project_id: actor.projectId,
        key,
        title: dto.title,
        unit: fixed?.unit ?? dto.unit ?? 'count',
        aggregation: fixed?.aggregation ?? dto.aggregation ?? 'last',
        good_direction: dto.goodDirection ?? 'up',
        source,
        connection_id: connectionId,
        pinned: dto.pinned ?? false,
        position: existing.length,
        created_by: actor.userId,
      });
      await this.record(tx, 'metrics.create', row, { key, source: source?.kind ?? null });
      if (source) await this.requestCollect(tx, row);
      return MetricResponseDto.from(row);
    });
  }

  async update(id: string, dto: UpdateMetricDto): Promise<MetricResponseDto> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const current = await this.mustFind(tx, actor.projectId, id);
      if (dto.pinned && !current.pinned) {
        const all = await this.metrics.list(tx.db, actor.projectId);
        if (all.filter((m) => m.pinned).length >= MAX_PINNED) {
          throw new MetricsException(METRICS_ERRORS.METRIC_PINNED_LIMIT);
        }
      }
      const source = dto.source === undefined ? current.source : dto.source ? toSource(dto.source) : null;
      const connectionId = source
        ? dto.connectionId !== undefined
          ? dto.connectionId
          : current.connection_id
        : null;
      const sourceChanged =
        JSON.stringify(source) !== JSON.stringify(current.source) || connectionId !== current.connection_id;
      if (sourceChanged) await this.assertSource(tx, actor.projectId, source, connectionId);
      const fixed = source ? METRIC_SOURCES[source.kind] : null;
      if (sourceChanged) {
        // Points of another source would mix two different series.
        await tx.db.deleteFrom('metric_points').where('metric_id', '=', id).execute();
      }
      const row = await this.metrics.update(tx.db, id, {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        unit: fixed?.unit ?? dto.unit ?? current.unit,
        aggregation: fixed?.aggregation ?? dto.aggregation ?? current.aggregation,
        ...(dto.goodDirection !== undefined ? { good_direction: dto.goodDirection } : {}),
        ...(dto.pinned !== undefined ? { pinned: dto.pinned } : {}),
        ...(dto.position !== undefined ? { position: dto.position } : {}),
        ...(sourceChanged
          ? { source, connection_id: connectionId, collected_at: null, last_error: null }
          : {}),
      });
      await this.record(tx, 'metrics.update', row!, dto);
      if (sourceChanged && source) await this.requestCollect(tx, row!);
      return MetricResponseDto.from(row!);
    });
  }

  async delete(id: string): Promise<void> {
    const actor = this.projectContext.actor();
    await this.accountDb.transaction(async (tx) => {
      const current = await this.mustFind(tx, actor.projectId, id);
      await this.metrics.delete(tx.db, id);
      await this.record(tx, 'metrics.delete', current, { key: current.key });
    });
  }

  async collect(id: string): Promise<MetricResponseDto> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const current = await this.mustFind(tx, actor.projectId, id);
      if (!current.source) throw new MetricsException(METRICS_ERRORS.METRIC_SOURCE_INVALID);
      await this.requestCollect(tx, current);
      return MetricResponseDto.from(current);
    });
  }

  async series(id: string, days: number): Promise<PointDto[]> {
    const { projectId } = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const metric = await this.mustFind(tx, projectId, id);
      const project = await tx.db
        .selectFrom('projects')
        .select('timezone')
        .where('id', '=', projectId)
        .executeTakeFirstOrThrow();
      const to = todayIn(project.timezone);
      return PointDto.list(await this.metrics.points(tx.db, metric.id, addDays(to, 1 - days), to));
    });
  }

  private async assertSource(
    tx: AccountTx,
    projectId: string,
    source: MetricSource | null,
    connectionId: string | null,
  ): Promise<void> {
    if (!source) return;
    if (!connectionId) throw new MetricsException(METRICS_ERRORS.METRIC_SOURCE_INVALID);
    const connection = await tx.db
      .selectFrom('connections')
      .select('provider_key')
      .where('id', '=', connectionId)
      .where('project_id', '=', projectId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    const wrongQuery =
      (source.kind === 'postgres.sql' && !/^\s*(select|with)\b/i.test(source.query ?? '')) ||
      (source.kind === 'http_api.series' && !source.path);
    if (!connection || connection.provider_key !== METRIC_SOURCES[source.kind].provider || wrongQuery) {
      throw new MetricsException(METRICS_ERRORS.METRIC_SOURCE_INVALID);
    }
  }

  private async requestCollect(tx: AccountTx, metric: MetricRow): Promise<void> {
    await this.outbox.add<MetricCollectRequestedEvent>(tx, {
      type: METRICS_EVENTS.COLLECT_REQUESTED,
      payload: { projectId: metric.project_id, metricId: metric.id },
    });
  }

  private async mustFind(tx: AccountTx, projectId: string, id: string): Promise<MetricRow> {
    const row = await this.metrics.find(tx.db, projectId, id);
    if (!row) throw new MetricsException(METRICS_ERRORS.METRIC_NOT_FOUND);
    return row;
  }

  private async record(tx: AccountTx, action: string, metric: MetricRow, args: unknown) {
    const actor = this.projectContext.actor();
    await this.journal.record(tx, {
      actor: { type: 'user', id: actor.userId, role: actor.role },
      action,
      target: { type: 'metric', id: metric.id },
      args,
      status: 'succeeded',
    });
  }
}

function toSource(dto: MetricSourceDto): MetricSource {
  return {
    kind: dto.kind,
    ...(dto.kind === 'postgres.sql' && dto.query ? { query: dto.query } : {}),
    ...(dto.kind === 'http_api.series' && dto.path ? { path: dto.path } : {}),
  };
}
