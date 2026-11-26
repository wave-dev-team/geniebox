import { z } from 'zod';

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { createAgentSchema, restoreAgentSchema, updateAgentSchema } from '@workspace/types';

import type { AuthenticatedRequest } from '../auth/auth.controller.js';
import { AgentsService } from './agents.service.js';

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Req() request: AuthenticatedRequest) {
    return this.agents.list(request.user);
  }

  @Post()
  async create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = createAgentSchema.safeParse(body);
    if (!input.success) throw new BadRequestException();
    const agent = await this.agents.create(request.user, input.data);
    if (!agent) throw new ConflictException();
    return agent;
  }

  @Patch(':id')
  async update(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const input = updateAgentSchema.safeParse(body);
    if (!input.success) throw new BadRequestException();
    const agent = await this.agents.update(request.user, id, input.data);
    if (agent === 'missing') throw new NotFoundException();
    if (agent === 'conflict') throw new ConflictException();
    return agent;
  }

  @Get(':id/versions')
  @Header('Cache-Control', 'no-store')
  async history(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('before') value: unknown,
  ) {
    const cursor = z.coerce.number().int().positive().optional().safeParse(value);
    if (!cursor.success) throw new BadRequestException();
    const history = await this.agents.history(request.user, id, cursor.data);
    if (!history) throw new NotFoundException();
    return history;
  }

  @Post(':id/restore')
  async restore(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const input = restoreAgentSchema.safeParse(body);
    if (!input.success) throw new BadRequestException();
    const agent = await this.agents.restore(
      request.user,
      id,
      input.data.revision,
      input.data.expectedRevision,
    );
    if (agent === 'missing') throw new NotFoundException();
    if (agent === 'conflict') throw new ConflictException();
    return agent;
  }
}
