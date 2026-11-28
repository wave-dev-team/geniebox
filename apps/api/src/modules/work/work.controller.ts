import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AccountDb } from '../../database/scoped-db.js';
import { AccountAccessGuard } from '../accounts/guards/account-access.guard.js';
import { ApiAccountParam } from '../accounts/guards/api-account-param.decorator.js';
import { RequireAccountRole } from '../accounts/guards/require-account-role.decorator.js';
import { ApiProjectParam } from '../projects/guards/api-project-param.decorator.js';
import { ProjectAccessGuard } from '../projects/guards/project-access.guard.js';
import { ProjectContext } from '../projects/project-context.js';
import { ConversationsService } from './conversations.service.js';
import { DecisionsService } from './decisions.service.js';
import {
  ConversationListQueryDto,
  ConversationResponseDto,
  CreateConversationDto,
  MessageListQueryDto,
  MessageResponseDto,
  PostMessageDto,
  PostMessageResponseDto,
} from './dto/conversation.dto.js';
import {
  AcceptDecisionDto,
  DecisionCountsDto,
  DecisionListQueryDto,
  DecisionResponseDto,
  RejectDecisionDto,
} from './dto/decision.dto.js';
import {
  CountersResponseDto,
  CreateRoutineDto,
  CreateTaskDto,
  RoutineResponseDto,
  TaskCountsDto,
  TaskListQueryDto,
  TaskResponseDto,
  UpdateRoutineDto,
} from './dto/task.dto.js';
import { DecisionsRepository } from './repositories/decisions.repository.js';
import { RoutinesRepository } from './repositories/routines.repository.js';
import { TasksRepository } from './repositories/tasks.repository.js';
import { RoutinesService } from './routines.service.js';
import { TasksService } from './tasks.service.js';

/** Reading: every member. Giving and changing work: tech. */
@ApiTags('tasks')
@ApiBearerAuth()
@ApiAccountParam()
@ApiProjectParam()
@UseGuards(AccountAccessGuard, ProjectAccessGuard)
@Controller('accounts/:accountId/projects/:projectId')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly routines: RoutinesService,
    private readonly accountDb: AccountDb,
    private readonly routinesRepo: RoutinesRepository,
    private readonly projectContext: ProjectContext,
  ) {}

  @Get('tasks')
  @ApiOperation({ summary: 'Active (planned, running, waiting, failed) or finished tasks' })
  list(@Query() query: TaskListQueryDto): Promise<TaskResponseDto[]> {
    return this.tasks.list(query.tab ?? 'active', query.agentId);
  }

  @Get('task-counts')
  @ApiOperation({ summary: 'Numbers on the task tabs' })
  async counts(): Promise<TaskCountsDto> {
    const { projectId } = this.projectContext.actor();
    const [tasks, routines] = await Promise.all([
      this.tasks.counts(),
      this.accountDb.transaction((tx) => this.routinesRepo.list(tx.db, projectId)),
    ]);
    return { ...tasks, routines: routines.length };
  }

  @Post('tasks')
  @RequireAccountRole('tech')
  @ApiOperation({ summary: '«Поставить задачу»: a task straight to an agent' })
  create(@Body() dto: CreateTaskDto): Promise<TaskResponseDto> {
    return this.tasks.create(dto);
  }

  @Get('tasks/:taskId')
  @ApiOperation({ summary: 'Task card with steps and the pending decision' })
  get(@Param('taskId', ParseUUIDPipe) id: string): Promise<TaskResponseDto> {
    return this.tasks.get(id);
  }

  @Post('tasks/:taskId/run')
  @HttpCode(HttpStatus.OK)
  @RequireAccountRole('tech')
  @ApiOperation({ summary: '«Запустить сейчас» (planned) or «Повторить» (failed)' })
  run(@Param('taskId', ParseUUIDPipe) id: string): Promise<TaskResponseDto> {
    return this.tasks.run(id);
  }

  @Post('tasks/:taskId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireAccountRole('tech')
  @ApiOperation({ summary: '«Отменить»' })
  cancel(@Param('taskId', ParseUUIDPipe) id: string): Promise<TaskResponseDto> {
    return this.tasks.cancel(id);
  }

  @Get('routines')
  @ApiOperation({ summary: 'Routines' })
  listRoutines(@Query() query: ConversationListQueryDto): Promise<RoutineResponseDto[]> {
    return this.routines.list(query.agentId);
  }

  @Post('routines')
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'Create a recurring routine for an agent' })
  createRoutine(@Body() dto: CreateRoutineDto): Promise<RoutineResponseDto> {
    return this.routines.create(dto);
  }

  @Get('routines/:routineId')
  @ApiOperation({ summary: 'Routine with recent runs' })
  getRoutine(@Param('routineId', ParseUUIDPipe) id: string): Promise<RoutineResponseDto> {
    return this.routines.get(id);
  }

  @Patch('routines/:routineId')
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'Turn on/off or change the schedule' })
  updateRoutine(
    @Param('routineId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoutineDto,
  ): Promise<RoutineResponseDto> {
    return this.routines.update(id, dto);
  }

  @Post('routines/:routineId/run')
  @HttpCode(HttpStatus.OK)
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'Run the routine now, outside the schedule' })
  runRoutine(@Param('routineId', ParseUUIDPipe) id: string): Promise<TaskResponseDto> {
    return this.routines.runNow(id);
  }
}

/** «Да» and «Нет» are for owners and admins. */
@ApiTags('decisions')
@ApiBearerAuth()
@ApiAccountParam()
@ApiProjectParam()
@UseGuards(AccountAccessGuard, ProjectAccessGuard)
@Controller('accounts/:accountId/projects/:projectId/decisions')
export class DecisionsController {
  constructor(
    private readonly decisions: DecisionsService,
    private readonly repo: DecisionsRepository,
    private readonly accountDb: AccountDb,
    private readonly projectContext: ProjectContext,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Pending, decided or all decisions' })
  list(@Query() query: DecisionListQueryDto): Promise<DecisionResponseDto[]> {
    return this.decisions.list(query.tab ?? 'pending');
  }

  @Get('counts')
  @ApiOperation({ summary: 'Numbers on the decision tabs' })
  async counts(): Promise<DecisionCountsDto> {
    const { projectId } = this.projectContext.actor();
    const byStatus = await this.accountDb.transaction((tx) => this.repo.countByStatus(tx.db, projectId));
    const pending = byStatus.pending ?? 0;
    const total = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
    return { pending, decided: total - pending };
  }

  @Get(':decisionId')
  @ApiOperation({ summary: 'Decision card' })
  get(@Param('decisionId', ParseUUIDPipe) id: string): Promise<DecisionResponseDto> {
    return this.decisions.get(id);
  }

  @Post(':decisionId/accept')
  @HttpCode(HttpStatus.OK)
  @RequireAccountRole('admin')
  @ApiOperation({ summary: '«Да», optionally with changed terms; idempotent' })
  accept(
    @Param('decisionId', ParseUUIDPipe) id: string,
    @Body() dto: AcceptDecisionDto,
  ): Promise<DecisionResponseDto> {
    return this.decisions.accept(id, dto.term);
  }

  @Post(':decisionId/reject')
  @HttpCode(HttpStatus.OK)
  @RequireAccountRole('admin')
  @ApiOperation({ summary: '«Нет»: the agent does not propose the same for a while' })
  reject(
    @Param('decisionId', ParseUUIDPipe) id: string,
    @Body() dto: RejectDecisionDto,
  ): Promise<DecisionResponseDto> {
    return this.decisions.reject(id, dto.reason);
  }
}

@ApiTags('conversations')
@ApiBearerAuth()
@ApiAccountParam()
@ApiProjectParam()
@UseGuards(AccountAccessGuard, ProjectAccessGuard)
@Controller('accounts/:accountId/projects/:projectId/conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @ApiOperation({ summary: 'Recent conversations, optionally with one agent' })
  list(@Query() query: ConversationListQueryDto): Promise<ConversationResponseDto[]> {
    return this.conversations.list(query.agentId);
  }

  @Post()
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'New conversation with the manager or an agent' })
  create(@Body() dto: CreateConversationDto): Promise<ConversationResponseDto> {
    return this.conversations.create(dto.agentId);
  }

  @Get('manager')
  @ApiOperation({ summary: 'The current user’s permanent conversation with the project manager' })
  async manager(): Promise<{ conversation: ConversationResponseDto | null }> {
    return { conversation: await this.conversations.manager() };
  }

  @Get(':conversationId')
  @ApiOperation({ summary: 'Conversation' })
  get(@Param('conversationId', ParseUUIDPipe) id: string): Promise<ConversationResponseDto> {
    return this.conversations.get(id);
  }

  @Get(':conversationId/messages')
  @ApiOperation({ summary: 'Messages, oldest first; `before` pages back' })
  messages(
    @Param('conversationId', ParseUUIDPipe) id: string,
    @Query() query: MessageListQueryDto,
  ): Promise<MessageResponseDto[]> {
    return this.conversations.messages(id, query.before, query.beforeId);
  }

  @Post(':conversationId/messages')
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'Write to the manager or an agent; the answer streams over SSE' })
  post(
    @Param('conversationId', ParseUUIDPipe) id: string,
    @Body() dto: PostMessageDto,
  ): Promise<PostMessageResponseDto> {
    return this.conversations.post(id, dto);
  }
}

@ApiTags('projects')
@ApiBearerAuth()
@ApiAccountParam()
@ApiProjectParam()
@UseGuards(AccountAccessGuard, ProjectAccessGuard)
@Controller('accounts/:accountId/projects/:projectId/counters')
export class CountersController {
  constructor(
    private readonly accountDb: AccountDb,
    private readonly tasks: TasksRepository,
    private readonly decisions: DecisionsRepository,
    private readonly projectContext: ProjectContext,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Sidebar counters (refetched on stream events)' })
  get(): Promise<CountersResponseDto> {
    const { projectId } = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const [byStatus, pendingDecisions] = await Promise.all([
        this.tasks.countByStatus(tx.db, projectId),
        this.decisions.countPending(tx.db, projectId),
      ]);
      return {
        activeTasks: (byStatus.running ?? 0) + (byStatus.waiting ?? 0),
        pendingDecisions,
      };
    });
  }
}
