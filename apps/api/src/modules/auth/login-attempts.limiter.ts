import type { Redis } from 'ioredis';

import { Inject, Injectable } from '@nestjs/common';

import { sha256 } from '../../common/crypto.js';
import { STATE_REDIS } from '../../common/redis/redis.module.js';

const MAX_FAILURES = 10;
const WINDOW_SEC = 15 * 60;

const key = (email: string): string => `auth:login-failures:${sha256(email)}`;

/** Per-email password guessing limit, on top of the per-IP throttler. */
@Injectable()
export class LoginAttemptsLimiter {
  constructor(@Inject(STATE_REDIS) private readonly redis: Redis) {}

  async isLocked(email: string): Promise<boolean> {
    return Number(await this.redis.get(key(email))) >= MAX_FAILURES;
  }

  async recordFailure(email: string): Promise<void> {
    await this.redis.multi().incr(key(email)).expire(key(email), WINDOW_SEC, 'NX').exec();
  }

  async reset(email: string): Promise<void> {
    await this.redis.del(key(email));
  }
}
