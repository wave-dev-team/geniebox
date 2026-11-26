import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { QueueRootModule } from '../../queues/queue-root.module.js';
import { mailQueue } from './mail.types.js';

@Module({
  imports: [QueueRootModule, BullModule.registerQueue({ name: mailQueue })],
  exports: [BullModule],
})
export class MailQueueModule {}
