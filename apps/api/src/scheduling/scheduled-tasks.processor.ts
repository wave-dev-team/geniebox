import { type Job, UnrecoverableError } from 'bullmq';
import { sql } from 'kysely';
import { z } from 'zod';

import { Processor } from '@nestjs/bullmq';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../common/context/app-cls-store.js';
import { runInContext } from '../common/context/run-in-context.js';
import { AccountDb } from '../database/scoped-db.js';
import { isFinalAttempt, LoggedWorkerHost } from '../queues/logged-worker-host.js';
import { QUEUES } from '../queues/queues.js';
import { ScheduledTaskRegistry } from './scheduled-task.registry.js';

const MAX_ERROR_LENGTH = 2_000;

export const scheduledTaskJobSchema = z.object({
  taskId: z.uuid(),
  accountId: z.uuid(),
  traceId: z.string().min(1),
});
export type ScheduledTaskJob = z.infer<typeof scheduledTaskJobSchema>;

@Processor(QUEUES.SCHEDULED_TASKS_RUN, { concurrency: 5 })
export class ScheduledTasksProcessor extends LoggedWorkerHost {
  constructor(
    private readonly accountDb: AccountDb,
    private readonly registry: ScheduledTaskRegistry,
    private readonly cls: ClsService<AppClsStore>,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const parsed = scheduledTaskJobSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError(`Invalid scheduled task job: ${parsed.error.message}`);
    }
    const { taskId, accountId, traceId } = parsed.data;

    await runInContext(this.cls, { traceId, accountId }, async () => {
      const task = await this.accountDb.transaction((tx) =>
        tx.db
          .updateTable('scheduled_tasks')
          .set((eb) => ({ attempts: eb('attempts', '+', 1) }))
          .where('id', '=', taskId)
          // The sweeper enqueues before it commits, so a fast job may still see 'pending';
          // the row lock makes this UPDATE wait for that commit instead of skipping the task.
          .where('status', 'in', ['pending', 'enqueued'])
          .where('run_at', '<=', sql<Date>`now()`)
          .returning(['id', 'type', 'payload', 'run_at'])
          .executeTakeFirst(),
      );
      if (!task) {
        // Cancelled or already finished: nothing to do.
        return;
      }

      try {
        const handler = this.registry.get(task.type);
        if (!handler) {
          throw new UnrecoverableError(`No handler for scheduled task type "${task.type}"`);
        }
        const payload = handler.payloadSchema.safeParse(task.payload);
        if (!payload.success) {
          throw new UnrecoverableError(`Invalid payload for "${task.type}": ${payload.error.message}`);
        }
        await handler.handle(payload.data, { taskId, accountId, runAt: task.run_at });
        await this.setStatus(taskId, 'succeeded', null);
      } catch (error) {
        if (error instanceof UnrecoverableError || isFinalAttempt(job)) {
          await this.setStatus(taskId, 'failed', error);
        }
        throw error;
      }
    });
  }

  private async setStatus(taskId: string, status: 'succeeded' | 'failed', error: unknown): Promise<void> {
    const message =
      error === null
        ? null
        : (error instanceof Error ? error.message : 'Unknown error').slice(0, MAX_ERROR_LENGTH);
    await this.accountDb.transaction((tx) =>
      tx.db
        .updateTable('scheduled_tasks')
        .set({ status, last_error: message })
        .where('id', '=', taskId)
        .execute(),
    );
  }
}
