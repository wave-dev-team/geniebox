import { randomUUID } from 'node:crypto';

import { type Job, type Queue, UnrecoverableError } from 'bullmq';
import { sql } from 'kysely';
import { z } from 'zod';

import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleInit } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../../common/context/app-cls-store.js';
import { runInContext } from '../../common/context/run-in-context.js';
import { AccountDb, type AccountTx } from '../../database/scoped-db.js';
import { SystemDb } from '../../database/system-db.js';
import { OnOutboxEvent } from '../../outbox/on-outbox-event.decorator.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import type { OutboxEnvelope } from '../../outbox/outbox.types.js';
import { LoggedWorkerHost } from '../../queues/logged-worker-host.js';
import { jobId, QUEUES } from '../../queues/queues.js';
import { ScheduledTaskRegistry } from '../../scheduling/scheduled-task.registry.js';
import {
  CONNECTION_EVENTS,
  type ConnectionEvent,
  type ConnectionStatusChangedEvent,
} from '../connections/events/connection.events.js';
import {
  PROJECT_EVENTS,
  type ProjectEvent,
  type ProjectUpdatedEvent,
} from '../projects/events/project.events.js';
import type { MainMetric } from '../projects/project.constants.js';
import { StreamPublisher } from '../stream/stream.publisher.js';
import { type TaskRunRequestedEvent, WORK_EVENTS } from '../work/events/work.events.js';
import { TasksRepository } from '../work/repositories/tasks.repository.js';
import { type MetricCollectRequestedEvent, METRICS_EVENTS, METRICS_TASKS } from './events/metrics.events.js';
import { MetricCollector, MetricSourceError } from './metric-collector.js';
import { COLLECT_EVERY_MS, defaultMetrics, MAX_PINNED, METRIC_SOURCES } from './metrics.constants.js';
import { MetricsRepository } from './repositories/metrics.repository.js';
import { ResultsRepository } from './repositories/results.repository.js';

const collectJobSchema = z.object({
  metricId: z.uuid(),
  accountId: z.uuid(),
  traceId: z.string().min(1),
});
export type CollectJob = z.infer<typeof collectJobSchema>;

const MAINTENANCE_ID = 'metrics-maintenance';
const MAINTENANCE_EVERY_MS = 15 * 60 * 1000;
const SWEEP_BATCH = 500;
const PARTITION_MONTHS_AHEAD = 2;

/**
 * Metrics glue in the worker: defaults for new projects, sources bound when a connection
 * appears, collection on request, and checks that come due.
 */
@Injectable()
export class MetricsWorker implements OnModuleInit {
  private readonly logger = new Logger(MetricsWorker.name);

  constructor(
    private readonly accountDb: AccountDb,
    private readonly metrics: MetricsRepository,
    private readonly results: ResultsRepository,
    private readonly tasks: TasksRepository,
    private readonly collector: MetricCollector,
    private readonly outbox: OutboxService,
    private readonly registry: ScheduledTaskRegistry,
    private readonly stream: StreamPublisher,
    @InjectQueue(QUEUES.METRICS_COLLECT) private readonly queue: Queue<CollectJob>,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      type: METRICS_TASKS.CHECK_RUN,
      payloadSchema: z.object({ checkId: z.uuid() }),
      handle: (payload) => this.runCheck(payload.checkId),
    });
  }

  @OnOutboxEvent(METRICS_EVENTS.COLLECT_REQUESTED)
  async onCollectRequested(envelope: OutboxEnvelope<MetricCollectRequestedEvent>): Promise<void> {
    await this.queue.add(
      'collect',
      {
        metricId: envelope.payload.metricId,
        accountId: envelope.accountId!,
        traceId: envelope.traceId,
      },
      { jobId: jobId('collect', envelope.eventId) },
    );
  }

  @OnOutboxEvent(PROJECT_EVENTS.CREATED)
  async onProjectCreated(envelope: OutboxEnvelope<ProjectEvent>): Promise<void> {
    await this.ensureDefaults(envelope.payload.projectId);
  }

  @OnOutboxEvent(PROJECT_EVENTS.UPDATED)
  async onProjectUpdated(envelope: OutboxEnvelope<ProjectUpdatedEvent>): Promise<void> {
    if (envelope.payload.fields.some((f) => f === 'main_metric' || f === 'custom_metric')) {
      await this.ensureDefaults(envelope.payload.projectId);
    }
  }

  @OnOutboxEvent(CONNECTION_EVENTS.CREATED)
  async onConnectionCreated(envelope: OutboxEnvelope<ConnectionEvent>): Promise<void> {
    await this.bindSources(envelope.payload.projectId);
  }

  @OnOutboxEvent(CONNECTION_EVENTS.STATUS_CHANGED)
  async onConnectionStatus(envelope: OutboxEnvelope<ConnectionStatusChangedEvent>): Promise<void> {
    if (envelope.payload.to === 'ok') await this.bindSources(envelope.payload.projectId);
  }

  /** Official metrics a project starts with; existing keys stay as people set them. */
  async ensureDefaults(projectId: string): Promise<void> {
    await this.accountDb.transaction(async (tx) => {
      const project = await tx.db
        .selectFrom('projects')
        .select(['account_id', 'main_metric', 'custom_metric', 'deleted_at'])
        .where('id', '=', projectId)
        .executeTakeFirst();
      if (!project || project.deleted_at) return;
      const existing = await this.metrics.list(tx.db, projectId);
      const pinned = existing.filter((m) => m.pinned).length;
      const defaults = defaultMetrics(project.main_metric as MainMetric, project.custom_metric);
      await this.metrics.insertMissing(
        tx.db,
        defaults.map((metric, index) => ({
          account_id: project.account_id,
          project_id: projectId,
          key: metric.key,
          title: metric.title,
          unit: metric.unit,
          aggregation: metric.aggregation,
          good_direction: metric.goodDirection,
          pinned: pinned === 0 && index < MAX_PINNED,
          position: existing.length + index,
        })),
      );
    });
    await this.bindSources(projectId);
  }

  /** A default metric without a source gets one when a fitting connection exists. */
  async bindSources(projectId: string): Promise<void> {
    const bound = await this.accountDb.transaction(async (tx) => {
      const project = await tx.db
        .selectFrom('projects')
        .select(['main_metric', 'custom_metric'])
        .where('id', '=', projectId)
        .executeTakeFirst();
      if (!project) return [];
      const defaults = defaultMetrics(project.main_metric as MainMetric, project.custom_metric);
      const connections = await tx.db
        .selectFrom('connections')
        .select(['id', 'provider_key', 'status'])
        .where('project_id', '=', projectId)
        .where('deleted_at', 'is', null)
        .orderBy('created_at')
        .execute();
      const out: Array<{ id: string; accountId: string }> = [];
      for (const metric of await this.metrics.list(tx.db, projectId)) {
        if (metric.source) continue;
        const auto = defaults.find((d) => d.key === metric.key)?.autoSource;
        if (!auto) continue;
        const provider = METRIC_SOURCES[auto].provider;
        const connection =
          connections.find((c) => c.provider_key === provider && c.status === 'ok') ??
          connections.find((c) => c.provider_key === provider);
        if (!connection) continue;
        await this.metrics.update(tx.db, metric.id, {
          source: { kind: auto },
          connection_id: connection.id,
          collected_at: null,
          last_error: null,
        });
        out.push({ id: metric.id, accountId: metric.account_id });
      }
      return out;
    });
    for (const metric of bound) {
      await this.queue.add(
        'collect',
        { metricId: metric.id, accountId: metric.accountId, traceId: randomUUID() },
        { jobId: jobId('collect', `${metric.id}-bound`) },
      );
    }
  }

  async collectOne(metricId: string): Promise<void> {
    const loaded = await this.accountDb.transaction(async (tx) => {
      const metric = await this.metrics.findById(tx.db, metricId);
      if (!metric) return undefined;
      const project = await tx.db
        .selectFrom('projects')
        .select(['timezone', 'deleted_at'])
        .where('id', '=', metric.project_id)
        .executeTakeFirst();
      return project && !project.deleted_at ? { metric, timezone: project.timezone } : undefined;
    });
    if (!loaded?.metric.source) return;
    try {
      await this.collector.collect(loaded.metric, loaded.timezone);
    } catch (error) {
      const code = error instanceof MetricSourceError ? error.code : 'INTERNAL';
      if (code === 'INTERNAL') this.logger.error({ err: error, metricId }, 'Metric collection failed');
      await this.accountDb.transaction((tx) =>
        this.metrics.update(tx.db, metricId, {
          last_error: code.slice(0, 200),
          attempted_at: new Date(),
        }),
      );
    }
    await this.stream.publish(loaded.metric.project_id, { type: 'metrics.updated' });
  }

  /** A check is due: the agent who proposed gets a task to check it on the data. */
  async runCheck(checkId: string): Promise<void> {
    await this.accountDb.transaction(async (tx) => {
      const check = await this.results.transitionCheck(tx.db, checkId, ['pending'], {
        status: 'running',
      });
      if (!check) return;
      const agent = await tx.db
        .selectFrom('agents')
        .select(['id', 'status', 'deleted_at'])
        .where('id', '=', check.agent_id)
        .executeTakeFirst();
      if (!agent || agent.deleted_at) {
        await this.results.transitionCheck(tx.db, checkId, ['running'], {
          status: 'failed',
          result: 'Агент больше не в команде',
          finished_at: new Date(),
        });
        return;
      }
      const idea = check.idea_id ? await this.results.findIdea(tx.db, check.idea_id) : undefined;
      const task = await this.tasks.insert(
        tx.db,
        {
          account_id: check.account_id,
          project_id: check.project_id,
          agent_id: check.agent_id,
          title: `Проверка: ${check.what}`.slice(0, 160),
          description: checkBrief(check.what, idea),
          origin: 'check',
          scheduled_at: new Date(),
        },
        [],
      );
      await tx.db.updateTable('checks').set({ task_id: task.id }).where('id', '=', checkId).execute();
      await this.requestRun(tx, check.project_id, task.id);
    });
  }

  private async requestRun(tx: AccountTx, projectId: string, taskId: string): Promise<void> {
    await this.outbox.add<TaskRunRequestedEvent>(tx, {
      type: WORK_EVENTS.TASK_RUN_REQUESTED,
      payload: { projectId, taskId, byUserId: null },
    });
  }
}

function checkBrief(what: string, idea: Awaited<ReturnType<ResultsRepository['findIdea']>>): string {
  const lines = [`Что проверить: ${what}`];
  if (idea) {
    const e = idea.experiment;
    lines.push(
      `Идея: ${idea.title}`,
      `Метрика: ${idea.metric_key}; контрольная группа ${e.controlPct}%, ${e.durationDays} дн., минимальная выборка ${e.minSample}`,
      `Не ухудшаем: ${e.guardrails.join(', ') || '—'}`,
    );
  }
  lines.push('Сравни с контролем на данных и запиши итог через record_check.');
  return lines.join('\n').slice(0, 2000);
}

@Processor(QUEUES.METRICS_COLLECT, { concurrency: 4 })
export class MetricsCollectProcessor extends LoggedWorkerHost {
  constructor(
    private readonly metricsWorker: MetricsWorker,
    private readonly cls: ClsService<AppClsStore>,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const parsed = collectJobSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError(`Invalid collect job: ${parsed.error.message}`);
    const data = parsed.data;
    await runInContext(this.cls, { traceId: data.traceId, accountId: data.accountId }, () =>
      this.metricsWorker.collectOne(data.metricId),
    );
  }
}

/**
 * Every 15 minutes: event partitions for the next months exist, and every metric with a source
 * not tried for an hour is queued. SystemDb: cross-account, ids and timestamps only.
 */
@Processor(QUEUES.METRICS_MAINTENANCE, { concurrency: 1 })
export class MetricsMaintenance extends LoggedWorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly systemDb: SystemDb,
    @InjectQueue(QUEUES.METRICS_MAINTENANCE) private readonly maintenance: Queue,
    @InjectQueue(QUEUES.METRICS_COLLECT) private readonly collect: Queue<CollectJob>,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.maintenance.upsertJobScheduler(MAINTENANCE_ID, { every: MAINTENANCE_EVERY_MS });
  }

  async process(): Promise<{ partitions: number; queued: number }> {
    return this.run();
  }

  /** Public for tests. */
  async run(): Promise<{ partitions: number; queued: number }> {
    const { partitions, due } = await this.systemDb.transaction(async (trx) => {
      const created = await sql<{ created: number }>`
        SELECT ensure_event_partitions(${PARTITION_MONTHS_AHEAD}) AS created
      `.execute(trx);
      const due = await trx
        .selectFrom('metric_definitions')
        .select(['id', 'account_id'])
        .where('source', 'is not', null)
        .where((eb) =>
          eb.or([
            eb('attempted_at', 'is', null),
            eb('attempted_at', '<', new Date(Date.now() - COLLECT_EVERY_MS)),
          ]),
        )
        .orderBy('attempted_at', (ob) => ob.nullsFirst())
        .limit(SWEEP_BATCH)
        .execute();
      return { partitions: created.rows[0]?.created ?? 0, due };
    });
    const slot = Math.floor(Date.now() / COLLECT_EVERY_MS);
    if (due.length) {
      await this.collect.addBulk(
        due.map((row) => ({
          name: 'collect',
          data: { metricId: row.id, accountId: row.account_id, traceId: randomUUID() },
          // One collection per metric per hour, however often the sweep runs.
          opts: { jobId: jobId('collect', `${row.id}-${slot}`) },
        })),
      );
    }
    return { partitions, queued: due.length };
  }
}
