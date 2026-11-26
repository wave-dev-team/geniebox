import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';

import { DatabaseModule } from '../../database/database.module.js';
import { AgentsModule } from '../agents/agents.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import { RuntimeModule } from '../runtime/runtime.module.js';
import { ChatController } from './chat.controller.js';
import { ChatProcessor } from './chat.processor.js';
import { ChatRepository } from './chat.repository.js';
import { ChatService } from './chat.service.js';
import { ChatDelegation } from './chat-delegation.js';
import { chatQueue } from './chat-queue.js';

@Module({
  imports: [BullModule.registerQueue({ name: chatQueue })],
  exports: [BullModule],
})
class ChatQueueModule {}

@Module({
  imports: [
    DatabaseModule,
    AgentsModule,
    RuntimeModule,
    ProfileModule,
    ConditionalModule.registerWhen(ChatQueueModule, (env) => Boolean(env.LLM_BASE_URL), { debug: false }),
  ],
  controllers: [ChatController],
  providers: [ChatRepository, ChatDelegation, ChatService, ChatProcessor],
})
export class ChatModule {}
