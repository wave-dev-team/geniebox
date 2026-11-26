import { randomInt } from 'node:crypto';

import type { Redis } from 'ioredis';

import { Inject, Injectable } from '@nestjs/common';

import { safeEqualHex, sha256 } from '../../../common/crypto.js';
import { STATE_REDIS } from '../../../common/redis/redis.module.js';

export const EMAIL_CODE_PURPOSES = ['login', 'verify_email', 'reset_password'] as const;
export type EmailCodePurpose = (typeof EMAIL_CODE_PURPOSES)[number];

export const EMAIL_CODE_TTL_MINUTES = 10;
const CODE_TTL_SEC = EMAIL_CODE_TTL_MINUTES * 60;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_ATTEMPTS = 5;

const codeKey = (purpose: EmailCodePurpose, email: string): string => `auth:code:${purpose}:${sha256(email)}`;

// Increments attempts and returns {codeHash, attempts}; burns the code past the limit.
const ATTEMPT_SCRIPT = `
local hash = redis.call("HGET", KEYS[1], "codeHash")
if not hash then return {"", 0} end
local attempts = redis.call("HINCRBY", KEYS[1], "attempts", 1)
if attempts > tonumber(ARGV[1]) then
  redis.call("DEL", KEYS[1])
  return {"", attempts}
end
return {hash, attempts}
`;

export type IssueCodeResult = { status: 'issued'; code: string } | { status: 'cooldown' };

/** Six-digit one-time codes in durable Redis; only the hash is stored. */
@Injectable()
export class EmailCodeStore {
  constructor(@Inject(STATE_REDIS) private readonly redis: Redis) {}

  async issue(purpose: EmailCodePurpose, email: string): Promise<IssueCodeResult> {
    const key = codeKey(purpose, email);
    const sentAt = await this.redis.hget(key, 'sentAt');
    if (sentAt && Date.now() - Number(sentAt) < RESEND_COOLDOWN_MS) {
      return { status: 'cooldown' };
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.redis
      .multi()
      .del(key)
      .hset(key, { codeHash: sha256(code), attempts: '0', sentAt: String(Date.now()) })
      .expire(key, CODE_TTL_SEC)
      .exec();
    return { status: 'issued', code };
  }

  /** True exactly once for a correct code; the code is consumed on success. */
  async consume(purpose: EmailCodePurpose, email: string, code: string): Promise<boolean> {
    const key = codeKey(purpose, email);
    const [storedHash] = (await this.redis.eval(ATTEMPT_SCRIPT, 1, key, MAX_ATTEMPTS)) as [string, number];
    if (!storedHash || !/^\d{6}$/.test(code) || !safeEqualHex(storedHash, sha256(code))) {
      return false;
    }
    // DEL as the gate: two concurrent correct submissions cannot both succeed.
    return (await this.redis.del(key)) === 1;
  }
}
