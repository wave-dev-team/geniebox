import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Put,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { metricaConnectionInputSchema } from '@workspace/types';

import type { AuthenticatedRequest } from '../../common/auth/request-actor.js';
import { ConnectionsService } from './connections.service.js';

@Controller('connections')
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list() {
    return this.connections.list();
  }

  @Put('yandex-metrica')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @HttpCode(204)
  save(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = metricaConnectionInputSchema.safeParse(body);
    if (!input.success) throw new BadRequestException();
    return this.connections.save(request.user, input.data);
  }

  @Delete('yandex-metrica')
  @HttpCode(204)
  remove(@Req() request: AuthenticatedRequest) {
    return this.connections.remove(request.user);
  }
}
