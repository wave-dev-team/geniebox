import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema.js';
import { AccountDb, type AccountTx } from '../../database/scoped-db.js';
import { JournalService } from '../../journal/journal.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { ProjectContext } from '../projects/project-context.js';
import { StreamPublisher } from '../stream/stream.publisher.js';
import { DecisionResponseDto } from './dto/decision.dto.js';
import { type DecisionDecidedEvent, WORK_EVENTS } from './events/work.events.js';
import { DecisionsRepository } from './repositories/decisions.repository.js';
import { DECIDED_STATUSES, type DecisionStatus } from './work.constants.js';
import { WORK_ERRORS, WorkException } from './work.errors.js';

const LIST_LIMIT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Decisions. «Да» and «Нет» change the status atomically together with the journal
 * entry; a repeated «да» (second tab) returns the decision as it is.
 */
@Injectable()
export class DecisionsService {
  private readonly cooldownDays: number;

  constructor(
    private readonly accountDb: AccountDb,
    private readonly decisions: DecisionsRepository,
    private readonly journal: JournalService,
    private readonly outbox: OutboxService,
    private readonly stream: StreamPublisher,
    private readonly projectContext: ProjectContext,
    config: ConfigService<Env, true>,
  ) {
    this.cooldownDays = config.get('DECISION_COOLDOWN_DAYS', { infer: true });
  }

  async list(tab: 'pending' | 'decided' | 'all'): Promise<DecisionResponseDto[]> {
    const { projectId } = this.projectContext.actor();
    const statuses: DecisionStatus[] =
      tab === 'pending'
        ? ['pending']
        : tab === 'decided'
          ? DECIDED_STATUSES
          : ['pending', ...DECIDED_STATUSES];
    return this.accountDb.transaction(async (tx) =>
      (await this.decisions.list(tx.db, projectId, statuses, LIST_LIMIT)).map((row) =>
        DecisionResponseDto.from(row),
      ),
    );
  }

  async get(id: string): Promise<DecisionResponseDto> {
    const { projectId } = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) =>
      DecisionResponseDto.from(await this.mustFind(tx, projectId, id)),
    );
  }

  async accept(id: string, term: string | undefined): Promise<DecisionResponseDto> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const decision = await this.mustFind(tx, actor.projectId, id);
      if (decision.status !== 'pending') return this.alreadyDecided(decision, 'accept');
      if (term !== undefined && !decision.terms?.options.some((option) => option.value === term)) {
        throw new WorkException(WORK_ERRORS.DECISION_TERM_INVALID);
      }
      const selected = term ?? decision.terms?.proposed ?? null;
      const modified = decision.terms !== null && selected !== decision.terms.proposed;
      const decided = await this.decisions.decide(tx.db, id, {
        status: modified ? 'modified' : 'accepted',
        selected_term: selected,
        decided_by: actor.userId,
        decided_at: new Date(),
        decided_via: 'web',
      });
      // Lost the race to another «да»: same answer as a repeated click.
      if (!decided) return this.alreadyDecided(await this.mustFind(tx, actor.projectId, id), 'accept');
      await this.finish(tx, actor, id, modified ? 'decisions.modify' : 'decisions.accept', {
        term: selected,
      });
      return DecisionResponseDto.from(decided);
    });
  }

  async reject(id: string, reason: string | undefined): Promise<DecisionResponseDto> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const decision = await this.mustFind(tx, actor.projectId, id);
      if (decision.status !== 'pending') return this.alreadyDecided(decision, 'reject');
      const decided = await this.decisions.decide(tx.db, id, {
        status: 'rejected',
        decided_by: actor.userId,
        decided_at: new Date(),
        decided_via: 'web',
        cooldown_until: new Date(Date.now() + this.cooldownDays * DAY_MS),
      });
      if (!decided) return this.alreadyDecided(await this.mustFind(tx, actor.projectId, id), 'reject');
      await this.finish(tx, actor, id, 'decisions.reject', { reason: reason ?? null });
      return DecisionResponseDto.from(decided);
    });
  }

  private alreadyDecided(
    decision: Awaited<ReturnType<DecisionsRepository['find']>> & object,
    intent: 'accept' | 'reject',
  ): DecisionResponseDto {
    const same =
      intent === 'accept'
        ? decision.status === 'accepted' || decision.status === 'modified'
        : decision.status === 'rejected';
    if (!same) throw new WorkException(WORK_ERRORS.DECISION_ALREADY_DECIDED);
    return DecisionResponseDto.from(decision);
  }

  private async finish(
    tx: AccountTx,
    actor: ReturnType<ProjectContext['actor']>,
    id: string,
    action: string,
    args: unknown,
  ): Promise<void> {
    await this.journal.record(tx, {
      actor: { type: 'user', id: actor.userId, role: actor.role },
      action,
      target: { type: 'decision', id },
      args,
      status: 'succeeded',
    });
    await this.outbox.add<DecisionDecidedEvent>(tx, {
      type: WORK_EVENTS.DECISION_DECIDED,
      payload: { projectId: actor.projectId, decisionId: id, byUserId: actor.userId },
    });
    tx.afterCommit(() => this.stream.publish(actor.projectId, { type: 'decision.updated', decisionId: id }));
  }

  private async mustFind(tx: AccountTx, projectId: string, id: string) {
    const decision = await this.decisions.find(tx.db, projectId, id);
    if (!decision) throw new WorkException(WORK_ERRORS.DECISION_NOT_FOUND);
    return decision;
  }
}
