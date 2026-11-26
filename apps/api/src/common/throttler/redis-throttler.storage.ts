import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';

import { AppRedis } from '../redis/app-redis.js';

const responseSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const slidingWindow = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockFor = tonumber(ARGV[3])
local blocked = redis.call('PTTL', KEYS[2])
if blocked > 0 then return {limit + 1, blocked, 1, blocked} end

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[1])
if count >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local retry = math.max(1, tonumber(oldest[2]) + window - now)
  if blockFor > 0 then
    redis.call('SET', KEYS[2], '1', 'PX', blockFor)
    redis.call('DEL', KEYS[1])
    retry = blockFor
  end
  return {count + 1, retry, 1, retry}
end
redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('PEXPIRE', KEYS[1], window)
return {count + 1, window, 0, 0}
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: AppRedis) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, name: string) {
    const prefix = `geniebox:throttle:{${key}}:${name}`;
    try {
      const [totalHits, reset, blocked, retry] = responseSchema.parse(
        await this.redis.client.eval(
          slidingWindow,
          2,
          `${prefix}:hits`,
          `${prefix}:block`,
          ttl,
          limit,
          blockDuration,
          randomUUID(),
        ),
      );
      return {
        totalHits,
        timeToExpire: Math.ceil(reset / 1000),
        isBlocked: blocked === 1,
        timeToBlockExpire: Math.ceil(retry / 1000),
      };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
