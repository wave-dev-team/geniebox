import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { RoutineRow } from '../repositories/routines.repository.js';
import type { StepRow, TaskRow } from '../repositories/tasks.repository.js';
import { SCHEDULE_KEYS, type ScheduleKey } from '../schedule.js';
import {
  REQUEST_MODES,
  type RequestMode,
  STEP_STATUSES,
  type StepStatus,
  TASK_ORIGINS,
  TASK_STATUSES,
  type TaskOrigin,
  type TaskStatus,
  WAITING_REASONS,
  type WaitingReason,
} from '../work.constants.js';
import { FactDto } from './common.dto.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class TaskStepDto {
  @ApiProperty()
  position: number;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: STEP_STATUSES })
  status: StepStatus;

  @ApiProperty({ nullable: true, type: Date })
  at: Date | null;

  @ApiProperty({ nullable: true, type: String })
  note: string | null;
}

export class TaskErrorDto {
  @ApiProperty()
  code: string;

  @ApiProperty({ description: 'Что случилось' })
  what: string;

  @ApiProperty({ nullable: true, type: String, description: 'Как исправить' })
  fix: string | null;
}

export class TaskResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  agentId: string;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  parentTaskId: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  assignedByAgentId: string | null;

  @ApiProperty({ enum: WAITING_REASONS, nullable: true })
  waitingReason: WaitingReason | null;

  @ApiProperty()
  title: string;

  @ApiProperty({ nullable: true, type: String, description: 'Status line under the title' })
  summary: string | null;

  @ApiProperty({ nullable: true, type: String, description: '«Зачем»' })
  description: string | null;

  @ApiProperty({ enum: TASK_STATUSES })
  status: TaskStatus;

  @ApiProperty({ nullable: true, type: String, example: '84 из 200 ответов' })
  progressText: string | null;

  @ApiProperty({ nullable: true, type: Number })
  progressPct: number | null;

  @ApiProperty({ nullable: true, type: Date })
  scheduledAt: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  startedAt: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  finishedAt: Date | null;

  @ApiProperty({ enum: TASK_ORIGINS })
  origin: TaskOrigin;

  @ApiProperty({ enum: REQUEST_MODES, nullable: true })
  mode: RequestMode | null;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  routineId: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  conversationId: string | null;

  @ApiProperty({ nullable: true, type: String })
  result: string | null;

  @ApiProperty({ type: [FactDto] })
  facts: FactDto[];

  @ApiProperty({ nullable: true, type: TaskErrorDto })
  error: TaskErrorDto | null;

  @ApiProperty({ type: [TaskStepDto] })
  steps: TaskStepDto[];

  @ApiProperty({ nullable: true, type: String, format: 'uuid', description: 'Pending decision' })
  decisionId: string | null;

  @ApiProperty()
  createdAt: Date;

  static from(task: TaskRow, steps: StepRow[], decisionId: string | null = null): TaskResponseDto {
    return {
      id: task.id,
      agentId: task.agent_id,
      parentTaskId: task.parent_task_id,
      assignedByAgentId: task.assigned_by_agent_id,
      waitingReason: task.waiting_reason as WaitingReason | null,
      title: task.title,
      summary: task.summary,
      description: task.description,
      status: task.status,
      progressText: task.progress_text,
      progressPct: task.progress_pct,
      scheduledAt: task.scheduled_at,
      startedAt: task.started_at,
      finishedAt: task.finished_at,
      origin: task.origin as TaskOrigin,
      mode: task.mode as RequestMode | null,
      routineId: task.routine_id,
      conversationId: task.conversation_id,
      result: task.result,
      facts: task.facts,
      error: task.error,
      steps: steps
        .filter((step) => step.task_id === task.id)
        .map((step) => ({
          position: step.position,
          title: step.title,
          status: step.status,
          at: step.at,
          note: step.note,
        })),
      decisionId,
      createdAt: task.created_at,
    };
  }
}

export class TaskListQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'done'], default: 'active' })
  @IsOptional()
  @IsIn(['active', 'done'])
  tab?: 'active' | 'done';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  agentId?: string;
}

export class CreateTaskDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  agentId: string;

  @ApiProperty({ maxLength: 160 })
  @Transform(trim)
  @IsString()
  @Length(1, 160)
  title: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: REQUEST_MODES })
  @IsOptional()
  @IsIn(REQUEST_MODES)
  mode?: RequestMode;
}

export class TaskCountsDto {
  @ApiProperty()
  active: number;

  @ApiProperty()
  routines: number;

  @ApiProperty()
  done: number;
}

export class RoutineRunDto {
  @ApiProperty({ format: 'uuid' })
  taskId: string;

  @ApiProperty({ enum: TASK_STATUSES })
  status: TaskStatus;

  @ApiProperty()
  at: Date;

  @ApiProperty({ nullable: true, type: String })
  result: string | null;
}

export class RoutineResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  agentId: string;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  assignedByAgentId: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  kind: string | null;

  @ApiProperty()
  title: string;

  @ApiProperty({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({ enum: SCHEDULE_KEYS })
  schedule: ScheduleKey;

  @ApiProperty()
  enabled: boolean;

  @ApiProperty({ nullable: true, type: Date })
  nextRunAt: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  lastRunAt: Date | null;

  @ApiProperty({ nullable: true, type: String })
  lastRunSummary: string | null;

  @ApiProperty({ type: [RoutineRunDto] })
  recentRuns: RoutineRunDto[];

  static from(routine: RoutineRow, runs: TaskRow[] = []): RoutineResponseDto {
    return {
      id: routine.id,
      agentId: routine.agent_id,
      assignedByAgentId: routine.assigned_by_agent_id,
      kind: routine.kind,
      title: routine.title,
      description: routine.description,
      schedule: routine.schedule as ScheduleKey,
      enabled: routine.enabled,
      nextRunAt: routine.next_run_at,
      lastRunAt: routine.last_run_at,
      lastRunSummary: routine.last_run_summary,
      recentRuns: runs.map((run) => ({
        taskId: run.id,
        status: run.status,
        at: run.finished_at ?? run.started_at ?? run.created_at,
        result: run.result,
      })),
    };
  }
}

export class CreateRoutineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  agentId: string;

  @ApiProperty({ maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  title: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ enum: SCHEDULE_KEYS })
  @IsIn(SCHEDULE_KEYS)
  schedule: ScheduleKey;
}

export class UpdateRoutineDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: SCHEDULE_KEYS })
  @IsOptional()
  @IsIn(SCHEDULE_KEYS)
  schedule?: ScheduleKey;
}

export class CountersResponseDto {
  @ApiProperty({ description: 'Running and waiting tasks' })
  activeTasks: number;

  @ApiProperty()
  pendingDecisions: number;
}
