import type { Insertable, Selectable, Transaction, Updateable } from 'kysely';

import { Injectable } from '@nestjs/common';

import type { Checks, DB, Ideas, Insights } from '../../../database/types.js';
import { json, parsed } from '../../work/repositories/json.js';
import type { CheckStatus, CheckVerdict, Experiment, IdeaStatus, InsightFact } from '../metrics.constants.js';

export type IdeaRow = Omit<Selectable<Ideas>, 'experiment' | 'status' | 'effect_value'> & {
  status: IdeaStatus;
  experiment: Experiment;
  effect_value: number | null;
};
export type CheckRow = Omit<Selectable<Checks>, 'status' | 'verdict'> & {
  status: CheckStatus;
  verdict: CheckVerdict | null;
};
export type InsightRow = Omit<Selectable<Insights>, 'facts'> & { facts: InsightFact[] };

export interface PaymentEvent {
  externalId: string;
  occurredAt: Date;
  amount: number;
  currency: string;
  props: Record<string, string>;
}

const asIdea = (row: Selectable<Ideas>): IdeaRow => ({
  ...row,
  status: row.status as IdeaStatus,
  experiment: parsed<Experiment>(row.experiment, {
    metricKey: row.metric_key,
    controlPct: 0,
    durationDays: 0,
    minSample: 0,
    guardrails: [],
  }),
  effect_value: row.effect_value === null ? null : Number(row.effect_value),
});
const asCheck = (row: Selectable<Checks>): CheckRow => ({
  ...row,
  status: row.status as CheckStatus,
  verdict: row.verdict as CheckVerdict | null,
});
const asInsight = (row: Selectable<Insights>): InsightRow => ({
  ...row,
  facts: parsed<InsightFact[]>(row.facts, []),
});

/** Ideas, checks, insights and raw events: what the team tried and what it brought. */
@Injectable()
export class ResultsRepository {
  async insertIdea(
    db: Transaction<DB>,
    input: Omit<Insertable<Ideas>, 'experiment'> & { experiment: Experiment },
  ): Promise<IdeaRow> {
    const row = await db
      .insertInto('ideas')
      .values({ ...input, experiment: json(input.experiment) })
      .onConflict((oc) => oc.column('decision_id').doNothing())
      .returningAll()
      .executeTakeFirst();
    if (row) return asIdea(row);
    const existing = await db
      .selectFrom('ideas')
      .selectAll()
      .where('decision_id', '=', input.decision_id!)
      .executeTakeFirstOrThrow();
    return asIdea(existing);
  }

  async updateIdea(
    db: Transaction<DB>,
    id: string,
    patch: Omit<Updateable<Ideas>, 'experiment'>,
  ): Promise<void> {
    await db.updateTable('ideas').set(patch).where('id', '=', id).execute();
  }

  async ideas(db: Transaction<DB>, projectId: string, since: Date): Promise<IdeaRow[]> {
    const rows = await db
      .selectFrom('ideas')
      .selectAll()
      .where('project_id', '=', projectId)
      // Running now, or checked (or started) within the period.
      .where((eb) =>
        eb.or([eb('status', '=', 'running'), eb('finished_at', '>=', since), eb('started_at', '>=', since)]),
      )
      .orderBy('started_at', 'desc')
      .limit(200)
      .execute();
    return rows.map(asIdea);
  }

  async ideasOfAgent(db: Transaction<DB>, agentId: string): Promise<IdeaRow[]> {
    const rows = await db
      .selectFrom('ideas')
      .selectAll()
      .where('agent_id', '=', agentId)
      .orderBy('started_at', 'desc')
      .limit(500)
      .execute();
    return rows.map(asIdea);
  }

  async findIdea(db: Transaction<DB>, id: string): Promise<IdeaRow | undefined> {
    const row = await db.selectFrom('ideas').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? asIdea(row) : undefined;
  }

  /** Idempotent per decision: a repeated «да» does not create a second check. */
  async insertCheck(db: Transaction<DB>, input: Insertable<Checks>): Promise<CheckRow> {
    const row = await db
      .insertInto('checks')
      .values(input)
      .onConflict((oc) => oc.column('decision_id').doNothing())
      .returningAll()
      .executeTakeFirst();
    if (row) return asCheck(row);
    const existing = await db
      .selectFrom('checks')
      .selectAll()
      .where('decision_id', '=', input.decision_id!)
      .executeTakeFirstOrThrow();
    return asCheck(existing);
  }

  async findCheck(db: Transaction<DB>, id: string): Promise<CheckRow | undefined> {
    const row = await db.selectFrom('checks').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? asCheck(row) : undefined;
  }

  async checkOfTask(db: Transaction<DB>, taskId: string): Promise<CheckRow | undefined> {
    const row = await db.selectFrom('checks').selectAll().where('task_id', '=', taskId).executeTakeFirst();
    return row ? asCheck(row) : undefined;
  }

  /** Moves a check from one of `from` to the new state; undefined when it was not there. */
  async transitionCheck(
    db: Transaction<DB>,
    id: string,
    from: CheckStatus[],
    patch: Updateable<Checks>,
  ): Promise<CheckRow | undefined> {
    const row = await db
      .updateTable('checks')
      .set(patch)
      .where('id', '=', id)
      .where('status', 'in', from)
      .returningAll()
      .executeTakeFirst();
    return row ? asCheck(row) : undefined;
  }

  async upcomingChecks(
    db: Transaction<DB>,
    projectId: string,
    agentId?: string,
    limit = 10,
  ): Promise<CheckRow[]> {
    let query = db
      .selectFrom('checks')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('status', 'in', ['pending', 'running']);
    if (agentId) query = query.where('agent_id', '=', agentId);
    const rows = await query.orderBy('due_at').limit(limit).execute();
    return rows.map(asCheck);
  }

  /** Finished checks of an agent, newest first: the streak of right proposals. */
  async finishedChecks(db: Transaction<DB>, agentId: string, limit = 50): Promise<CheckRow[]> {
    const rows = await db
      .selectFrom('checks')
      .selectAll()
      .where('agent_id', '=', agentId)
      .where('status', '=', 'done')
      .orderBy('finished_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map(asCheck);
  }

  async insertInsight(
    db: Transaction<DB>,
    input: Omit<Insertable<Insights>, 'facts'> & { facts: InsightFact[] },
  ): Promise<InsightRow> {
    const row = await db
      .insertInto('insights')
      .values({ ...input, facts: json(input.facts) })
      .returningAll()
      .executeTakeFirstOrThrow();
    return asInsight(row);
  }

  async latestInsight(db: Transaction<DB>, projectId: string): Promise<InsightRow | undefined> {
    const row = await db
      .selectFrom('insights')
      .selectAll()
      .where('project_id', '=', projectId)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? asInsight(row) : undefined;
  }

  async findInsight(db: Transaction<DB>, projectId: string, id: string): Promise<InsightRow | undefined> {
    const row = await db
      .selectFrom('insights')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? asInsight(row) : undefined;
  }

  /** Payment events, deduplicated by provider id. Returns how many were new. */
  async insertPayments(
    db: Transaction<DB>,
    accountId: string,
    projectId: string,
    source: string,
    events: PaymentEvent[],
  ): Promise<number> {
    if (events.length === 0) return 0;
    const result = await db
      .insertInto('events')
      .values(
        events.map((event) => ({
          account_id: accountId,
          project_id: projectId,
          source,
          type: 'payment.succeeded',
          external_id: event.externalId,
          occurred_at: event.occurredAt,
          amount: String(event.amount),
          currency: event.currency,
          props: json(event.props),
        })),
      )
      .onConflict((oc) => oc.columns(['project_id', 'source', 'external_id', 'occurred_at']).doNothing())
      .executeTakeFirst();
    return Number(result.numInsertedOrUpdatedRows ?? 0);
  }
}
