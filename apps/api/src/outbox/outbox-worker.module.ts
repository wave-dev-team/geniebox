import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { QUEUE_JOB_OPTIONS, QUEUES } from '../queues/queues.js';
import { OutboxEventsProcessor } from './outbox-events.processor.js';
import { OutboxRelay } from './outbox-relay.service.js';

@Module({
  imports: [
    BullModule.registerQueue({
      name: QUEUES.OUTBOX_EVENTS,
      defaultJobOptions: QUEUE_JOB_OPTIONS[QUEUES.OUTBOX_EVENTS],
    }),
  ],
  providers: [OutboxRelay, OutboxEventsProcessor],
  exports: [OutboxRelay],
})
export class OutboxWorkerModule {}
