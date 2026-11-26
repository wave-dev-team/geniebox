import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { Redis } from 'ioredis';
import type { Kysely } from 'kysely';

import type { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../../src/common/context/app-cls-store.js';
import { runInContext } from '../../src/common/context/run-in-context.js';
import { createKysely } from '../../src/database/create-kysely.js';
import type { DB } from '../../src/database/types.js';
import { INFRA_FILE, type TestInfra } from './infra-file.js';

export const infra = (): TestInfra => JSON.parse(readFileSync(INFRA_FILE, 'utf8')) as TestInfra;

/** Direct connection on a given role, bypassing Nest. Caller destroys it. */
export function connectAs(url: string): Kysely<DB> {
  return createKysely<DB>({ connectionString: url, max: 2, applicationName: 'e2e-direct' });
}

export async function flushRedis(): Promise<void> {
  for (const url of [infra().env.REDIS_STATE_URL, infra().env.REDIS_CACHE_URL]) {
    const redis = new Redis(url as string);
    await redis.flushdb();
    await redis.quit();
  }
}

export function asAccount<T>(
  cls: ClsService<AppClsStore>,
  accountId: string,
  fn: () => Promise<T>,
  userId?: string,
): Promise<T> {
  return runInContext(cls, { traceId: randomUUID(), accountId, userId }, fn);
}

export function asUser<T>(cls: ClsService<AppClsStore>, userId: string, fn: () => Promise<T>): Promise<T> {
  return runInContext(cls, { traceId: randomUUID(), userId }, fn);
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@e2e.test`;
}

export function asSystem<T>(cls: ClsService<AppClsStore>, fn: () => Promise<T>): Promise<T> {
  return runInContext(cls, { traceId: randomUUID() }, fn);
}

export function uniqueSlug(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/** Polls until the assertion stops throwing. */
export async function eventually<T>(assertion: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError;
}
