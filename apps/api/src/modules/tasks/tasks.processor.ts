import { type Job, UnrecoverableError } from 'bullmq';

import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { CLS_ID, ClsService } from 'nestjs-cls';

import type { RequestContext } from '../../database/tenant-db.js';
import { modelAttempts, type TaskJob, taskJobSchema, tasksQueue } from '../../queues/jobs.js';
import { TasksService } from './tasks.service.js';

@Processor(tasksQueue, { concurrency: 1 })
export class TasksProcessor extends WorkerHost {
  private readonly logger = new Logger(TasksProcessor.name);

  constructor(
    private readonly tasks: TasksService,
    private readonly context: ClsService<RequestContext>,
  ) {
    super();
  }

  async process(job: Job<TaskJob>) {
    const payload = taskJobSchema.safeParse(job.data);
    if (!payload.success) throw new UnrecoverableError('Invalid job payload');
    await this.context.runWith(
      { tenantId: payload.data.tenantId, [CLS_ID]: payload.data.traceId },
      async () => {
        try {
          await this.tasks.run(payload.data, job.attemptsMade + 1 >= modelAttempts);
        } catch (error) {
          if (error instanceof UnrecoverableError) throw error;
          throw new Error('Task generation failed');
        }
      },
    );
  }

  @OnWorkerEvent('failed')
  failed(job: Job<TaskJob> | undefined) {
    if (job)
      this.logger.warn(
        { traceId: job.data.traceId, taskId: job.data.taskId, attempt: job.attemptsMade },
        'Task job failed',
      );
  }

  @OnWorkerEvent('error')
  error() {
    this.logger.error('Task worker unavailable');
  }
}
