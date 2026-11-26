import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema.js';
import { AccountDb } from '../../database/scoped-db.js';
import { ScheduledTasksService } from '../../scheduling/scheduled-tasks.service.js';
import { METRICS_TASKS } from '../metrics/events/metrics.events.js';
import type { CheckSpec, Experiment } from '../metrics/metrics.constants.js';
import { ResultsRepository } from '../metrics/repositories/results.repository.js';
import type { DecisionRow } from '../work/repositories/decisions.repository.js';
import { DecisionsRepository } from '../work/repositories/decisions.repository.js';
import { TasksRepository } from '../work/repositories/tasks.repository.js';
import { ToolExecutor } from './broker/tool-executor.js';
import { RuntimeContextLoader } from './runtime-context.js';
import { RuntimeTexts } from './runtime-texts.js';
import { TaskLifecycle } from './task-lifecycle.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * After «да» / «нет»: approved actions run through the broker on behalf of the
 * agent, marked as approved by the person; the waiting task finishes or closes.
 */
@Injectable()
export class DecisionExecutor {
  private readonly logger = new Logger(DecisionExecutor.name);
  private readonly cooldownDays: number;

  constructor(
    private readonly accountDb: AccountDb,
    private readonly decisions: DecisionsRepository,
    private readonly tasks: TasksRepository,
    private readonly executor: ToolExecutor,
    private readonly loader: RuntimeContextLoader,
    private readonly lifecycle: TaskLifecycle,
    private readonly texts: RuntimeTexts,
    private readonly results: ResultsRepository,
    private readonly scheduler: ScheduledTasksService,
    config: ConfigService<Env, true>,
  ) {
    this.cooldownDays = config.get('DECISION_COOLDOWN_DAYS', { infer: true });
  }

  async handle(decisionId: string): Promise<void> {
    const decision = await this.accountDb.transaction((tx) => this.decisions.findById(tx.db, decisionId));
    if (!decision || decision.status === 'pending') return;
    const lang = await this.loader.locale(decision.decided_by);
    const task = decision.task_id
      ? await this.accountDb.transaction((tx) => this.tasks.findById(tx.db, decision.task_id!))
      : undefined;

    if (decision.status === 'rejected' || decision.status === 'expired') {
      if (task?.status === 'waiting') {
        await this.lifecycle.complete(task, ['waiting'], {
          status: 'cancelled',
          result:
            decision.status === 'rejected'
              ? this.texts.t('rejected', lang, { days: this.cooldownDays })
              : this.texts.t('expired', lang),
          summary: this.texts.t(decision.status === 'rejected' ? 'rejectedSummary' : 'expiredSummary', lang),
        });
      }
      return;
    }

    await this.planCheck(decision);
    const agent = await this.loader.agent(decision.agent_id);
    const failures: string[] = [];
    if (agent && !agent.deleted) {
      for (const action of decision.pending_actions) {
        const args = applyTerm(action.args, decision.terms?.proposed ?? null, decision.selected_term);
        const outcome = await this.executor.execute(
          {
            accountId: decision.account_id,
            projectId: decision.project_id,
            agent: agent.runtime,
            taskId: decision.task_id,
            conversationId: task?.conversation_id ?? null,
            replyMessageId: null,
            userId: decision.decided_by,
            mode: null,
          },
          action.toolId,
          args,
          [action.toolId],
          { approvedBy: decision.decided_by, decisionId: decision.id },
        );
        if (outcome.status !== 'executed') failures.push(outcome.errorCode ?? outcome.status);
      }
    } else if (decision.pending_actions.length) {
      failures.push('AGENT_GONE');
    }

    if (task?.status !== 'waiting') return;
    if (failures.length) {
      this.logger.warn({ decisionId, failures }, 'Approved actions failed');
      await this.lifecycle.fail(task, this.texts.error('ACTION_FAILED', lang, { code: failures.join(', ') }));
      return;
    }
    await this.lifecycle.complete(task, ['waiting'], {
      status: 'done',
      result: decision.yes_text
        ? this.texts.t('accepted', lang, { text: decision.yes_text })
        : this.texts.t('acceptedDefault', lang),
      summary: this.texts.t('acceptedSummary', lang),
    });
  }

  /**
   * «Да» to a measurable proposal starts the experiment (idea) and books its check; the agent
   * gets a check task when it is due. Idempotent per decision.
   */
  private async planCheck(decision: DecisionRow): Promise<void> {
    const experiment = decision.experiment as Experiment | null;
    const spec = decision.check_spec as CheckSpec | null;
    if (!experiment && !spec) return;
    const days = spec?.inDays ?? experiment!.durationDays;
    await this.accountDb.transaction(async (tx) => {
      const idea = experiment
        ? await this.results.insertIdea(tx.db, {
            account_id: decision.account_id,
            project_id: decision.project_id,
            agent_id: decision.agent_id,
            decision_id: decision.id,
            metric_key: experiment.metricKey,
            title: decision.title,
            experiment,
          })
        : undefined;
      const check = await this.results.insertCheck(tx.db, {
        account_id: decision.account_id,
        project_id: decision.project_id,
        agent_id: decision.agent_id,
        decision_id: decision.id,
        idea_id: idea?.id ?? null,
        what: (spec?.what ?? decision.title).slice(0, 160),
        due_at: new Date(Date.now() + days * DAY_MS),
      });
      await this.scheduler.schedule(tx, {
        type: METRICS_TASKS.CHECK_RUN,
        payload: { checkId: check.id },
        runAt: check.due_at,
        dedupeKey: check.id,
      });
    });
  }
}

/**
 * Changed terms: an action argument equal to the proposed term value takes the chosen
 * one. Only exact string or number matches of top-level arguments are replaced.
 */
function applyTerm(
  args: Record<string, unknown>,
  proposed: string | null,
  selected: string | null,
): Record<string, unknown> {
  if (!proposed || !selected || proposed === selected) return args;
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      if (value === proposed) return [key, selected];
      if (typeof value === 'number' && String(value) === proposed && Number.isFinite(Number(selected))) {
        return [key, Number(selected)];
      }
      return [key, value];
    }),
  );
}
