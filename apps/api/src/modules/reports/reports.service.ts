import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';

import { ConflictException, Injectable } from '@nestjs/common';

import { type MetricsReportInput, metricsReportSchema } from '@workspace/types';

import type { WorkspaceActor } from '../../common/auth/request-actor.js';
import { TenantDb } from '../../database/tenant-db.js';
import { ConnectionsService } from '../connections/connections.service.js';
import { MetricsService } from '../metrics/metrics.service.js';

const pageSize = 20;

@Injectable()
export class ReportsService {
  constructor(
    private readonly db: TenantDb,
    private readonly connections: ConnectionsService,
    private readonly metrics: MetricsService,
  ) {}

  async create(actor: WorkspaceActor, input: MetricsReportInput) {
    const result = await this.connections.compare(actor.tenantId, input.baseline, input.comparison);
    if (!result) throw new ConflictException();
    const labels = await this.metrics.list();
    const before = result.before[input.metric];
    const after = result.after[input.metric];
    const change = before === 0 ? null : ((after - before) / before) * 100;
    const criterionMet =
      input.criterion && change !== null
        ? input.criterion.direction === 'atLeast'
          ? change >= input.criterion.target
          : change <= input.criterion.target
        : null;
    const report = metricsReportSchema.parse({
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      label: labels.find(({ key }) => key === input.metric)?.label ?? input.metric,
      source: result.mode,
      sourceUrl: result.url,
      sampled: result.sampled,
      before,
      after,
      change,
      criterionMet,
    });
    await this.db.transaction((tx) =>
      tx
        .insertInto('metrics_reports')
        .values({
          tenant_id: actor.tenantId,
          created_by: actor.userId,
          id: report.id,
          created_at: report.createdAt,
          payload: report,
        })
        .execute(),
    );
    return report;
  }

  async list(before?: string) {
    const rows = await this.db.transaction((tx) => {
      let query = tx.selectFrom('metrics_reports').select(['id', 'payload']);
      if (before) {
        query = query.where(sql<boolean>`(created_at, id) < (
          select created_at, id from metrics_reports where id = ${before}
        )`);
      }
      return query
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(pageSize + 1)
        .execute();
    });
    const reports = rows.slice(0, pageSize).map(({ payload }) => metricsReportSchema.parse(payload));
    return { reports, next: rows.length > pageSize ? (reports.at(-1)?.id ?? null) : null };
  }
}
