import type { Redis } from 'ioredis';

import { Controller, Get, Inject, VERSION_NEUTRAL } from '@nestjs/common';
import {
  HealthCheck,
  type HealthCheckResult,
  HealthCheckService,
  type HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';

import { Public } from '../../common/decorators/public.decorator.js';
import { CACHE_REDIS, STATE_REDIS } from '../../common/redis/redis.module.js';
import { DatabasePing } from '../../database/database-ping.js';

const PROBE_TIMEOUT_MS = 2_000;

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Detailed readiness, per dependency. Served only on the internal listener, whose network
 * placement is the access control; switches to service-token auth together with /internal/*.
 */
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthDetailsController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    private readonly db: DatabasePing,
    @Inject(STATE_REDIS) private readonly stateRedis: Redis,
    @Inject(CACHE_REDIS) private readonly cacheRedis: Redis,
  ) {}

  @Public()
  @Get('details')
  @HealthCheck()
  details(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.probe('postgres_app', () => this.db.pingApp()),
      () => this.probe('postgres_system', () => this.db.pingSystem()),
      () => this.probe('redis_state', () => this.stateRedis.ping()),
      () => this.probe('redis_cache', () => this.cacheRedis.ping()),
    ]);
  }

  private async probe(key: string, check: () => Promise<unknown>): Promise<HealthIndicatorResult> {
    const session = this.indicators.check(key);
    try {
      await withTimeout(check());
      return session.up();
    } catch (error) {
      return session.down({ message: error instanceof Error ? error.message : 'unknown' });
    }
  }
}
