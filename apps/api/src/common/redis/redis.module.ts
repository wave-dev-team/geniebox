import { Redis } from 'ioredis';

import { Global, Inject, Injectable, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema.js';

/** Durable Redis: queues, throttling, locks, token state. */
export const STATE_REDIS = Symbol('STATE_REDIS');
/** Disposable Redis: cache only. */
export const CACHE_REDIS = Symbol('CACHE_REDIS');

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  private readonly logger = new Logger('Redis');

  constructor(
    @Inject(STATE_REDIS) private readonly state: Redis,
    @Inject(CACHE_REDIS) private readonly cache: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.state.quit(), this.cache.quit()]);
    this.logger.log('Redis connections closed');
  }
}

function createClient(url: string, name: string): Redis {
  return new Redis(url, { connectionName: name });
}

@Global()
@Module({
  providers: [
    {
      provide: STATE_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createClient(config.get('REDIS_STATE_URL', { infer: true }), 'geniebox:state'),
    },
    {
      provide: CACHE_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createClient(config.get('REDIS_CACHE_URL', { infer: true }), 'geniebox:cache'),
    },
    RedisLifecycle,
  ],
  exports: [STATE_REDIS, CACHE_REDIS],
})
export class RedisModule {}
