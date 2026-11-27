import { type Job, UnrecoverableError } from 'bullmq';

import { Processor } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../common/context/app-cls-store.js';
import { runInContext } from '../common/context/run-in-context.js';
import { LoggedWorkerHost } from '../queues/logged-worker-host.js';
import { QUEUES } from '../queues/queues.js';
import { outboxEnvelopeSchema } from './outbox.types.js';

/** Delivers outbox events to in-process @OnOutboxEvent listeners inside the account context. */
@Processor(QUEUES.OUTBOX_EVENTS, { concurrency: 10 })
export class OutboxEventsProcessor extends LoggedWorkerHost {
  constructor(
    private readonly events: EventEmitter2,
    private readonly cls: ClsService<AppClsStore>,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const parsed = outboxEnvelopeSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError(`Invalid outbox envelope: ${parsed.error.message}`);
    }
    const envelope = parsed.data;
    await runInContext(this.cls, { traceId: envelope.traceId, accountId: envelope.accountId }, async () => {
      await this.events.emitAsync(envelope.type, envelope);
    });
  }
}
