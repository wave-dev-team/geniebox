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
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { createAgentSchema, updateAgentSchema } from '@workspace/types';

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
    if (!agent) throw new NotFoundException();
    return agent;
  }
}
