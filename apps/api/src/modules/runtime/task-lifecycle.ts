import { Injectable } from '@nestjs/common';

import { AccountDb, type AccountTx } from '../../database/scoped-db.js';
import { JournalService } from '../../journal/journal.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { StreamPublisher } from '../stream/stream.publisher.js';
import {
  type MessageReadyEvent,
  type TaskFinishedEvent,
  type TaskRunRequestedEvent,
  WORK_EVENTS,
} from '../work/events/work.events.js';
import { ConversationsRepository } from '../work/repositories/conversations.repository.js';
import { RoutinesRepository } from '../work/repositories/routines.repository.js';
import { type TaskRow, TasksRepository } from '../work/repositories/tasks.repository.js';
import type { Card, TaskError, TaskStatus } from '../work/work.constants.js';

/**
 * Final transitions of a task with their side effects: steps, routine bookkeeping, a message
 * in the conversation the task came from, journal and live updates.
 */
@Injectable()
export class TaskLifecycle {
  constructor(
    private readonly accountDb: AccountDb,
    private readonly tasks: TasksRepository,
    private readonly routines: RoutinesRepository,
    private readonly conversations: ConversationsRepository,
    private readonly journal: JournalService,
    private readonly stream: StreamPublisher,
    private readonly outbox: OutboxService,
  ) {}

  async complete(
    task: TaskRow,
    from: TaskStatus[],
    outcome: { status: 'done' | 'cancelled'; result: string; summary?: string | null },
    cards: Card[] = [],
  ): Promise<boolean> {
    return this.accountDb.transaction(async (tx) => {
      const moved = await this.tasks.transition(tx.db, task.id, from, {
        status: outcome.status,
        result: outcome.result.slice(0, 2000),
        summary: outcome.summary?.slice(0, 200) ?? null,
        finished_at: new Date(),
        ...(outcome.status === 'done' ? { progress_pct: 100 } : {}),
      });
      if (!moved) return false;
      await this.tasks.closeSteps(tx.db, task.id, outcome.status === 'done' ? 'done' : 'failed');
      await this.afterRun(tx, moved, outcome.result);
      await this.say(tx, moved, outcome.result, [{ type: 'task', id: task.id }, ...cards]);
      await this.record(tx, moved, `tasks.${outcome.status}`);
      if (outcome.status === 'done') await this.finished(tx, moved, 'done');
      await this.maybeWakeParent(tx, moved);
      return true;
    });
  }

  async fail(task: TaskRow, error: TaskError): Promise<void> {
    await this.accountDb.transaction(async (tx) => {
      const moved = await this.tasks.transition(tx.db, task.id, ['planned', 'running', 'waiting'], {
        status: 'failed',
        error,
        summary: error.what.slice(0, 200),
        finished_at: new Date(),
      });
      if (!moved) return;
      await this.tasks.closeSteps(tx.db, task.id, 'failed');
      await this.afterRun(tx, moved, error.what);
      await this.record(tx, moved, 'tasks.fail', { code: error.code });
      await this.finished(tx, moved, 'failed');
      await this.maybeWakeParent(tx, moved);
    });
  }

  /** Task waits for the owner: step «Ждёт вашего решения», message with the decision card. */
  async wait(task: TaskRow, decisionId: string, step: string, summary: string, text: string): Promise<void> {
    await this.accountDb.transaction(async (tx) => {
      const moved = await this.tasks.transition(tx.db, task.id, ['running'], {
        status: 'waiting',
        waiting_reason: 'decision',
        summary,
      });
      if (!moved) return;
      await tx.db
        .updateTable('task_steps')
        .set({ status: 'done', at: new Date() })
        .where('task_id', '=', task.id)
        .where('status', '=', 'current')
        .execute();
      await this.tasks.appendStep(tx.db, tx.accountId, task.id, { title: step, status: 'current' });
      await this.say(tx, moved, text, [
        { type: 'task', id: task.id },
        { type: 'decision', id: decisionId },
      ]);
      await this.record(tx, moved, 'tasks.wait', { decisionId });
    });
  }

  /** Task waits for delegated subtasks to finish. */
  async waitForSubtasks(task: TaskRow, summary: string): Promise<void> {
    await this.accountDb.transaction(async (tx) => {
      const moved = await this.tasks.transition(tx.db, task.id, ['running'], {
        status: 'waiting',
        waiting_reason: 'subtasks',
        summary: summary.slice(0, 200),
      });
      if (!moved) return;
      await this.record(tx, moved, 'tasks.wait_subtasks');
      tx.afterCommit(() => this.stream.publish(task.project_id, { type: 'task.updated', taskId: task.id }));
    });
  }

  /** Task waits for a missing connection to be added. */
  async waitForConnection(task: TaskRow, summary: string): Promise<void> {
    await this.accountDb.transaction(async (tx) => {
      const moved = await this.tasks.transition(tx.db, task.id, ['running'], {
        status: 'waiting',
        waiting_reason: 'connection',
        summary: summary.slice(0, 200),
      });
      if (!moved) return;
      await this.record(tx, moved, 'tasks.wait_connection');
      tx.afterCommit(() => this.stream.publish(task.project_id, { type: 'task.updated', taskId: task.id }));
    });
  }

  private async maybeWakeParent(tx: AccountTx, child: TaskRow): Promise<void> {
    if (!child.parent_task_id) return;
    const parent = await this.tasks.findById(tx.db, child.parent_task_id, true);
    if (!parent || parent.status !== 'waiting' || parent.waiting_reason !== 'subtasks') return;
    const siblings = await this.tasks.listByParent(tx.db, parent.id);
    const hasActive = siblings.some(
      (s) => s.status === 'planned' || s.status === 'running' || s.status === 'waiting',
    );
    if (hasActive) return;
    const woken = await this.tasks.transition(tx.db, parent.id, ['waiting'], {
      status: 'planned',
      waiting_reason: null,
      scheduled_at: new Date(),
      summary: null,
    });
    if (!woken) return;
    await this.outbox.add<TaskRunRequestedEvent>(tx, {
      type: WORK_EVENTS.TASK_RUN_REQUESTED,
      payload: { projectId: parent.project_id, taskId: parent.id, byUserId: parent.created_by },
    });
    tx.afterCommit(() => this.stream.publish(parent.project_id, { type: 'task.updated', taskId: parent.id }));
  }

  private async afterRun(tx: AccountTx, task: TaskRow, summary: string): Promise<void> {
    if (task.routine_id) {
      await this.routines.update(tx.db, task.routine_id, {
        last_run_at: new Date(),
        last_run_summary: summary.slice(0, 200),
      });
      const routineId = task.routine_id;
      tx.afterCommit(() => this.stream.publish(task.project_id, { type: 'routine.updated', routineId }));
    }
    tx.afterCommit(() => this.stream.publish(task.project_id, { type: 'task.updated', taskId: task.id }));
  }

  /** The agent reports back in the conversation the task came from. */
  private async say(tx: AccountTx, task: TaskRow, text: string, cards: Card[]): Promise<void> {
    if (!task.conversation_id) return;
    const conversation = await this.conversations.find(tx.db, task.project_id, task.conversation_id);
    const recipientUserId = conversation?.created_by;
    if (!recipientUserId || conversation.private_archive) return;
    const message = await this.conversations.insertMessage(tx.db, {
      account_id: tx.accountId,
      conversation_id: task.conversation_id,
      role: 'assistant',
      agent_id: task.agent_id,
      text: text.slice(0, 8000),
      cards,
    });
    await this.conversations.touch(tx.db, task.conversation_id);
    const conversationId = task.conversation_id;
    await this.outbox.add<MessageReadyEvent>(tx, {
      type: WORK_EVENTS.MESSAGE_READY,
      payload: { projectId: task.project_id, conversationId, messageId: message.id },
    });
    tx.afterCommit(() =>
      this.stream.publish(task.project_id, {
        type: 'message.created',
        recipientUserId,
        conversationId,
        messageId: message.id,
      }),
    );
  }

  /** Routine results («Итоги дня») and failures go out by the users' settings. */
  private async finished(tx: AccountTx, task: TaskRow, status: 'done' | 'failed'): Promise<void> {
    const routine = task.routine_id
      ? await tx.db.selectFrom('routines').select('kind').where('id', '=', task.routine_id).executeTakeFirst()
      : undefined;
    await this.outbox.add<TaskFinishedEvent>(tx, {
      type: WORK_EVENTS.TASK_FINISHED,
      payload: {
        projectId: task.project_id,
        taskId: task.id,
        status,
        routineKind: routine?.kind ?? null,
      },
    });
  }

  private record(tx: AccountTx, task: TaskRow, action: string, args?: unknown): Promise<void> {
    return this.journal.record(tx, {
      actor: { type: 'agent', id: task.agent_id },
      action,
      target: { type: 'task', id: task.id },
      args,
      status: 'succeeded',
    });
  }
}
