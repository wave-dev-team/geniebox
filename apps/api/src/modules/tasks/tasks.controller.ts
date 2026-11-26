import { z } from 'zod';

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  createWorkTaskSchema,
  taskActionSchema,
  taskTabSchema,
  updateWorkTaskSchema,
} from '@workspace/types';

import type { AuthenticatedRequest } from '../auth/auth.controller.js';
import { type TaskMutation, TasksService } from './tasks.service.js';

const listFilter = z.strictObject({
  tab: taskTabSchema.default('active'),
  agentId: z.uuid().optional(),
  before: z.uuid().optional(),
});
const countFilter = listFilter.pick({ agentId: true });

function parse<T>(schema: z.ZodType<T>, body: unknown) {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException();
  return result.data;
}

function mutationResult(task: TaskMutation) {
  if (task === 'missing') throw new NotFoundException();
  if (task === 'conflict') throw new ConflictException();
  return task;
}

@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.tasks.list(request.user, parse(listFilter, query));
  }

  @Get('counts')
  @Header('Cache-Control', 'no-store')
  counts(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.tasks.counts(request.user, parse(countFilter, query).agentId);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  async get(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const task = await this.tasks.get(request.user, id);
    if (!task) throw new NotFoundException();
    return task;
  }

  @Post()
  async create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return mutationResult(await this.tasks.create(request.user, parse(createWorkTaskSchema, body)));
  }

  @Patch(':id')
  async edit(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return mutationResult(await this.tasks.edit(request.user, id, parse(updateWorkTaskSchema, body)));
  }

  @Post(':id/actions')
  @HttpCode(200)
  async action(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { action } = parse(z.strictObject({ action: taskActionSchema }), body);
    return mutationResult(await this.tasks.action(request.user, id, action));
  }
}
