import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigService } from '@nestjs/config';

import { DatabaseModule } from '../../database/database.module.js';
import { AgentsModule } from '../agents/agents.module.js';
import { ChatController } from './chat.controller.js';
import { ChatProcessor } from './chat.processor.js';
import { ChatRepository } from './chat.repository.js';
import { ChatService } from './chat.service.js';
import { ChatCompletion, chatQueue } from './chat-completion.js';
import { ChatDelegation } from './chat-delegation.js';
import { ChatModel } from './chat-model.js';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = new URL(config.getOrThrow<string>('REDIS_URL'));
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            username: decodeURIComponent(url.username) || undefined,
            password: decodeURIComponent(url.password) || undefined,
            db: Number(url.pathname.slice(1) || 0),
            tls: url.protocol === 'rediss:' ? {} : undefined,
            connectTimeout: 3000,
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
          },
        };
      },
    }),
    BullModule.registerQueue({ name: chatQueue }),
  ],
  exports: [BullModule],
})
class ChatQueueModule {}

@Module({
  imports: [
    DatabaseModule,
    AgentsModule,
    ConditionalModule.registerWhen(ChatQueueModule, (env) => Boolean(env.LLM_BASE_URL), { debug: false }),
  ],
  controllers: [ChatController],
  providers: [ChatRepository, ChatModel, ChatCompletion, ChatDelegation, ChatService, ChatProcessor],
})
export class ChatModule {}
