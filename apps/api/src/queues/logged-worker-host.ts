import { type Job, UnrecoverableError } from 'bullmq';

import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';

/** Base processor: a job that exhausted its retries is logged at error level for alerting. */
export abstract class LoggedWorkerHost extends WorkerHost {
  protected readonly logger = new Logger(this.constructor.name);

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    if (!job) {
      this.logger.error({ err: error }, 'Job failed without job reference');
      return;
    }
    const attempts = job.opts.attempts ?? 1;
    const exhausted = job.attemptsMade >= attempts || error instanceof UnrecoverableError;
    const meta = { err: error, queue: job.queueName, jobId: job.id, attemptsMade: job.attemptsMade };
    if (exhausted) {
      this.logger.error(meta, 'Job failed permanently');
    } else {
      this.logger.warn(meta, 'Job failed, will retry');
    }
  }
}

export function isFinalAttempt(job: Job): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}
