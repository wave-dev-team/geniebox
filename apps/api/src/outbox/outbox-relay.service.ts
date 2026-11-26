import type { Queue } from 'bullmq';

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.schema.js';
import { SystemDb } from '../database/system-db.js';
import { jobId, QUEUES } from '../queues/queues.js';
import type { OutboxEnvelope } from './outbox.types.js';

/**
 * Moves committed outbox rows into BullMQ. Runs in the worker process only.
 * Uses SystemDb: the relay is cross-account by design.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private running = false;
  private loop?: Promise<void>;
  private wakeUp?: () => void;

  constructor(
    private readonly systemDb: SystemDb,
    @InjectQueue(QUEUES.OUTBOX_EVENTS) private readonly queue: Queue,
    config: ConfigService<Env, true>,
  ) {
    this.pollIntervalMs = config.get('OUTBOX_POLL_INTERVAL_MS', { infer: true });
    this.batchSize = config.get('OUTBOX_BATCH_SIZE', { infer: true });
  }

  onApplicationBootstrap(): void {
    this.running = true;
    this.loop = this.run();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    this.wakeUp?.();
    await this.loop;
  }

  /** Publishes one batch. Returns the number of published events. Public for tests. */
  async relayBatch(): Promise<number> {
    return this.systemDb.transaction(async (trx) => {
      const rows = await trx
        .selectFrom('outbox_events')
        .select(['id', 'event_id', 'account_id', 'type', 'payload', 'trace_id', 'created_at'])
        .where('published_at', 'is', null)
        .orderBy('id')
        .limit(this.batchSize)
        .forUpdate()
        .skipLocked()
        .execute();
      if (rows.length === 0) {
        return 0;
      }

      // Enqueue before marking: a crash in between re-enqueues the same jobId, which BullMQ dedupes.
      await this.queue.addBulk(
        rows.map((row) => {
          const envelope: OutboxEnvelope = {
            eventId: row.event_id,
            type: row.type,
            accountId: row.account_id,
            traceId: row.trace_id,
            occurredAt: row.created_at.toISOString(),
            payload: row.payload,
          };
          return {
            name: row.type,
            data: envelope,
            opts: { jobId: jobId('outbox', row.event_id) },
          };
        }),
      );
      await trx
        .updateTable('outbox_events')
        .set({ published_at: new Date() })
        .where(
          'id',
          'in',
          rows.map((row) => row.id),
        )
        .execute();
      return rows.length;
    });
  }

  private async run(): Promise<void> {
    while (this.running) {
      let published = 0;
      try {
        published = await this.relayBatch();
      } catch (error) {
        this.logger.error({ err: error }, 'Outbox relay iteration failed');
      }
      // A full batch means more is waiting: continue without sleeping.
      if (published < this.batchSize) {
        await this.sleep(this.pollIntervalMs);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.wakeUp = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}
