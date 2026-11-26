import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';

import { Injectable } from '@nestjs/common';

import { TenantDb } from '../../database/tenant-db.js';

export type ModelCallSource = {
  tenantId: string;
  userId: string;
  traceId: string;
} & ({ turnId: string } | { taskId: string });

@Injectable()
export class ModelCallsRepository {
  constructor(private readonly db: TenantDb) {}

  async reserveCall(job: ModelCallSource, model: string, role: string, promptVersion: string, limit: number) {
    return this.db.transaction(async (tx) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`llm:${job.tenantId}:${role}`}, 0))`.execute(
        tx,
      );
      const { count } = await tx
        .selectFrom('llm_calls')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('tenant_id', '=', job.tenantId)
        .where('role', '=', role)
        .where('created_at', '>=', sql<Date>`date_trunc('day', now(), 'UTC')`)
        .executeTakeFirstOrThrow();
      if (Number(count) >= limit) return undefined;
      const id = randomUUID();
      await tx
        .insertInto('llm_calls')
        .values({
          tenant_id: job.tenantId,
          id,
          turn_id: 'turnId' in job ? job.turnId : null,
          work_task_id: 'taskId' in job ? job.taskId : null,
          user_id: job.userId,
          trace_id: job.traceId,
          model,
          role,
          prompt_version: promptVersion,
        })
        .execute();
      return id;
    });
  }

  async recordCall(
    job: ModelCallSource,
    id: string,
    result: 'ok' | 'error' | 'timeout' | 'invalid',
    latencyMs: number,
    usage?: { input: number; output: number; cost: string },
  ) {
    await this.db.transaction((tx) =>
      tx
        .updateTable('llm_calls')
        .set({
          result,
          latency_ms: latencyMs,
          tokens_in: usage?.input,
          tokens_out: usage?.output,
          cost_usd: usage?.cost,
        })
        .where('tenant_id', '=', job.tenantId)
        .where('id', '=', id)
        .execute(),
    );
  }
}
