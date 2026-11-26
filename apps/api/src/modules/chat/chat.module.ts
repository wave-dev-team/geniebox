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
import { ChatController } from './chat.controller.js';
import { ChatProcessor } from './chat.processor.js';
import { ChatRepository } from './chat.repository.js';
import { ChatService } from './chat.service.js';
import { ChatDelegation } from './chat-delegation.js';

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
  exports: [ChatService],
  providers: [ChatRepository, ChatDelegation, ChatService],
})
export class ChatDataModule {}

@Module({ imports: [ChatDataModule], controllers: [ChatController], exports: [ChatDataModule] })
export class ChatModule {}

@Module({ imports: [ChatDataModule, QueueRootModule], providers: [ChatProcessor] })
export class ChatWorkerModule {}
