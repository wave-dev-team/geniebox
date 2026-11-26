import { z } from 'zod';

import { BadRequestException, Body, Controller, Get, Header, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { metricsReportInputSchema } from '@workspace/types';

import type { AuthenticatedRequest } from '../../common/auth/request-actor.js';
import { ReportsService } from './reports.service.js';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query('before') value: unknown) {
    const cursor = z.uuid().optional().safeParse(value);
    if (!cursor.success) throw new BadRequestException();
    return this.reports.list(cursor.data);
  }

  @Post()
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = metricsReportInputSchema.safeParse(body);
    if (!input.success) throw new BadRequestException();
    return this.reports.create(request.user, input.data);
  }
}
