import type { Queue } from 'bullmq';
import { z } from 'zod';

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import { AccountDb, type AccountTx } from '../../database/scoped-db.js';
import { OnOutboxEvent } from '../../outbox/on-outbox-event.decorator.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import type { OutboxEnvelope } from '../../outbox/outbox.types.js';
import { jobId, QUEUES } from '../../queues/queues.js';
import { ScheduledTaskRegistry } from '../../scheduling/scheduled-task.registry.js';
import { ScheduledTasksService } from '../../scheduling/scheduled-tasks.service.js';
import { PROJECT_EVENTS, type ProjectOnboardingCompletedEvent } from '../projects/events/project.events.js';
import { StreamPublisher } from '../stream/stream.publisher.js';
import {
  type DecisionDecidedEvent,
  type MessagePostedEvent,
  type RoutineChangedEvent,
  type TaskRunRequestedEvent,
  WORK_EVENTS,
  WORK_TASKS,
} from '../work/events/work.events.js';
import { DecisionsRepository } from '../work/repositories/decisions.repository.js';
import { type RoutineRow, RoutinesRepository } from '../work/repositories/routines.repository.js';
import { TasksRepository } from '../work/repositories/tasks.repository.js';
import { isScheduleKey, nextRun } from '../work/schedule.js';
import { findManager } from '../work/work-agents.js';
import { DecisionExecutor } from './decision-executor.js';
import { RUNTIME_TASKS, type TaskJob, type TurnJob } from './runtime.jobs.js';
import { RuntimeContextLoader } from './runtime-context.js';
import { RuntimeTexts } from './runtime-texts.js';

/**
 * Glue of the runtime: outbox events from the API become queue jobs, routines run on their
 * schedule, decisions expire. Every handler is idempotent (at-least-once delivery).
 */
@Injectable()
export class RuntimeWorker implements OnModuleInit {
  constructor(
    private readonly accountDb: AccountDb,
    @InjectQueue(QUEUES.AGENT_TURNS) private readonly turns: Queue<TurnJob>,
    @InjectQueue(QUEUES.AGENT_TASKS) private readonly taskQueue: Queue<TaskJob>,
    private readonly routines: RoutinesRepository,
    private readonly tasks: TasksRepository,
    private readonly decisions: DecisionsRepository,
    private readonly scheduler: ScheduledTasksService,
    private readonly registry: ScheduledTaskRegistry,
    private readonly outbox: OutboxService,
    private readonly executor: DecisionExecutor,
    private readonly loader: RuntimeContextLoader,
    private readonly texts: RuntimeTexts,
    private readonly stream: StreamPublisher,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      type: WORK_TASKS.ROUTINE_RUN,
      payloadSchema: z.object({ routineId: z.uuid(), at: z.iso.datetime({ offset: true }) }),
      handle: (payload) => this.runRoutine(payload.routineId, new Date(payload.at)),
    });
    this.registry.register({
      type: RUNTIME_TASKS.DECISION_EXPIRE,
      payloadSchema: z.object({ decisionId: z.uuid() }),
      handle: (payload) => this.expireDecision(payload.decisionId),
    });
  }

  @OnOutboxEvent(WORK_EVENTS.MESSAGE_POSTED)
  async onMessagePosted(envelope: OutboxEnvelope<MessagePostedEvent>): Promise<void> {
    const { payload } = envelope;
    await this.turns.add(
      'turn',
      {
        accountId: envelope.accountId!,
        projectId: payload.projectId,
        conversationId: payload.conversationId,
        userMessageId: payload.userMessageId,
        replyMessageId: payload.replyMessageId,
        userId: payload.byUserId,
        traceId: envelope.traceId,
      },
      { jobId: jobId('turn', payload.replyMessageId) },
    );
  }

  @OnOutboxEvent(WORK_EVENTS.TASK_RUN_REQUESTED)
  async onTaskRunRequested(envelope: OutboxEnvelope<TaskRunRequestedEvent>): Promise<void> {
    await this.taskQueue.add(
      'run',
      {
        accountId: envelope.accountId!,
        projectId: envelope.payload.projectId,
        taskId: envelope.payload.taskId,
        userId: envelope.payload.byUserId,
        traceId: envelope.traceId,
      },
      // One job per request event; the runner's planned → running transition drops duplicates.
      { jobId: jobId('task', envelope.eventId) },
    );
  }

  @OnOutboxEvent(WORK_EVENTS.DECISION_DECIDED)
  async onDecisionDecided(envelope: OutboxEnvelope<DecisionDecidedEvent>): Promise<void> {
    await this.executor.handle(envelope.payload.decisionId);
  }

  @OnOutboxEvent(WORK_EVENTS.ROUTINE_CHANGED)
  async onRoutineChanged(envelope: OutboxEnvelope<RoutineChangedEvent>): Promise<void> {
    await this.accountDb.transaction(async (tx) => {
      const routine = await this.routines.findById(tx.db, envelope.payload.routineId);
      if (routine) await this.scheduleNext(tx, routine);
    });
  }

  /** Onboarding done → the first routine «Итоги дня» of the manager. */
  @OnOutboxEvent(PROJECT_EVENTS.ONBOARDING_COMPLETED)
  async onOnboardingCompleted(envelope: OutboxEnvelope<ProjectOnboardingCompletedEvent>): Promise<void> {
    const { projectId, byUserId } = envelope.payload;
    const lang = await this.loader.locale(byUserId);
    await this.accountDb.transaction(async (tx) => {
      const manager = await findManager(tx.db, projectId);
      const project = await tx.db
        .selectFrom('projects')
        .select('timezone')
        .where('id', '=', projectId)
        .executeTakeFirst();
      if (!manager || !project) return;
      const routine = await this.routines.insert(tx.db, {
        account_id: tx.accountId,
        project_id: projectId,
        agent_id: manager.id,
        kind: 'daily_digest',
        title: this.texts.t('digestTitle', lang),
        description: this.texts.t('digestDescription', lang),
        schedule: 'daily_21',
        enabled: true,
        next_run_at: nextRun('daily_21', project.timezone),
        created_by: byUserId,
      });
      if (routine) await this.scheduleNext(tx, routine);
    });
  }

  async runRoutine(routineId: string, at: Date): Promise<void> {
    await this.accountDb.transaction(async (tx) => {
      const routine = await this.routines.findById(tx.db, routineId);
      // Changed since this run was scheduled: the new schedule has its own task.
      if (!routine?.enabled || routine.next_run_at?.getTime() !== at.getTime()) return;
      const project = await tx.db
        .selectFrom('projects')
        .select(['timezone', 'deleted_at'])
        .where('id', '=', routine.project_id)
        .executeTakeFirst();
      if (!project || project.deleted_at || !isScheduleKey(routine.schedule)) return;
      const agent = await tx.db
        .selectFrom('agents')
        .select(['status', 'deleted_at'])
        .where('id', '=', routine.agent_id)
        .executeTakeFirst();
      if (!agent || agent.deleted_at) {
        await this.routines.update(tx.db, routine.id, { enabled: false, next_run_at: null });
        return;
      }
      if (agent.status === 'paused') {
        const lang = await this.loader.locale(routine.created_by);
        await this.routines.update(tx.db, routine.id, {
          last_run_at: new Date(),
          last_run_summary: this.texts.t('skippedPaused', lang),
        });
      } else {
        const task = await this.tasks.insert(tx.db, {
          account_id: tx.accountId,
          project_id: routine.project_id,
          agent_id: routine.agent_id,
          title: routine.title,
          description: routine.description,
          origin: 'routine',
          routine_id: routine.id,
          scheduled_at: at,
        });
        await this.outbox.add<TaskRunRequestedEvent>(tx, {
          type: WORK_EVENTS.TASK_RUN_REQUESTED,
          payload: { projectId: routine.project_id, taskId: task.id, byUserId: null },
        });
      }
      const updated = await this.routines.update(tx.db, routine.id, {
        next_run_at: nextRun(routine.schedule, project.timezone, at),
      });
      if (updated) await this.scheduleNext(tx, updated);
      tx.afterCommit(() => this.stream.publish(routine.project_id, { type: 'routine.updated', routineId }));
    });
  }

  async expireDecision(decisionId: string): Promise<void> {
    const expired = await this.accountDb.transaction(async (tx) => {
      const decision = await this.decisions.findById(tx.db, decisionId);
      if (decision?.status !== 'pending' || !decision.expires_at || decision.expires_at > new Date())
        return null;
      return this.decisions.decide(tx.db, decisionId, { status: 'expired' });
    });
    if (!expired) return;
    await this.stream.publish(expired.project_id, { type: 'decision.updated', decisionId });
    await this.executor.handle(decisionId);
  }

  private async scheduleNext(tx: AccountTx, routine: RoutineRow): Promise<void> {
    if (!routine.enabled || !routine.next_run_at) return;
    await this.scheduler.schedule(tx, {
      type: WORK_TASKS.ROUTINE_RUN,
      payload: { routineId: routine.id, at: routine.next_run_at.toISOString() },
      runAt: routine.next_run_at,
      dedupeKey: `${routine.id}:${routine.next_run_at.toISOString()}`,
    });
  }
}
