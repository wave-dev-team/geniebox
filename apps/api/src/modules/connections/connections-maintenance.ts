import { randomUUID } from 'node:crypto';

import type { Queue } from 'bullmq';
import { sql } from 'kysely';

import { InjectQueue, Processor } from '@nestjs/bullmq';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema.js';
import { SystemDb } from '../../database/system-db.js';
import { LoggedWorkerHost } from '../../queues/logged-worker-host.js';
import { jobId, QUEUES } from '../../queues/queues.js';
import type { ConnectionCheckJob } from './connection-check.types.js';

const SCHEDULER_ID = 'connections-maintenance';
const EVERY_MS = 15 * 60 * 1000;
const RECHECK_BATCH = 200;

/**
 * Every 15 minutes: destroys replaced credentials whose grace period ended and queues
 * re-checks of connections not checked for CONNECTION_RECHECK_HOURS. SystemDb: cross-account,
 * ids and timestamps only.
 */
@Processor(QUEUES.CONNECTIONS_MAINTENANCE, { concurrency: 1 })
export class ConnectionsMaintenance extends LoggedWorkerHost implements OnApplicationBootstrap {
  private readonly recheckHours: number;

  constructor(
    private readonly systemDb: SystemDb,
    @InjectQueue(QUEUES.CONNECTIONS_MAINTENANCE) private readonly queue: Queue,
    @InjectQueue(QUEUES.CONNECTIONS_CHECK) private readonly checks: Queue<ConnectionCheckJob>,
    config: ConfigService<Env, true>,
  ) {
    super();
    this.recheckHours = config.get('CONNECTION_RECHECK_HOURS', { infer: true });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(SCHEDULER_ID, { every: EVERY_MS });
  }

  async process(): Promise<{ purged: number; rechecks: number }> {
    return this.run();
  }

  /** Public for tests. */
  async run(): Promise<{ purged: number; rechecks: number }> {
    const { purged, due } = await this.systemDb.transaction(async (trx) => {
      const deleted = await trx
        .deleteFrom('connection_credentials')
        .where('status', '=', 'retiring')
        .where('retire_at', '<=', new Date())
        .executeTakeFirst();
      const due = await trx
        .selectFrom('connections')
        .select(['id', 'account_id'])
        .where('deleted_at', 'is', null)
        .where((eb) =>
          eb.or([
            eb('last_check_at', 'is', null),
            eb('last_check_at', '<', sql<Date>`now() - make_interval(hours => ${this.recheckHours})`),
          ]),
        )
        .orderBy('last_check_at', (ob) => ob.nullsFirst())
        .limit(RECHECK_BATCH)
        .execute();
      return { purged: Number(deleted.numDeletedRows), due };
    });
    if (due.length > 0) {
      await this.checks.addBulk(
        due.map((row) => ({
          name: 'recheck',
          data: {
            connectionId: row.id,
            accountId: row.account_id,
            userId: null,
            traceId: randomUUID(),
          },
          // Deduplicated while a re-check of the same connection is still queued or recent.
          opts: { jobId: jobId('recheck', row.id) },
        })),
      );
    }
    return { purged, rechecks: due.length };
  }
}
