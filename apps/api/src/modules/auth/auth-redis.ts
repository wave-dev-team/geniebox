import { Redis } from 'ioredis';

import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthRedis implements OnApplicationShutdown {
  readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 3_000,
    });
  }

  async get() {
    if (this.client.status === 'wait') {
      await this.client.connect();
    }
    return this.client;
  }

  onApplicationShutdown() {
    this.client.disconnect();
  }
}
