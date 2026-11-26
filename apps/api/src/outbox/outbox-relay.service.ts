import type { Queue } from 'bullmq';
import { sql } from 'kysely';

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import { OutboxDirectory } from '../database/outbox-directory.js';
import { type RequestContext, TenantDb } from '../database/tenant-db.js';
import {
  type ChatJob,
  chatJobId,
  chatQueue,
  modelJobOptions,
  type TaskJob,
  taskJobId,
  tasksQueue,
} from '../queues/jobs.js';
import { outboxEventSchema } from './outbox.types.js';

@Injectable()
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;

  constructor(
    private readonly directory: OutboxDirectory,
    private readonly db: TenantDb,
    private readonly context: ClsService<RequestContext>,
    @InjectQueue(chatQueue) private readonly chat: Queue<ChatJob>,
    @InjectQueue(tasksQueue) private readonly tasks: Queue<TaskJob>,
  ) {}

  onModuleInit() {
    const sweep = () => {
      this.running ??= this.flush()
        .catch(() => this.logger.warn('Outbox delivery sweep failed'))
        .finally(() => {
          this.running = undefined;
        });
    };
    sweep();
    this.timer = setInterval(sweep, 750);
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
  }

  async flush() {
    for (const entry of await this.directory.due()) {
      await this.context.runWith({ tenantId: entry.tenant_id }, () => this.deliver(entry.id));
    }
  }

  private deliver(id: string) {
    return this.db.transaction(async (tx) => {
      const entry = await tx
        .selectFrom('outbox_events')
        .selectAll()
        .where('id', '=', id)
        .where('published_at', 'is', null)
        .where('failed_at', 'is', null)
        .where('next_attempt_at', '<=', sql<Date>`now()`)
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!entry) return;

      const update = tx
        .updateTable('outbox_events')
        .where('tenant_id', '=', entry.tenant_id)
        .where('id', '=', id);
      const event = outboxEventSchema.safeParse({ type: entry.type, payload: entry.payload });
      if (
        !event.success ||
        event.data.payload.tenantId !== entry.tenant_id ||
        event.data.payload.traceId !== entry.trace_id
      ) {
        await update.set({ failed_at: sql`clock_timestamp()` }).execute();
        this.logger.error({ id, traceId: entry.trace_id }, 'Invalid outbox event');
        return;
      }
      try {
        if (event.data.type === 'chat.requested') {
          await this.chat.add('generate', event.data.payload, {
            ...modelJobOptions,
            jobId: chatJobId(event.data.payload),
          });
        } else {
          await this.tasks.add('run', event.data.payload, {
            ...modelJobOptions,
            jobId: taskJobId(event.data.payload),
          });
        }
      } catch {
        const delay = Math.min(120_000, 1000 * 2 ** Math.min(entry.attempts, 7));
        await update
          .set({
            attempts: entry.attempts + 1,
            next_attempt_at: new Date(Date.now() + delay),
          })
          .execute();
        this.logger.warn(
          { id, traceId: entry.trace_id, attempt: entry.attempts + 1 },
          'Outbox delivery will retry',
        );
        return;
      }
      await update.set({ published_at: sql`clock_timestamp()` }).execute();
    });
  }
}
