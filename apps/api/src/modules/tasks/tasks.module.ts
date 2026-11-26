import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';

import { DatabaseModule } from '../../database/database.module.js';
import { AgentsModule } from '../agents/agents.module.js';
import { RuntimeModule } from '../runtime/runtime.module.js';
import { TasksController } from './tasks.controller.js';
import { TasksProcessor } from './tasks.processor.js';
import { TasksRepository } from './tasks.repository.js';
import { tasksQueue, TasksService } from './tasks.service.js';

@Module({
  imports: [BullModule.registerQueue({ name: tasksQueue })],
  exports: [BullModule],
})
class TaskQueueModule {}

@Module({
  imports: [
    DatabaseModule,
    AgentsModule,
    RuntimeModule,
    ConditionalModule.registerWhen(TaskQueueModule, (env) => Boolean(env.LLM_BASE_URL), { debug: false }),
  ],
  controllers: [TasksController],
  providers: [TasksRepository, TasksService, TasksProcessor],
})
export class TasksModule {}
