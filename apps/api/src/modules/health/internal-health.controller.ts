import type { Response } from 'express';

import { Controller, Get, Res, ServiceUnavailableException, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';

import { AppRedis } from '../../common/redis/app-redis.js';
import { DatabasePing } from '../../database/database-ping.js';

@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class InternalHealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    private readonly db: DatabasePing,
    private readonly redis: AppRedis,
  ) {}

  @Get()
  healthStatus() {
    return { status: 'ok' };
  }

  @Get('details')
  @HealthCheck()
  async details(@Res({ passthrough: true }) response: Response) {
    try {
      return await this.health.check([
        () => this.probe('postgres', this.db.check()),
        () => this.probe('redis', this.redis.client.ping()),
      ]);
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
      response.status(error.getStatus());
      return error.getResponse();
    }
  }

  private async probe(name: string, check: Promise<unknown>) {
    const indicator = this.indicators.check(name);
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        check,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Dependency timeout')), 2000);
        }),
      ]);
      return indicator.up();
    } catch {
      return indicator.down();
    } finally {
      clearTimeout(timer);
    }
  }
}
