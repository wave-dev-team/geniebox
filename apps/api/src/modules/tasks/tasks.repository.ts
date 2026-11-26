import { randomUUID } from 'node:crypto';

import { type InferResult, sql, type Transaction } from 'kysely';

import { Injectable } from '@nestjs/common';

import type {
  Agent,
  CreateWorkTask,
  TaskAction,
  TaskStatus,
  TaskTab,
  UpdateWorkTask,
  WorkTask,
} from '@workspace/types';

import { TenantDb } from '../../database/tenant-db.js';
import type { DB } from '../../database/types.js';
import { ProfileRepository } from '../profile/profile.repository.js';

export interface TaskOwner {
  tenantId: string;
  userId: string;
}

export interface TaskJob extends TaskOwner {
  taskId: string;
  runId: string;
  traceId: string;
}

export interface TaskFilter {
  tab: TaskTab;
  agentId?: string;
  before?: string;
}

const pageSize = 35;
const completed = new Set(['done', 'cancelled']);
const actions = {
  start: { status: 'running', from: ['planned'] },
  complete: { status: 'done', from: ['planned', 'running'] },
  cancel: { status: 'cancelled', from: ['planned', 'running', 'failed'] },
  retry: { status: 'planned', from: ['failed'] },
} as const;

function ownTasks(tx: Transaction<DB>, owner: TaskOwner) {
  return tx
    .selectFrom('work_tasks')
    .where('tenant_id', '=', owner.tenantId)
    .where('user_id', '=', owner.userId);
}

function activity(tx: Transaction<DB>, owner: TaskOwner, agentId?: string) {
  const manual = ownTasks(tx, owner).select([
    'id',
    'title',
    'description',
    'agent_id',
    'agent_name',
    'status',
    'result',
    'run_id',
    'trace_id',
    'created_at',
    'updated_at',
    sql<string | null>`to_char(due_on, 'YYYY-MM-DD')`.as('due_on'),
    sql<string | null>`null::uuid`.as('turn_id'),
  ]);
  const delegated = tx
    .selectFrom('agent_tasks as a')
    .innerJoin('chat_turns as c', (join) =>
      join
        .onRef('c.tenant_id', '=', 'a.tenant_id')
        .onRef('c.user_id', '=', 'a.user_id')
        .onRef('c.id', '=', 'a.turn_id'),
    )
    .where('a.tenant_id', '=', owner.tenantId)
    .where('a.user_id', '=', owner.userId)
    .select([
      'a.id',
      sql<string>`left(c.message, 160)`.as('title'),
      'c.message as description',
      'a.agent_id',
      'a.agent_name',
      sql<string>`case a.status when 'pending' then 'planned' when 'completed' then 'done' else a.status end`.as(
        'status',
      ),
      'a.result',
      sql<string | null>`null::uuid`.as('run_id'),
      'c.trace_id',
      'a.created_at',
      'a.updated_at',
      sql<string | null>`null::text`.as('due_on'),
      'a.turn_id',
    ]);
  const scoped = agentId
    ? manual.where('agent_id', '=', agentId).unionAll(delegated.where('a.agent_id', '=', agentId))
    : manual.unionAll(delegated);
  return tx.selectFrom(scoped.as('activity')).selectAll();
}

export type TaskRow = InferResult<ReturnType<typeof activity>>[number];

export function toWorkTask(row: TaskRow): WorkTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    agentId: row.agent_id,
    agentName: row.agent_name,
    dueOn: row.due_on,
    result: row.result,
    turnId: row.turn_id,
    status: row.status as TaskStatus,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

@Injectable()
export class TasksRepository {
  constructor(
    private readonly db: TenantDb,
    private readonly profiles: ProfileRepository,
  ) {}

  list(owner: TaskOwner, filter: TaskFilter) {
    return this.db.transaction(async (tx) => {
      let source = activity(tx, owner, filter.agentId);
      const date = filter.tab === 'done' ? 'updated_at' : 'created_at';
      source = source.where('status', filter.tab === 'done' ? 'in' : 'not in', [...completed]);
      if (filter.before) {
        source = source.where(sql<boolean>`(${sql.ref(date)}, id) < (
          ${activity(tx, owner).clearSelect().select([date, 'id']).where('id', '=', filter.before)}
        )`);
      }
      const rows = await source
        .orderBy(date, 'desc')
        .orderBy('id', 'desc')
        .limit(pageSize + 1)
        .execute();
      return {
        rows: rows.slice(0, pageSize),
        nextCursor: rows.length > pageSize ? (rows[pageSize - 1]?.id ?? null) : null,
      };
    });
  }

  counts(owner: TaskOwner, agentId?: string) {
    return this.db.transaction(async (tx) => {
      const groups = await activity(tx, owner, agentId)
        .clearSelect()
        .select(['status', (eb) => eb.fn.countAll().as('count')])
        .groupBy('status')
        .execute();
      const values = { active: 0, done: 0 };
      for (const { status, count } of groups)
        values[completed.has(status) ? 'done' : 'active'] += Number(count);
      return values;
    });
  }

  find(owner: TaskOwner, id: string) {
    return this.db.transaction((tx) => activity(tx, owner).where('id', '=', id).executeTakeFirst());
  }

  create(owner: TaskOwner, input: CreateWorkTask, agent: Agent | undefined, traceId: string) {
    return this.db.transaction((tx) => this.createInTransaction(tx, owner, input, agent, traceId));
  }

  async createInTransaction(
    tx: Transaction<DB>,
    owner: TaskOwner,
    input: CreateWorkTask,
    agent: Agent | undefined,
    traceId: string,
  ) {
    const inserted = await tx
      .insertInto('work_tasks')
      .values({
        tenant_id: owner.tenantId,
        user_id: owner.userId,
        id: input.id,
        title: input.title,
        description: input.description,
        due_on: input.dueOn,
        agent_id: agent?.id,
        agent_name: agent?.name,
        run_id: agent ? randomUUID() : null,
        trace_id: traceId,
      })
      .onConflict((oc) => oc.columns(['tenant_id', 'user_id', 'id']).doNothing())
      .returning('id')
      .executeTakeFirst();
    const row = await activity(tx, owner).where('id', '=', input.id).executeTakeFirstOrThrow();
    return { row, created: Boolean(inserted) };
  }

  edit(owner: TaskOwner, id: string, input: UpdateWorkTask) {
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .updateTable('work_tasks')
        .set({
          title: input.title,
          description: input.description,
          due_on: input.dueOn,
          updated_at: sql`clock_timestamp()`,
        })
        .where('tenant_id', '=', owner.tenantId)
        .where('user_id', '=', owner.userId)
        .where('id', '=', id)
        .where('agent_id', 'is', null)
        .where('status', 'in', ['planned', 'running'])
        .returning('id')
        .executeTakeFirst();
      return updated ? activity(tx, owner).where('id', '=', id).executeTakeFirst() : undefined;
    });
  }

  transition(owner: TaskOwner, id: string, action: TaskAction, traceId: string) {
    return this.db.transaction(async (tx) => {
      const config = actions[action];
      let query = tx
        .updateTable('work_tasks')
        .set({
          status: config.status,
          updated_at: sql`clock_timestamp()`,
          ...(action === 'retry' && { run_id: randomUUID(), trace_id: traceId, result: null }),
        })
        .where('tenant_id', '=', owner.tenantId)
        .where('user_id', '=', owner.userId)
        .where('id', '=', id)
        .where('status', 'in', config.from);
      if (action === 'start' || action === 'complete') query = query.where('agent_id', 'is', null);
      if (action === 'retry') query = query.where('agent_id', 'is not', null);
      const updated = await query.returning('id').executeTakeFirst();
      return updated ? activity(tx, owner).where('id', '=', id).executeTakeFirst() : undefined;
    });
  }

  async runContext(job: TaskJob) {
    const context = await this.db.transaction(async (tx) => {
      const task = await ownTasks(tx, job)
        .select(['title', 'description', 'agent_id'])
        .where('id', '=', job.taskId)
        .where('run_id', '=', job.runId)
        .where('status', 'in', ['planned', 'running'])
        .executeTakeFirst();
      if (!task) return undefined;
      const member = await tx
        .selectFrom('workspace_members')
        .select('home_tenant_id')
        .where('tenant_id', '=', job.tenantId)
        .where('user_id', '=', job.userId)
        .executeTakeFirstOrThrow();
      return { task, member };
    });
    return (
      context && {
        ...context,
        name: await this.profiles.name({ tenantId: context.member.home_tenant_id, userId: job.userId }),
      }
    );
  }

  updateRun(job: TaskJob, status: 'running' | 'done' | 'failed', result?: string) {
    return this.db.transaction((tx) =>
      tx
        .updateTable('work_tasks')
        .set({
          status,
          result,
          updated_at: sql`clock_timestamp()`,
        })
        .where('tenant_id', '=', job.tenantId)
        .where('user_id', '=', job.userId)
        .where('id', '=', job.taskId)
        .where('run_id', '=', job.runId)
        .where('status', 'in', ['planned', 'running'])
        .where('status', '!=', status)
        .returning('id')
        .executeTakeFirst(),
    );
  }
}
