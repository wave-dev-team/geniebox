import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { z } from 'zod';

import { Injectable } from '@nestjs/common';

import type { Session } from '@workspace/types';

import type { Identity } from '../profile/profile.repository.js';
import { AuthError } from './auth-errors.js';
import { AuthRedis } from './auth-redis.js';

export const ACCESS_SECONDS = 10 * 60;
export const REFRESH_SECONDS = 30 * 24 * 60 * 60;

const rotationGraceMs = 10_000;
const credential = z.string().regex(/^[\w-]{43}$/);
const refreshParts = z.tuple([z.uuid(), z.uuid(), z.uuid(), credential]);
const recordSchema = z.object({
  hash: credential,
  previous: credential.optional(),
  created: z.coerce.number(),
  changed: z.coerce.number(),
  version: z.iso.datetime(),
  userAgent: z.string(),
  ip: z.string(),
});

export interface Actor extends Identity {
  sessionId: string;
}

const sessionKey = ({ tenantId, userId, sessionId }: Actor) =>
  `t:{${tenantId}}:auth:${userId}:session:${sessionId}`;
const sessionIndex = ({ tenantId, userId }: Identity) => `t:{${tenantId}}:auth:${userId}:sessions`;
const secret = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
const encode = ({ tenantId, userId, sessionId }: Actor, token: string) =>
  [tenantId, userId, sessionId, token].join('.');

const rotateScript = `
local row = redis.call('HMGET', KEYS[1], 'hash', 'previous', 'changed', 'version')
if not row[1] then return {0} end
if row[1] == ARGV[1] then
  redis.call('HSET', KEYS[1], 'hash', ARGV[2], 'previous', row[1], 'changed', ARGV[3])
  return {1, row[4]}
end
if row[2] == ARGV[1] then
  if tonumber(ARGV[3]) - tonumber(row[3]) <= tonumber(ARGV[4]) then return {2} end
  redis.call('DEL', KEYS[1])
  redis.call('ZREM', KEYS[2], ARGV[5])
end
return {0}
`;

@Injectable()
export class SessionStore {
  constructor(private readonly redis: AuthRedis) {}

  async create(identity: Identity, version: string, meta: { userAgent?: string; ip?: string }) {
    const actor = { ...identity, sessionId: randomUUID() };
    const token = secret();
    const client = await this.redis.get();
    const now = Date.now();
    const index = sessionIndex(actor);
    const results = await client
      .multi()
      .hset(sessionKey(actor), {
        hash: digest(token),
        created: now,
        changed: now,
        version,
        userAgent: meta.userAgent?.slice(0, 256) ?? '',
        ip: meta.ip ?? '',
      })
      .expire(sessionKey(actor), REFRESH_SECONDS)
      .zremrangebyscore(index, 0, now)
      .zadd(index, now + REFRESH_SECONDS * 1000, actor.sessionId)
      .expire(index, REFRESH_SECONDS)
      .exec();
    if (!results || results.some(([error]) => error)) {
      throw new Error('Could not store authentication session');
    }
    return { actor, refresh: encode(actor, token), expiresIn: REFRESH_SECONDS };
  }

  async rotate(refresh: string) {
    const parsed = refreshParts.safeParse(refresh.split('.'));
    if (!parsed.success) throw new AuthError('SESSION_EXPIRED');
    const [tenantId, userId, sessionId, presented] = parsed.data;
    const actor = { tenantId, userId, sessionId };
    const client = await this.redis.get();
    const key = sessionKey(actor);
    const replacement = secret();
    const result = z
      .union([z.tuple([z.literal(1), z.iso.datetime()]), z.tuple([z.literal(0)]), z.tuple([z.literal(2)])])
      .parse(
        await client.eval(
          rotateScript,
          2,
          key,
          sessionIndex(actor),
          digest(presented),
          digest(replacement),
          Date.now(),
          rotationGraceMs,
          sessionId,
        ),
      );
    if (result[0] === 2) throw new AuthError('REFRESH_CONCURRENT');
    if (result[0] !== 1) throw new AuthError('SESSION_EXPIRED');
    return {
      actor,
      version: result[1],
      refresh: encode(actor, replacement),
      expiresIn: await client.ttl(key),
    };
  }

  async isActive(actor: Actor, version: string) {
    return (await (await this.redis.get()).hget(sessionKey(actor), 'version')) === version;
  }

  async list(actor: Actor): Promise<Session[]> {
    const client = await this.redis.get();
    const ids = await client.zrangebyscore(sessionIndex(actor), Date.now(), '+inf');
    const records = await Promise.all(
      ids.map(async (id) => {
        const data = recordSchema.safeParse(await client.hgetall(sessionKey({ ...actor, sessionId: id })));
        if (!data.success) return [];
        return [
          {
            id,
            current: id === actor.sessionId,
            userAgent: data.data.userAgent || null,
            ip: data.data.ip || null,
            createdAt: new Date(data.data.created).toISOString(),
            lastActiveAt: new Date(data.data.changed).toISOString(),
          },
        ];
      }),
    );
    return records
      .flat()
      .sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt.localeCompare(a.lastActiveAt));
  }

  async revoke(actor: Actor) {
    const client = await this.redis.get();
    await client.multi().del(sessionKey(actor)).zrem(sessionIndex(actor), actor.sessionId).exec();
  }

  async revokeAll(identity: Identity) {
    const client = await this.redis.get();
    const index = sessionIndex(identity);
    const ids = await client.zrange(index, 0, -1);
    if (ids.length === 0) return;
    await client
      .multi()
      .del(...ids.map((sessionId) => sessionKey({ ...identity, sessionId })))
      .zrem(index, ...ids)
      .exec();
  }
}
