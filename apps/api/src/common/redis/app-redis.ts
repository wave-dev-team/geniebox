import { Redis } from 'ioredis';

import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppRedis implements OnApplicationShutdown {
  readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      // The first command starts the connection and concurrent commands share it.
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 3_000,
    });
  }

  onApplicationShutdown() {
    this.client.disconnect();
  }
}
