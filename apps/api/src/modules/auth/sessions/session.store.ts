import { randomUUID } from 'node:crypto';

import type { Redis } from 'ioredis';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { randomToken, sha256 } from '../../../common/crypto.js';
import { STATE_REDIS } from '../../../common/redis/redis.module.js';
import type { Env } from '../../../config/env.schema.js';

const DAY_SECONDS = 86_400;
// A refresh racing with another refresh of the same token (two tabs) is not treated as theft.
const ROTATION_GRACE_MS = 10_000;

const sessionKey = (sessionId: string): string => `auth:session:${sessionId}`;
const userSessionsKey = (userId: string): string => `auth:user-sessions:${userId}`;

export interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

export interface SessionInfo {
  sessionId: string;
  createdAt: Date;
  /** Last refresh, i.e. the last time the client was active for more than an access TTL. */
  lastActiveAt: Date;
  userAgent: string | null;
  ip: string | null;
}

export interface IssuedRefreshToken {
  sessionId: string;
  refreshToken: string;
  expiresAt: Date;
}

export type RotationResult =
  | { status: 'rotated'; userId: string; sessionId: string; refreshToken: string; expiresAt: Date }
  | { status: 'invalid' }
  | { status: 'concurrent' }
  | { status: 'reused' };

// KEYS[1] session, KEYS[2] user sessions set. ARGV: presentedHash, newHash, nowMs, ttlSec,
// maxAgeMs, graceMs, sessionId. Returns {code, userId}: 1 rotated, 0 invalid, 2 concurrent,
// -1 reused.
const ROTATE_SCRIPT = `
local s = redis.call("HMGET", KEYS[1], "userId", "refreshHash", "prevHash", "rotatedAt", "createdAt")
local userId, current, prev, rotatedAt, createdAt = s[1], s[2], s[3], s[4], s[5]
if not userId then return {0, ""} end
local now = tonumber(ARGV[3])
local maxAge = tonumber(ARGV[5])
if now - tonumber(createdAt) > maxAge then
  redis.call("DEL", KEYS[1])
  redis.call("SREM", KEYS[2], ARGV[7])
  return {0, ""}
end
if current == ARGV[1] then
  redis.call("HSET", KEYS[1], "refreshHash", ARGV[2], "prevHash", current, "rotatedAt", ARGV[3])
  redis.call("EXPIRE", KEYS[1], ARGV[4])
  return {1, userId}
end
if prev == ARGV[1] and rotatedAt and now - tonumber(rotatedAt) <= tonumber(ARGV[6]) then
  return {2, userId}
end
-- A stale or forged secret for a live session: assume theft and kill the session.
redis.call("DEL", KEYS[1])
redis.call("SREM", KEYS[2], ARGV[7])
return {-1, userId}
`;

/**
 * Sessions live in durable Redis. Refresh token = `<sessionId>.<secret>`;
 * only sha256(secret) is stored. Access tokens carry the session id, so deleting the session
 * revokes them immediately.
 */
@Injectable()
export class SessionStore {
  private readonly ttlSec: number;
  private readonly maxAgeMs: number;

  constructor(
    @Inject(STATE_REDIS) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.ttlSec = config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * DAY_SECONDS;
    this.maxAgeMs = config.get('REFRESH_TOKEN_MAX_AGE_DAYS', { infer: true }) * DAY_SECONDS * 1000;
  }

  async create(userId: string, meta: SessionMeta): Promise<IssuedRefreshToken> {
    const sessionId = randomUUID();
    const secret = randomToken();
    const now = Date.now();
    await this.redis
      .multi()
      .hset(sessionKey(sessionId), {
        userId,
        refreshHash: sha256(secret),
        createdAt: String(now),
        userAgent: (meta.userAgent ?? '').slice(0, 256),
        ip: meta.ip ?? '',
      })
      .expire(sessionKey(sessionId), this.ttlSec)
      .sadd(userSessionsKey(userId), sessionId)
      .exec();
    return { sessionId, refreshToken: `${sessionId}.${secret}`, expiresAt: this.expiry(now) };
  }

  async rotate(refreshToken: string): Promise<RotationResult> {
    const parsed = parseRefreshToken(refreshToken);
    if (!parsed) {
      return { status: 'invalid' };
    }
    const userId = await this.redis.hget(sessionKey(parsed.sessionId), 'userId');
    const secret = randomToken();
    const now = Date.now();
    const [code] = (await this.redis.eval(
      ROTATE_SCRIPT,
      2,
      sessionKey(parsed.sessionId),
      userSessionsKey(userId ?? 'unknown'),
      sha256(parsed.secret),
      sha256(secret),
      now,
      this.ttlSec,
      this.maxAgeMs,
      ROTATION_GRACE_MS,
      parsed.sessionId,
    )) as [number, string];

    switch (code) {
      case 1:
        return {
          status: 'rotated',
          userId: userId as string,
          sessionId: parsed.sessionId,
          refreshToken: `${parsed.sessionId}.${secret}`,
          expiresAt: this.expiry(now),
        };
      case 2:
        return { status: 'concurrent' };
      case -1:
        return { status: 'reused' };
      default:
        return { status: 'invalid' };
    }
  }

  /** Live sessions of a user, most recently active first; drops ids whose session expired. */
  async list(userId: string): Promise<SessionInfo[]> {
    const ids = await this.redis.smembers(userSessionsKey(userId));
    if (ids.length === 0) {
      return [];
    }
    const pipeline = this.redis.pipeline();
    for (const id of ids) {
      pipeline.hmget(sessionKey(id), 'userId', 'createdAt', 'rotatedAt', 'userAgent', 'ip');
    }
    const rows = (await pipeline.exec()) ?? [];
    const sessions: SessionInfo[] = [];
    const stale: string[] = [];
    rows.forEach(([error, value], index) => {
      const id = ids[index] as string;
      const [owner, createdAt, rotatedAt, userAgent, ip] = (value ?? []) as (string | null)[];
      if (error || owner !== userId || !createdAt) {
        stale.push(id);
        return;
      }
      sessions.push({
        sessionId: id,
        createdAt: new Date(Number(createdAt)),
        lastActiveAt: new Date(Number(rotatedAt ?? createdAt)),
        userAgent: userAgent || null,
        ip: ip || null,
      });
    });
    if (stale.length > 0) {
      await this.redis.srem(userSessionsKey(userId), ...stale);
    }
    return sessions.sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());
  }

  /** Revokes a session only if it belongs to the user; false when there is no such session. */
  async revokeOwn(userId: string, sessionId: string): Promise<boolean> {
    const owner = await this.redis.hget(sessionKey(sessionId), 'userId');
    if (owner !== userId) {
      return false;
    }
    await this.revoke(sessionId);
    return true;
  }

  async isActive(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(sessionKey(sessionId))) === 1;
  }

  async revoke(sessionId: string): Promise<void> {
    const userId = await this.redis.hget(sessionKey(sessionId), 'userId');
    const pipeline = this.redis.multi().del(sessionKey(sessionId));
    if (userId) {
      pipeline.srem(userSessionsKey(userId), sessionId);
    }
    await pipeline.exec();
  }

  /** Signs the user out everywhere (password reset, block), optionally keeping one session. */
  async revokeAll(userId: string, exceptSessionId?: string): Promise<number> {
    const sessionIds = await this.redis.smembers(userSessionsKey(userId));
    const targets = sessionIds.filter((id) => id !== exceptSessionId);
    if (targets.length === 0) {
      return 0;
    }
    await this.redis
      .multi()
      .del(...targets.map(sessionKey))
      .srem(userSessionsKey(userId), ...targets)
      .exec();
    return targets.length;
  }

  private expiry(fromMs: number): Date {
    return new Date(fromMs + this.ttlSec * 1000);
  }
}

const REFRESH_TOKEN_PATTERN = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/;

function parseRefreshToken(token: string): { sessionId: string; secret: string } | undefined {
  const match = REFRESH_TOKEN_PATTERN.exec(token);
  return match ? { sessionId: match[1] as string, secret: match[2] as string } : undefined;
}
