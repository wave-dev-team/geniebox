import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { chatQueue, tasksQueue } from './jobs.js';
import { QueueRootModule } from './queue-root.module.js';

@Module({
  imports: [QueueRootModule, BullModule.registerQueue({ name: chatQueue }, { name: tasksQueue })],
  exports: [BullModule],
})
export class ModelQueueModule {}
