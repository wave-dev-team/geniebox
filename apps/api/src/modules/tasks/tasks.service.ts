import { randomUUID } from 'node:crypto';

import { type Queue, UnrecoverableError } from 'bullmq';

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ClsService } from 'nestjs-cls';

import type { CreateWorkTask, TaskAction, TaskStatus, UpdateWorkTask, WorkTask } from '@workspace/types';

import { modelJobOptions, type TaskJob, taskJobId, tasksQueue } from '../../queues/jobs.js';
import { AgentsService } from '../agents/agents.service.js';
import { buildMessages } from '../runtime/model-context.js';
import { canRetryModel, RuntimeService } from '../runtime/runtime.service.js';
import {
  type TaskFilter,
  type TaskOwner,
  type TaskRow,
  TasksRepository,
  toWorkTask,
} from './tasks.repository.js';

const taskEvents = {
  planned: 'task.requeued',
  running: 'task.started',
  failed: 'task.failed',
  done: 'task.completed',
  cancelled: 'task.cancelled',
} satisfies Record<TaskStatus, string>;

export type TaskMutation = WorkTask | 'missing' | 'conflict';

class TaskEvent {
  readonly eventId = randomUUID();
  readonly occurredAt = new Date().toISOString();

  constructor(
    readonly tenantId: string,
    readonly userId: string,
    readonly taskId: string,
    readonly traceId: string,
    readonly status: TaskStatus,
  ) {}
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly repository: TasksRepository,
    private readonly agents: AgentsService,
    private readonly completion: RuntimeService,
    private readonly events: EventEmitter2,
    private readonly context: ClsService,
    @Optional() @InjectQueue(tasksQueue) private readonly queue: Queue<TaskJob> | undefined,
  ) {}

  async list(owner: TaskOwner, filter: TaskFilter) {
    const page = await this.repository.list(owner, filter);
    const results = await Promise.all(page.rows.map((row) => this.syncQueue(owner, row)));
    return { tasks: results.map(toWorkTask), nextCursor: page.nextCursor };
  }

  counts(owner: TaskOwner, agentId?: string) {
    return this.repository.counts(owner, agentId);
  }

  async get(owner: TaskOwner, id: string) {
    const row = await this.repository.find(owner, id);
    return row && toWorkTask(await this.syncQueue(owner, row));
  }

  async create(owner: TaskOwner, input: CreateWorkTask): Promise<TaskMutation> {
    const existing = await this.repository.find(owner, input.id);
    if (existing) {
      if (!sameTask(existing, input)) return 'conflict';
      return toWorkTask(await this.syncQueue(owner, existing));
    }
    const agent = input.agentId ? await this.agents.find(owner, input.agentId) : undefined;
    if (input.agentId && (!agent?.enabled || !this.queue)) return 'conflict';
    const { row, created } = await this.repository.create(owner, input, agent, this.traceId());
    if (!created && !sameTask(row, input)) return 'conflict';
    if (created)
      this.events.emit(
        'task.created',
        new TaskEvent(owner.tenantId, owner.userId, row.id, row.trace_id, 'planned'),
      );
    return toWorkTask(created ? row : await this.syncQueue(owner, row));
  }

  async edit(owner: TaskOwner, id: string, input: UpdateWorkTask): Promise<TaskMutation> {
    const traceId = this.traceId();
    const task = await this.repository.edit(owner, id, input, traceId);
    if (!task) return (await this.repository.find(owner, id)) ? 'conflict' : 'missing';
    this.events.emit(
      'task.updated',
      new TaskEvent(owner.tenantId, owner.userId, id, traceId, task.status as TaskStatus),
    );
    return toWorkTask(task);
  }

  async action(owner: TaskOwner, id: string, action: TaskAction): Promise<TaskMutation> {
    const existing = await this.repository.find(owner, id);
    if (!existing) return 'missing';
    if (action === 'retry') {
      const agent = existing.agent_id ? await this.agents.find(owner, existing.agent_id) : undefined;
      if (!this.queue || !agent?.enabled) return 'conflict';
    }
    const traceId = this.traceId();
    const next = await this.repository.transition(owner, id, action, traceId);
    if (!next) return 'conflict';
    this.events.emit(
      taskEvents[next.status as TaskStatus],
      new TaskEvent(owner.tenantId, owner.userId, id, traceId, next.status as TaskStatus),
    );
    return toWorkTask(next);
  }

  async run(job: TaskJob, finalAttempt: boolean) {
    const context = await this.repository.runContext(job);
    if (!context) return;
    const agent = context.task.agent_id ? await this.agents.find(job, context.task.agent_id) : undefined;
    if (!agent?.enabled) {
      await this.setState(job, 'failed');
      return;
    }
    await this.setState(job, 'running');
    // The task may have been cancelled between the state read and this claim.
    if (!(await this.repository.runContext(job))) return;

    const input = [context.task.title, context.task.description].filter(Boolean).join('\n\n');
    try {
      const prompt = await this.agents.prompt(agent, context.name);
      const result = await this.completion.complete(job, {
        role: 'agent.task',
        version: `2.agent${agent.revision}`,
        messages: buildMessages(input, [], context.name, prompt),
      });
      await this.setState(job, 'done', result);
    } catch (error) {
      if (!finalAttempt && canRetryModel(error)) throw error;
      await this.setState(job, 'failed');
      throw new UnrecoverableError('Task generation failed');
    }
  }

  private async syncQueue(owner: TaskOwner, row: TaskRow) {
    if (!this.queue || !row.run_id || !['planned', 'running'].includes(row.status)) return row;
    const payload = { ...owner, taskId: row.id, runId: row.run_id, traceId: row.trace_id };
    const jobId = taskJobId(payload);
    try {
      const stored = await this.queue.getJob(jobId);
      if (!stored) {
        await this.queue.add('run', payload, {
          jobId,
          ...modelJobOptions,
        });
      } else if ((await stored.getState()) === 'failed') {
        await this.setState(payload, 'failed');
        return (await this.repository.find(owner, row.id)) ?? row;
      }
    } catch {
      this.logger.warn({ taskId: row.id, traceId: row.trace_id }, 'Task awaits queue recovery');
    }
    return row;
  }

  private async setState(job: TaskJob, status: 'running' | 'done' | 'failed', result?: string) {
    if (await this.repository.updateRun(job, status, result)) {
      this.events.emit(
        taskEvents[status],
        new TaskEvent(job.tenantId, job.userId, job.taskId, job.traceId, status),
      );
    }
  }

  private traceId() {
    return this.context.getId() ?? randomUUID();
  }
}

function sameTask(row: TaskRow, input: CreateWorkTask) {
  return (
    !row.turn_id &&
    row.title === input.title &&
    row.description === input.description &&
    row.due_on === input.dueOn &&
    row.agent_id === input.agentId
  );
}
