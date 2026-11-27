import type { Insertable, Selectable, Transaction, Updateable } from 'kysely';

import { Injectable } from '@nestjs/common';

import type { DB, Tasks, TaskSteps } from '../../../database/types.js';
import type { Fact, StepStatus, TaskError, TaskStatus } from '../work.constants.js';
import { json, parsed } from './json.js';

export type TaskRow = Omit<Selectable<Tasks>, 'facts' | 'error' | 'status'> & {
  status: TaskStatus;
  facts: Fact[];
  error: TaskError | null;
};
export type TaskInsert = Omit<Insertable<Tasks>, 'facts' | 'error'> & { facts?: Fact[] };
export type TaskUpdate = Omit<
  Updateable<Tasks>,
  'id' | 'account_id' | 'project_id' | 'facts' | 'error' | 'created_at'
> & { facts?: Fact[]; error?: TaskError | null };

export type StepRow = Omit<Selectable<TaskSteps>, 'status'> & { status: StepStatus };

const asTask = (row: Selectable<Tasks>): TaskRow => ({
  ...row,
  status: row.status as TaskStatus,
  facts: parsed<Fact[]>(row.facts, []),
  error: parsed<TaskError | null>(row.error, null),
});

const values = (input: TaskUpdate) => {
  const { facts, error, ...rest } = input;
  return {
    ...rest,
    ...(facts ? { facts: json(facts) } : {}),
    ...(error !== undefined ? { error: error === null ? null : json(error) } : {}),
  };
};

export interface TaskListFilter {
  projectId: string;
  statuses: TaskStatus[];
  agentId?: string;
  limit: number;
}

@Injectable()
export class TasksRepository {
  async insert(db: Transaction<DB>, input: TaskInsert, steps: string[] = []): Promise<TaskRow> {
    const { facts, ...rest } = input;
    const row = await db
      .insertInto('tasks')
      .values({ ...rest, facts: json(facts ?? []) })
      .returningAll()
      .executeTakeFirstOrThrow();
    if (steps.length) await this.replaceSteps(db, row.account_id, row.id, steps);
    return asTask(row);
  }

  async find(db: Transaction<DB>, projectId: string, id: string): Promise<TaskRow | undefined> {
    const row = await db
      .selectFrom('tasks')
      .selectAll()
      .where('id', '=', id)
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    return row ? asTask(row) : undefined;
  }

  /** Worker side: by id inside the current account. */
  async findById(db: Transaction<DB>, id: string, lock = false): Promise<TaskRow | undefined> {
    let query = db.selectFrom('tasks').selectAll().where('id', '=', id);
    if (lock) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row ? asTask(row) : undefined;
  }

  async list(db: Transaction<DB>, filter: TaskListFilter): Promise<TaskRow[]> {
    let query = db
      .selectFrom('tasks')
      .selectAll()
      .where('project_id', '=', filter.projectId)
      .where('status', 'in', filter.statuses);
    if (filter.agentId) query = query.where('agent_id', '=', filter.agentId);
    const rows = await query
      .orderBy((eb) => eb.fn.coalesce('finished_at', 'scheduled_at', 'created_at'), 'desc')
      .limit(filter.limit)
      .execute();
    return rows.map(asTask);
  }

  async listByParent(db: Transaction<DB>, parentTaskId: string): Promise<TaskRow[]> {
    const rows = await db
      .selectFrom('tasks')
      .selectAll()
      .where('parent_task_id', '=', parentTaskId)
      .orderBy('created_at', 'asc')
      .execute();
    return rows.map(asTask);
  }

  async listByParents(db: Transaction<DB>, projectId: string, parentIds: string[]): Promise<TaskRow[]> {
    if (parentIds.length === 0) return [];
    const rows = await db
      .selectFrom('tasks')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('parent_task_id', 'in', parentIds)
      .orderBy('created_at', 'asc')
      .execute();
    return rows.map(asTask);
  }

  async listByRoutine(db: Transaction<DB>, routineId: string, limit: number): Promise<TaskRow[]> {
    const rows = await db
      .selectFrom('tasks')
      .selectAll()
      .where('routine_id', '=', routineId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map(asTask);
  }

  async countByStatus(db: Transaction<DB>, projectId: string): Promise<Record<string, number>> {
    const rows = await db
      .selectFrom('tasks')
      .select(['status', (eb) => eb.fn.countAll<string>().as('count')])
      .where('project_id', '=', projectId)
      .groupBy('status')
      .execute();
    return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
  }

  async update(db: Transaction<DB>, id: string, input: TaskUpdate): Promise<TaskRow | undefined> {
    const row = await db
      .updateTable('tasks')
      .set(values(input))
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row ? asTask(row) : undefined;
  }

  /** Moves the task only from one of `from`; undefined when it was already elsewhere. */
  async transition(
    db: Transaction<DB>,
    id: string,
    from: TaskStatus[],
    input: TaskUpdate,
  ): Promise<TaskRow | undefined> {
    const row = await db
      .updateTable('tasks')
      .set(values(input))
      .where('id', '=', id)
      .where('status', 'in', from)
      .returningAll()
      .executeTakeFirst();
    return row ? asTask(row) : undefined;
  }

  // --- steps ---------------------------------------------------------------------------------

  async listSteps(db: Transaction<DB>, taskIds: string[]): Promise<StepRow[]> {
    if (taskIds.length === 0) return [];
    const rows = await db
      .selectFrom('task_steps')
      .selectAll()
      .where('task_id', 'in', taskIds)
      .orderBy('position')
      .execute();
    return rows.map((row) => ({ ...row, status: row.status as StepStatus }));
  }

  async replaceSteps(
    db: Transaction<DB>,
    accountId: string,
    taskId: string,
    titles: string[],
  ): Promise<void> {
    await db.deleteFrom('task_steps').where('task_id', '=', taskId).execute();
    if (titles.length === 0) return;
    await db
      .insertInto('task_steps')
      .values(
        titles.map((title, position) => ({
          account_id: accountId,
          task_id: taskId,
          position,
          title: title.slice(0, 160),
          status: position === 0 ? 'current' : 'todo',
        })),
      )
      .execute();
  }

  /** Appends a step after the last one; returns its position. */
  async appendStep(
    db: Transaction<DB>,
    accountId: string,
    taskId: string,
    step: { title: string; status: StepStatus; note?: string | null },
  ): Promise<number> {
    const last = await db
      .selectFrom('task_steps')
      .select((eb) => eb.fn.max('position').as('max'))
      .where('task_id', '=', taskId)
      .executeTakeFirst();
    const position = Math.min(50, (last?.max ?? -1) + 1);
    await db
      .insertInto('task_steps')
      .values({
        account_id: accountId,
        task_id: taskId,
        position,
        title: step.title.slice(0, 160),
        status: step.status,
        note: step.note?.slice(0, 120) ?? null,
        at: step.status === 'done' || step.status === 'failed' ? new Date() : null,
      })
      .onConflict((oc) => oc.columns(['task_id', 'position']).doNothing())
      .execute();
    return position;
  }

  async setStep(
    db: Transaction<DB>,
    taskId: string,
    position: number,
    status: StepStatus,
    note?: string | null,
  ): Promise<void> {
    await db
      .updateTable('task_steps')
      .set({
        status,
        ...(note !== undefined ? { note: note?.slice(0, 120) ?? null } : {}),
        ...(status === 'done' || status === 'failed' ? { at: new Date() } : {}),
      })
      .where('task_id', '=', taskId)
      .where('position', '=', position)
      .execute();
  }

  /** Closes the open steps of a finished task. */
  async closeSteps(db: Transaction<DB>, taskId: string, status: 'done' | 'failed'): Promise<void> {
    await db
      .updateTable('task_steps')
      .set({ status, at: new Date() })
      .where('task_id', '=', taskId)
      .where('status', '=', 'current')
      .execute();
    if (status === 'done') {
      await db
        .updateTable('task_steps')
        .set({ status: 'done', at: new Date() })
        .where('task_id', '=', taskId)
        .where('status', '=', 'todo')
        .execute();
    }
  }
}
