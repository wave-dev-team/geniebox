import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';

import { DatabaseModule } from '../../database/database.module.js';
import { JournalModule } from '../../journal/journal.module.js';
import { OutboxModule } from '../../outbox/outbox.module.js';
import { ModelQueueModule } from '../../queues/model-queue.module.js';
import { QueueRootModule } from '../../queues/queue-root.module.js';
import { AgentsModule } from '../agents/agents.module.js';
import { RuntimeModule } from '../runtime/runtime.module.js';
import { UsersDataModule } from '../users/users.module.js';
import { TasksController } from './tasks.controller.js';
import { TasksProcessor } from './tasks.processor.js';
import { TasksRepository } from './tasks.repository.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [
    DatabaseModule,
    OutboxModule,
    JournalModule,
    AgentsModule,
    RuntimeModule,
    UsersDataModule,
    ConditionalModule.registerWhen(ModelQueueModule, (env) => Boolean(env.LLM_BASE_URL), { debug: false }),
  ],
  exports: [TasksRepository, TasksService],
  providers: [TasksRepository, TasksService],
})
export class TasksDataModule {}

@Module({ imports: [TasksDataModule], controllers: [TasksController], exports: [TasksDataModule] })
export class TasksModule {}

@Module({ imports: [TasksDataModule, QueueRootModule], providers: [TasksProcessor] })
export class TasksWorkerModule {}
