import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RedisModule } from '../../common/redis/redis.module.js';
import { DatabaseModule } from '../../database/database.module.js';
import { ModelCallsRepository } from './model-calls.repository.js';
import { ModelProvider } from './model-provider.js';
import { RuntimeService } from './runtime.service.js';

@Module({
  imports: [
    RedisModule,
    DatabaseModule,
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
  ],
  providers: [RuntimeService, ModelProvider, ModelCallsRepository],
  exports: [RuntimeService],
})
export class RuntimeModule {}
