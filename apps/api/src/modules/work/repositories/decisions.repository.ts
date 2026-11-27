import type { Insertable, Selectable, Transaction, Updateable } from 'kysely';

import { Injectable } from '@nestjs/common';

import type { DB, Decisions } from '../../../database/types.js';
import type { DecisionStatus, DecisionTerms, Fact, PendingAction, Risk } from '../work.constants.js';
import { json, parsed } from './json.js';

export type DecisionRow = Omit<
  Selectable<Decisions>,
  'why' | 'plan' | 'terms' | 'pending_actions' | 'status' | 'risk'
> & {
  status: DecisionStatus;
  risk: Risk;
  why: string[];
  plan: Fact[];
  terms: DecisionTerms | null;
  pending_actions: PendingAction[];
};

export type DecisionInsert = Omit<Insertable<Decisions>, 'why' | 'plan' | 'terms' | 'pending_actions'> & {
  why?: string[];
  plan?: Fact[];
  terms?: DecisionTerms | null;
  pending_actions?: PendingAction[];
};

const asDecision = (row: Selectable<Decisions>): DecisionRow => ({
  ...row,
  status: row.status as DecisionStatus,
  risk: row.risk as Risk,
  why: parsed<string[]>(row.why, []),
  plan: parsed<Fact[]>(row.plan, []),
  terms: parsed<DecisionTerms | null>(row.terms, null),
  pending_actions: parsed<PendingAction[]>(row.pending_actions, []),
});

@Injectable()
export class DecisionsRepository {
  async insert(db: Transaction<DB>, input: DecisionInsert): Promise<DecisionRow> {
    const { why, plan, terms, pending_actions, ...rest } = input;
    const row = await db
      .insertInto('decisions')
      .values({
        ...rest,
        why: json(why ?? []),
        plan: json(plan ?? []),
        terms: terms ? json(terms) : null,
        pending_actions: json(pending_actions ?? []),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return asDecision(row);
  }

  async find(db: Transaction<DB>, projectId: string, id: string): Promise<DecisionRow | undefined> {
    const row = await db
      .selectFrom('decisions')
      .selectAll()
      .where('id', '=', id)
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    return row ? asDecision(row) : undefined;
  }

  async findById(db: Transaction<DB>, id: string): Promise<DecisionRow | undefined> {
    const row = await db.selectFrom('decisions').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? asDecision(row) : undefined;
  }

  async findMany(db: Transaction<DB>, ids: string[]): Promise<DecisionRow[]> {
    if (ids.length === 0) return [];
    const rows = await db.selectFrom('decisions').selectAll().where('id', 'in', ids).execute();
    return rows.map(asDecision);
  }

  async list(
    db: Transaction<DB>,
    projectId: string,
    statuses: DecisionStatus[],
    limit: number,
  ): Promise<DecisionRow[]> {
    const rows = await db
      .selectFrom('decisions')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('status', 'in', statuses)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map(asDecision);
  }

  async countPending(db: Transaction<DB>, projectId: string): Promise<number> {
    const row = await db
      .selectFrom('decisions')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('project_id', '=', projectId)
      .where('status', '=', 'pending')
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  async countByStatus(db: Transaction<DB>, projectId: string): Promise<Record<string, number>> {
    const rows = await db
      .selectFrom('decisions')
      .select(['status', (eb) => eb.fn.countAll<string>().as('count')])
      .where('project_id', '=', projectId)
      .groupBy('status')
      .execute();
    return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
  }

  async findPendingByTask(db: Transaction<DB>, taskId: string): Promise<DecisionRow | undefined> {
    const row = await db
      .selectFrom('decisions')
      .selectAll()
      .where('task_id', '=', taskId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    return row ? asDecision(row) : undefined;
  }

  /** Same title rejected recently by the owner. */
  async inCooldown(db: Transaction<DB>, agentId: string, title: string): Promise<boolean> {
    const row = await db
      .selectFrom('decisions')
      .select('id')
      .where('agent_id', '=', agentId)
      .where('status', '=', 'rejected')
      .where('cooldown_until', '>', new Date())
      .where((eb) => eb(eb.fn('lower', ['title']), '=', title.toLowerCase()))
      .executeTakeFirst();
    return row !== undefined;
  }

  /** Atomic «pending → decided»; undefined when it was decided already (idempotency). */
  async decide(
    db: Transaction<DB>,
    id: string,
    values: Omit<Updateable<Decisions>, 'id' | 'account_id' | 'project_id'>,
  ): Promise<DecisionRow | undefined> {
    const row = await db
      .updateTable('decisions')
      .set(values)
      .where('id', '=', id)
      .where('status', '=', 'pending')
      .returningAll()
      .executeTakeFirst();
    return row ? asDecision(row) : undefined;
  }
}
