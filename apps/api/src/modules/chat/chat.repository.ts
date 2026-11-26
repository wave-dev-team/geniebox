import { randomUUID } from 'node:crypto';

import { type Selectable, sql, type Transaction } from 'kysely';

import { Injectable } from '@nestjs/common';

import type { Agent, AgentTask, ChatTurn, SendChatMessage } from '@workspace/types';

import { TenantDb } from '../../database/tenant-db.js';
import type { ChatTurns, DB } from '../../database/types.js';

export interface ChatOwner {
  tenantId: string;
  userId: string;
}

export interface ChatJob extends ChatOwner {
  turnId: string;
  traceId: string;
}

export type ModelCallSource = ChatOwner & { traceId: string } & ({ turnId: string } | { taskId: string });

const pageSize = 30;

export function toChatTurn(row: Selectable<ChatTurns>, tasks: AgentTask[] = []): ChatTurn {
  return {
    id: row.id,
    message: row.message,
    answer: row.answer,
    status: row.status as ChatTurn['status'],
    createdAt: row.created_at.toISOString(),
    tasks,
  };
}

function ownedTurns(tx: Transaction<DB>, owner: ChatOwner) {
  return tx
    .selectFrom('chat_turns')
    .where('tenant_id', '=', owner.tenantId)
    .where('user_id', '=', owner.userId);
}

@Injectable()
export class ChatRepository {
  constructor(private readonly db: TenantDb) {}

  async history(owner: ChatOwner, before?: string) {
    return this.db.transaction(async (tx) => {
      let query = ownedTurns(tx, owner);
      if (before) {
        // Compare in Postgres to preserve the precision of the stored timestamp.
        query = query.where(sql<boolean>`
          (created_at, id) < (
            select created_at, id from chat_turns
            where tenant_id = ${owner.tenantId} and user_id = ${owner.userId} and id = ${before}
          )
        `);
      }
      const rows = await query
        .selectAll()
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(pageSize + 1)
        .execute();
      const page = rows.slice(0, pageSize);
      const tasks = page.length
        ? await tx
            .selectFrom('agent_tasks')
            .selectAll()
            .where('tenant_id', '=', owner.tenantId)
            .where('user_id', '=', owner.userId)
            .where(
              'turn_id',
              'in',
              page.map((row) => row.id),
            )
            .orderBy('position')
            .execute()
        : [];
      const byTurn = new Map<string, AgentTask[]>();
      for (const task of tasks) {
        const current = byTurn.get(task.turn_id) ?? [];
        current.push(toAgentTask(task));
        byTurn.set(task.turn_id, current);
      }
      return { rows: page, byTurn, nextCursor: rows.length > pageSize ? (page.at(-1)?.id ?? null) : null };
    });
  }

  async submit(owner: ChatOwner, input: SendChatMessage, traceId: string) {
    return this.db.transaction(async (tx) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`chat:${owner.tenantId}:${owner.userId}`}, 0))`.execute(
        tx,
      );
      const existing = await ownedTurns(tx, owner).selectAll().where('id', '=', input.id).executeTakeFirst();
      if (existing) return existing.message === input.message ? { row: existing, created: false } : undefined;
      const pending = await ownedTurns(tx, owner)
        .select('id')
        .where('status', '=', 'pending')
        .executeTakeFirst();
      if (pending) return undefined;
      const row = await tx
        .insertInto('chat_turns')
        .values({
          tenant_id: owner.tenantId,
          user_id: owner.userId,
          id: input.id,
          message: input.message,
          trace_id: traceId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return { row, created: true };
    });
  }

  async context(job: ChatJob) {
    return this.db.transaction(async (tx) => {
      const current = await ownedTurns(tx, job)
        .selectAll()
        .where('id', '=', job.turnId)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      if (!current) return undefined;
      const previous = await ownedTurns(tx, job)
        .select(['message', 'answer'])
        .where('status', '=', 'completed')
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(12)
        .execute();
      const profile = await tx
        .selectFrom('user_profiles')
        .select('name')
        .where('tenant_id', '=', job.tenantId)
        .where('id', '=', job.userId)
        .executeTakeFirst();
      return { current, previous, name: profile?.name };
    });
  }

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

  async tasks(job: ChatJob): Promise<AgentTask[]> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .selectFrom('agent_tasks')
        .selectAll()
        .where('tenant_id', '=', job.tenantId)
        .where('user_id', '=', job.userId)
        .where('turn_id', '=', job.turnId)
        .orderBy('position')
        .execute();
      return rows.map(toAgentTask);
    });
  }

  async plan(job: ChatJob, agents: Agent[]) {
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .updateTable('chat_turns')
        .set({ planned: true })
        .where('tenant_id', '=', job.tenantId)
        .where('user_id', '=', job.userId)
        .where('id', '=', job.turnId)
        .where('status', '=', 'pending')
        .where('planned', '=', false)
        .returning('id')
        .executeTakeFirst();
      if (!updated || !agents.length) return [];
      return tx
        .insertInto('agent_tasks')
        .values(
          agents.map((agent, position) => ({
            tenant_id: job.tenantId,
            user_id: job.userId,
            turn_id: job.turnId,
            agent_id: agent.id,
            agent_name: agent.name,
            position,
          })),
        )
        .returning('agent_id')
        .execute();
    });
  }

  async updateTask(
    job: ChatJob,
    agentId: string,
    status: 'running' | 'completed' | 'failed',
    result?: string,
  ) {
    return this.db.transaction((tx) =>
      tx
        .updateTable('agent_tasks')
        .set({ status, result, updated_at: sql`clock_timestamp()` })
        .where('tenant_id', '=', job.tenantId)
        .where('user_id', '=', job.userId)
        .where('turn_id', '=', job.turnId)
        .where('agent_id', '=', agentId)
        .where('status', 'in', ['pending', 'running'])
        .where('status', '!=', status)
        .returning('agent_id')
        .executeTakeFirst(),
    );
  }

  async update(job: ChatJob, status: ChatTurn['status'], answer?: string | null) {
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .updateTable('chat_turns')
        .set({ status, answer })
        .where('tenant_id', '=', job.tenantId)
        .where('user_id', '=', job.userId)
        .where('id', '=', job.turnId)
        .where('status', '=', 'pending')
        .returning('id')
        .executeTakeFirst();
      if (updated && status === 'failed') {
        await tx
          .updateTable('agent_tasks')
          .set({ status: 'failed' })
          .where('tenant_id', '=', job.tenantId)
          .where('user_id', '=', job.userId)
          .where('turn_id', '=', job.turnId)
          .where('status', 'in', ['pending', 'running'])
          .execute();
      }
      return updated;
    });
  }
}

function toAgentTask(row: Selectable<DB['agent_tasks']>): AgentTask {
  return {
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    result: row.result,
    status: row.status as AgentTask['status'],
  };
}
