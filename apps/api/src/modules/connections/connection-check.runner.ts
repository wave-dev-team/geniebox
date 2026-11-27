import { type Queue, QueueEvents } from 'bullmq';

import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../../common/context/app-cls-store.js';
import type { Env } from '../../config/env.schema.js';
import { QUEUES } from '../../queues/queues.js';
import type { CheckOutcome, ConnectionCheckJob } from './connection-check.types.js';

export const CHECK_QUEUE_EVENTS = Symbol('CHECK_QUEUE_EVENTS');

export const checkQueueEventsProvider = {
  provide: CHECK_QUEUE_EVENTS,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): QueueEvents => {
    const url: string = config.get('REDIS_STATE_URL', { infer: true });
    return new QueueEvents(QUEUES.CONNECTIONS_CHECK, {
      connection: { url, maxRetriesPerRequest: null },
      prefix: 'geniebox',
    });
  },
};

/**
 * API side of a check. The API cannot open secrets, so it asks the worker and waits for the
 * answer. If the worker is slow the call
 * returns null and the status updates when the job finishes.
 */
@Injectable()
export class ConnectionCheckRunner implements OnApplicationShutdown {
  private readonly logger = new Logger(ConnectionCheckRunner.name);
  private readonly waitMs: number;

  constructor(
    @InjectQueue(QUEUES.CONNECTIONS_CHECK) private readonly queue: Queue<ConnectionCheckJob>,
    @Inject(CHECK_QUEUE_EVENTS) private readonly events: QueueEvents,
    private readonly cls: ClsService<AppClsStore>,
    config: ConfigService<Env, true>,
  ) {
    // The provider call has its own timeout; leave room for queueing and bookkeeping.
    this.waitMs = config.get('CONNECTION_CHECK_TIMEOUT_MS', { infer: true }) + 5_000;
  }

  /** Import answer at once: the check runs in the background and updates the status later. */
  async enqueue(connection: { id: string; account_id: string }, userId: string | null): Promise<void> {
    await this.queue.add('check', {
      connectionId: connection.id,
      accountId: connection.account_id,
      userId,
      traceId: this.cls.getId() ?? connection.id,
    });
  }

  async runAndWait(
    connection: { id: string; account_id: string },
    userId: string | null,
  ): Promise<CheckOutcome | null> {
    const job = await this.queue.add('check', {
      connectionId: connection.id,
      accountId: connection.account_id,
      userId,
      traceId: this.cls.getId() ?? connection.id,
    });
    try {
      return (await job.waitUntilFinished(this.events, this.waitMs)) as CheckOutcome | null;
    } catch (error) {
      this.logger.warn(
        { err: error, connectionId: connection.id },
        'Connection check did not finish in time',
      );
      return null;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.events.close();
  }
}
