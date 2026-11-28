import { Injectable } from '@nestjs/common';

import { AccountDb, type AccountTx } from '../../database/scoped-db.js';
import { JournalService } from '../../journal/journal.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import type { ProjectActor } from '../projects/project-context.js';
import { ProjectContext } from '../projects/project-context.js';
import { StreamPublisher } from '../stream/stream.publisher.js';
import type { CreateTaskDto } from './dto/task.dto.js';
import { TaskResponseDto } from './dto/task.dto.js';
import { type TaskRunRequestedEvent, WORK_EVENTS } from './events/work.events.js';
import { DecisionsRepository } from './repositories/decisions.repository.js';
import { TasksRepository } from './repositories/tasks.repository.js';
import { ACTIVE_TASK_STATUSES, FINISHED_TASK_STATUSES, type TaskStatus } from './work.constants.js';
import { WORK_ERRORS, WorkException } from './work.errors.js';
import { findProjectAgent } from './work-agents.js';

const LIST_LIMIT = 200;

/** Tasks: lists, card, «Поставить задачу», run now, retry, cancel. */
@Injectable()
export class TasksService {
  constructor(
    private readonly accountDb: AccountDb,
    private readonly tasks: TasksRepository,
    private readonly decisions: DecisionsRepository,
    private readonly journal: JournalService,
    private readonly outbox: OutboxService,
    private readonly stream: StreamPublisher,
    private readonly projectContext: ProjectContext,
  ) {}

  async list(tab: 'active' | 'done', agentId?: string): Promise<TaskResponseDto[]> {
    const { projectId } = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const rows = await this.tasks.list(tx.db, {
        projectId,
        statuses: tab === 'active' ? ACTIVE_TASK_STATUSES : FINISHED_TASK_STATUSES,
        agentId,
        limit: LIST_LIMIT,
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      if (tab === 'active' && rows.length > 0) {
        let frontier = rows.map((r) => r.id);
        for (let depth = 0; depth < 3 && frontier.length > 0; depth++) {
          const children = await this.tasks.listByParents(tx.db, projectId, frontier);
          const next: string[] = [];
          for (const child of children) {
            if (!byId.has(child.id)) {
              byId.set(child.id, child);
              next.push(child.id);
            }
          }
          frontier = next;
        }
      }
      const allRows = [...byId.values()];
      const steps = await this.tasks.listSteps(
        tx.db,
        allRows.map((row) => row.id),
      );
      return allRows.map((row) => TaskResponseDto.from(row, steps));
    });
  }

  async counts(): Promise<{ active: number; done: number }> {
    const { projectId } = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const byStatus = await this.tasks.countByStatus(tx.db, projectId);
      const sum = (statuses: TaskStatus[]) =>
        statuses.reduce((total, status) => total + (byStatus[status] ?? 0), 0);
      return { active: sum(ACTIVE_TASK_STATUSES), done: sum(FINISHED_TASK_STATUSES) };
    });
  }

  async get(id: string): Promise<TaskResponseDto> {
    const { projectId } = this.projectContext.actor();
    return this.accountDb.transaction((tx) => this.view(tx, projectId, id));
  }

  /** «Поставить задачу»: the owner gives a task straight to an agent or the manager. */
  async create(dto: CreateTaskDto): Promise<TaskResponseDto> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const agent = await findProjectAgent(tx.db, actor.projectId, dto.agentId);
      if (!agent) throw new WorkException(WORK_ERRORS.WORK_AGENT_INVALID);
      const task = await this.tasks.insert(tx.db, {
        account_id: tx.accountId,
        project_id: actor.projectId,
        agent_id: agent.id,
        title: dto.title,
        description: dto.description ?? null,
        origin: 'owner',
        mode: dto.mode ?? null,
        scheduled_at: new Date(),
        created_by: actor.userId,
      });
      await this.record(tx, actor, task.id, 'tasks.create', { agentId: agent.id });
      await this.requestRun(tx, actor, task.id);
      return this.view(tx, actor.projectId, task.id);
    });
  }

  /** «Запустить сейчас» (planned) and «Повторить» (failed). */
  async run(id: string): Promise<TaskResponseDto> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const task = await this.mustFind(tx, actor.projectId, id);
      const moved = await this.tasks.transition(tx.db, task.id, ['planned', 'failed'], {
        status: 'planned',
        scheduled_at: new Date(),
        error: null,
      });
      if (!moved) throw new WorkException(WORK_ERRORS.TASK_STATE_INVALID);
      await this.record(tx, actor, id, task.status === 'failed' ? 'tasks.retry' : 'tasks.run', {});
      await this.requestRun(tx, actor, id);
      return this.view(tx, actor.projectId, id);
    });
  }

  /** «Отменить»: planned, running or waiting; a pending decision of the task expires. */
  async cancel(id: string): Promise<TaskResponseDto> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      await this.mustFind(tx, actor.projectId, id);
      const moved = await this.tasks.transition(tx.db, id, ['planned', 'running', 'waiting'], {
        status: 'cancelled',
        finished_at: new Date(),
        summary: null,
      });
      if (!moved) throw new WorkException(WORK_ERRORS.TASK_STATE_INVALID);
      await this.cancelDescendants(tx, actor.projectId, id);
      await this.tasks.closeSteps(tx.db, id, 'failed');
      const pending = await this.decisions.findPendingByTask(tx.db, id);
      if (pending) {
        await this.decisions.decide(tx.db, pending.id, { status: 'expired' });
        tx.afterCommit(() =>
          this.stream.publish(actor.projectId, { type: 'decision.updated', decisionId: pending.id }),
        );
      }
      await this.record(tx, actor, id, 'tasks.cancel', {});
      tx.afterCommit(() => this.stream.publish(actor.projectId, { type: 'task.updated', taskId: id }));
      return this.view(tx, actor.projectId, id);
    });
  }

  /** Hands the task to the worker after commit (outbox) and tells open pages. */
  async requestRun(tx: AccountTx, actor: ProjectActor, taskId: string): Promise<void> {
    await this.outbox.add<TaskRunRequestedEvent>(tx, {
      type: WORK_EVENTS.TASK_RUN_REQUESTED,
      payload: { projectId: actor.projectId, taskId, byUserId: actor.userId },
    });
    tx.afterCommit(() => this.stream.publish(actor.projectId, { type: 'task.updated', taskId }));
  }

  private async cancelDescendants(tx: AccountTx, projectId: string, rootId: string): Promise<void> {
    let frontier = [rootId];
    for (let depth = 0; depth < 5 && frontier.length > 0; depth++) {
      const children = await this.tasks.listByParents(tx.db, projectId, frontier);
      const next: string[] = [];
      for (const child of children) {
        next.push(child.id);
        const cancelled = await this.tasks.transition(tx.db, child.id, ['planned', 'running', 'waiting'], {
          status: 'cancelled',
          finished_at: new Date(),
          summary: null,
        });
        if (!cancelled) continue;
        await this.tasks.closeSteps(tx.db, child.id, 'failed');
        const pending = await this.decisions.findPendingByTask(tx.db, child.id);
        if (pending) {
          await this.decisions.decide(tx.db, pending.id, { status: 'expired' });
          tx.afterCommit(() =>
            this.stream.publish(projectId, { type: 'decision.updated', decisionId: pending.id }),
          );
        }
        tx.afterCommit(() => this.stream.publish(projectId, { type: 'task.updated', taskId: child.id }));
      }
      frontier = next;
    }
  }

  private async view(tx: AccountTx, projectId: string, id: string): Promise<TaskResponseDto> {
    const task = await this.mustFind(tx, projectId, id);
    const [steps, pending] = await Promise.all([
      this.tasks.listSteps(tx.db, [id]),
      this.decisions.findPendingByTask(tx.db, id),
    ]);
    return TaskResponseDto.from(task, steps, pending?.id ?? null);
  }

  private async mustFind(tx: AccountTx, projectId: string, id: string) {
    const task = await this.tasks.find(tx.db, projectId, id);
    if (!task) throw new WorkException(WORK_ERRORS.TASK_NOT_FOUND);
    return task;
  }

  private record(tx: AccountTx, actor: ProjectActor, id: string, action: string, args: unknown) {
    return this.journal.record(tx, {
      actor: { type: 'user', id: actor.userId, role: actor.role },
      action,
      target: { type: 'task', id },
      args,
      status: 'succeeded',
    });
  }
}
