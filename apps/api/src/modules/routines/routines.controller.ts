import { z } from 'zod';

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';

import { createRoutineSchema } from '@workspace/types';

import type { AuthenticatedRequest } from '../../common/auth/request-actor.js';
import { RoutinesService } from './routines.service.js';

@Controller('routines')
export class RoutinesController {
  constructor(private readonly routines: RoutinesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Req() request: AuthenticatedRequest) {
    return this.routines.list(request.user);
  }

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = createRoutineSchema.safeParse(body);
    if (!input.success) throw new BadRequestException();
    return this.routines.create(request.user, input.data);
  }

  @Patch(':id')
  enable(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const input = z.strictObject({ enabled: z.boolean() }).safeParse(body);
    if (!input.success) throw new BadRequestException();
    return this.routines.enable(request.user, id, input.data.enabled);
  }

  @Post(':id/run')
  run(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = z.strictObject({ id: z.uuid() }).safeParse(body);
    if (!input.success) throw new BadRequestException();
    return this.routines.run(request.user, id, false, input.data.id);
  }
}
