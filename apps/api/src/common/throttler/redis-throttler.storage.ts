import type { Redis } from 'ioredis';

import { Inject, Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';

import { STATE_REDIS } from '../redis/redis.module.js';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

// Atomic fixed-window counter with blocking. Returns hits, window TTL ms, block TTL ms.
const INCREMENT_SCRIPT = `
local hitsKey = KEYS[1]
local blockKey = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])

local blockTtl = redis.call("PTTL", blockKey)
if blockTtl > 0 then
  return { limit + 1, redis.call("PTTL", hitsKey), blockTtl }
end

local hits = redis.call("INCR", hitsKey)
if hits == 1 then
  redis.call("PEXPIRE", hitsKey, ttl)
end
local hitsTtl = redis.call("PTTL", hitsKey)

if hits > limit then
  redis.call("SET", blockKey, "1", "PX", blockDuration)
  return { hits, hitsTtl, blockDuration }
end
return { hits, hitsTtl, 0 }
`;

/** Throttler state in durable Redis so limits hold across instances and restarts. */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(@Inject(STATE_REDIS) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const prefix = `throttle:${throttlerName}:${key}`;
    const result = (await this.redis.eval(
      INCREMENT_SCRIPT,
      2,
      `${prefix}:hits`,
      `${prefix}:block`,
      ttl,
      limit,
      blockDuration,
    )) as [number, number, number];
    const [totalHits, hitsTtlMs, blockTtlMs] = result;
    return {
      totalHits,
      timeToExpire: Math.max(0, Math.ceil(hitsTtlMs / 1000)),
      isBlocked: blockTtlMs > 0,
      timeToBlockExpire: Math.max(0, Math.ceil(blockTtlMs / 1000)),
    };
  }
}
