import { type Job, UnrecoverableError } from 'bullmq';

import { Processor } from '@nestjs/bullmq';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../../common/context/app-cls-store.js';
import { runInContext } from '../../common/context/run-in-context.js';
import { LoggedWorkerHost } from '../../queues/logged-worker-host.js';
import { QUEUES } from '../../queues/queues.js';
import { ConversationTurn } from './conversation-turn.js';
import { taskJobSchema, turnJobSchema } from './runtime.jobs.js';
import { TaskRunner } from './task-runner.js';

@Processor(QUEUES.AGENT_TURNS, { concurrency: 8 })
export class AgentTurnsProcessor extends LoggedWorkerHost {
  constructor(
    private readonly turn: ConversationTurn,
    private readonly cls: ClsService<AppClsStore>,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const parsed = turnJobSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError(`Invalid turn job: ${parsed.error.message}`);
    const data = parsed.data;
    await runInContext(
      this.cls,
      { traceId: data.traceId, accountId: data.accountId, userId: data.userId },
      () => this.turn.run(data),
    );
  }
}

@Processor(QUEUES.AGENT_TASKS, { concurrency: 8 })
export class AgentTasksProcessor extends LoggedWorkerHost {
  constructor(
    private readonly runner: TaskRunner,
    private readonly cls: ClsService<AppClsStore>,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const parsed = taskJobSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError(`Invalid task job: ${parsed.error.message}`);
    const data = parsed.data;
    await runInContext(
      this.cls,
      { traceId: data.traceId, accountId: data.accountId, userId: data.userId },
      () => this.runner.run(data),
    );
  }
}
