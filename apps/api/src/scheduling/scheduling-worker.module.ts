import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { QUEUE_JOB_OPTIONS, QUEUES } from '../queues/queues.js';
import { ScheduledTasksProcessor } from './scheduled-tasks.processor.js';
import { ScheduledTasksSweeper } from './scheduled-tasks.sweeper.js';

@Module({
  imports: [
    BullModule.registerQueue(
      {
        name: QUEUES.SCHEDULED_TASKS_SWEEP,
        defaultJobOptions: QUEUE_JOB_OPTIONS[QUEUES.SCHEDULED_TASKS_SWEEP],
      },
      {
        name: QUEUES.SCHEDULED_TASKS_RUN,
        defaultJobOptions: QUEUE_JOB_OPTIONS[QUEUES.SCHEDULED_TASKS_RUN],
      },
    ),
  ],
  providers: [ScheduledTasksSweeper, ScheduledTasksProcessor],
  exports: [ScheduledTasksSweeper],
})
export class SchedulingWorkerModule {}
