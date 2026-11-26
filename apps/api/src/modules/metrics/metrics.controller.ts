import { BadRequestException, Body, Controller, Get, Header, HttpCode, Put, Req } from '@nestjs/common';

import { metricSchema } from '@workspace/types';

import type { AuthenticatedRequest } from '../../common/auth/request-actor.js';
import { MetricsService } from './metrics.service.js';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list() {
    return this.metrics.list();
  }

  @Put()
  @HttpCode(204)
  rename(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = metricSchema.strict().safeParse(body);
    if (!input.success) throw new BadRequestException();
    return this.metrics.rename(request.user, input.data.key, input.data.label);
  }
}
