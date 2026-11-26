import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { RedisModule } from '../redis/redis.module.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

@Module({ imports: [RedisModule], providers: [RedisThrottlerStorage], exports: [RedisThrottlerStorage] })
class ThrottlerStorageModule {}

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [ThrottlerStorageModule],
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        throttlers: [{ ttl: 60_000, limit: 120 }],
        storage,
      }),
    }),
  ],
  exports: [ThrottlerModule],
})
export class AppThrottlerModule {}
