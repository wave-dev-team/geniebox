import type { Queue } from 'bullmq';
import { sql } from 'kysely';

import { InjectQueue, Processor } from '@nestjs/bullmq';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.schema.js';
import { SystemDb } from '../database/system-db.js';
import { LoggedWorkerHost } from '../queues/logged-worker-host.js';
import { jobId, QUEUES } from '../queues/queues.js';
import type { ScheduledTaskJob } from './scheduled-tasks.processor.js';

const SWEEP_BATCH_SIZE = 500;
// An 'enqueued' task untouched this long most likely lost its job (e.g. Redis was wiped).
const STALE_ENQUEUED_AFTER = '15 minutes';
const SWEEP_SCHEDULER_ID = 'scheduled-tasks-sweep';

/**
 * Moves due tasks from Postgres into the run queue. Uses SystemDb: sweeping is cross-account.
 * Re-enqueueing reuses the task id as jobId, so a still-existing job is never duplicated.
 */
@Processor(QUEUES.SCHEDULED_TASKS_SWEEP, { concurrency: 1 })
export class ScheduledTasksSweeper extends LoggedWorkerHost implements OnApplicationBootstrap {
  private readonly intervalMs: number;

  constructor(
    private readonly systemDb: SystemDb,
    @InjectQueue(QUEUES.SCHEDULED_TASKS_SWEEP) private readonly sweepQueue: Queue,
    @InjectQueue(QUEUES.SCHEDULED_TASKS_RUN) private readonly runQueue: Queue<ScheduledTaskJob>,
    config: ConfigService<Env, true>,
  ) {
    super();
    this.intervalMs = config.get('SCHEDULED_TASKS_SWEEP_INTERVAL_MS', { infer: true });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.sweepQueue.upsertJobScheduler(SWEEP_SCHEDULER_ID, { every: this.intervalMs });
  }

  async process(): Promise<number> {
    return this.sweep();
  }

  /** Enqueues due tasks; returns how many. Public for tests. */
  async sweep(): Promise<number> {
    return this.systemDb.transaction(async (trx) => {
      const due = await trx
        .selectFrom('scheduled_tasks')
        .select(['id', 'account_id', 'trace_id'])
        .where('run_at', '<=', new Date())
        .where((eb) =>
          eb.or([
            eb('status', '=', 'pending'),
            eb.and([
              eb('status', '=', 'enqueued'),
              eb('updated_at', '<', sql<Date>`now() - ${STALE_ENQUEUED_AFTER}::interval`),
            ]),
          ]),
        )
        .orderBy('run_at')
        .limit(SWEEP_BATCH_SIZE)
        .forUpdate()
        .skipLocked()
        .execute();
      if (due.length === 0) {
        return 0;
      }

      await this.runQueue.addBulk(
        due.map((task) => ({
          name: 'run',
          data: { taskId: task.id, accountId: task.account_id, traceId: task.trace_id },
          opts: { jobId: jobId('task', task.id) },
        })),
      );
      await trx
        .updateTable('scheduled_tasks')
        .set({ status: 'enqueued' })
        .where(
          'id',
          'in',
          due.map((task) => task.id),
        )
        .execute();
      return due.length;
    });
  }
}
