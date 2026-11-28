import { Injectable } from '@nestjs/common';

import { AccountDb, type AccountTx } from '../../database/scoped-db.js';
import { JournalService } from '../../journal/journal.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { ProjectContext } from '../projects/project-context.js';
import { StreamPublisher } from '../stream/stream.publisher.js';
import {
  type CreateRoutineDto,
  RoutineResponseDto,
  type TaskResponseDto,
  type UpdateRoutineDto,
} from './dto/task.dto.js';
import { type RoutineChangedEvent, WORK_EVENTS } from './events/work.events.js';
import { RoutinesRepository } from './repositories/routines.repository.js';
import { TasksRepository } from './repositories/tasks.repository.js';
import { isScheduleKey, nextRun, type ScheduleKey } from './schedule.js';
import { TasksService } from './tasks.service.js';
import { WORK_ERRORS, WorkException } from './work.errors.js';
import { findProjectAgent } from './work-agents.js';

const RECENT_RUNS = 5;

/** Routines: list, card with recent runs, schedule, on/off, run now. */
@Injectable()
export class RoutinesService {
  constructor(
    private readonly accountDb: AccountDb,
    private readonly routines: RoutinesRepository,
    private readonly tasks: TasksRepository,
    private readonly tasksService: TasksService,
    private readonly journal: JournalService,
    private readonly outbox: OutboxService,
    private readonly stream: StreamPublisher,
    private readonly projectContext: ProjectContext,
  ) {}

  async list(agentId?: string): Promise<RoutineResponseDto[]> {
    const { projectId } = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) =>
      (await this.routines.list(tx.db, projectId, agentId)).map((row) => RoutineResponseDto.from(row)),
    );
  }

  async get(id: string): Promise<RoutineResponseDto> {
    const { projectId } = this.projectContext.actor();
    return this.accountDb.transaction((tx) => this.view(tx, projectId, id));
  }

  async create(dto: CreateRoutineDto): Promise<RoutineResponseDto> {
    const actor = this.projectContext.actor();
    if (!isScheduleKey(dto.schedule)) throw new WorkException(WORK_ERRORS.ROUTINE_NOT_FOUND);
    return this.accountDb.transaction(async (tx) => {
      const agent = await findProjectAgent(tx.db, actor.projectId, dto.agentId);
      if (!agent || agent.kind === 'manager') throw new WorkException(WORK_ERRORS.WORK_AGENT_INVALID);
      const project = await tx.db
        .selectFrom('projects')
        .select('timezone')
        .where('id', '=', actor.projectId)
        .executeTakeFirstOrThrow();
      const routine = await this.routines.insert(tx.db, {
        account_id: tx.accountId,
        project_id: actor.projectId,
        agent_id: agent.id,
        title: dto.title,
        description: dto.description ?? null,
        schedule: dto.schedule,
        enabled: true,
        next_run_at: nextRun(dto.schedule, project.timezone),
        created_by: actor.userId,
      });
      if (!routine) throw new WorkException(WORK_ERRORS.ROUTINE_NOT_FOUND);
      await this.journal.record(tx, {
        actor: { type: 'user', id: actor.userId, role: actor.role },
        action: 'routines.create',
        target: { type: 'routine', id: routine.id },
        args: { agentId: agent.id, schedule: dto.schedule },
        status: 'succeeded',
      });
      await this.outbox.add<RoutineChangedEvent>(tx, {
        type: WORK_EVENTS.ROUTINE_CHANGED,
        payload: { projectId: actor.projectId, routineId: routine.id, byUserId: actor.userId },
      });
      tx.afterCommit(() =>
        this.stream.publish(actor.projectId, { type: 'routine.updated', routineId: routine.id }),
      );
      return this.view(tx, actor.projectId, routine.id);
    });
  }

  async update(id: string, dto: UpdateRoutineDto): Promise<RoutineResponseDto> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const routine = await this.mustFind(tx, actor.projectId, id);
      const schedule = (dto.schedule ?? routine.schedule) as ScheduleKey;
      const enabled = dto.enabled ?? routine.enabled;
      if (!isScheduleKey(schedule)) throw new WorkException(WORK_ERRORS.ROUTINE_NOT_FOUND);
      const project = await tx.db
        .selectFrom('projects')
        .select('timezone')
        .where('id', '=', actor.projectId)
        .executeTakeFirstOrThrow();
      await this.routines.update(tx.db, id, {
        schedule,
        enabled,
        next_run_at: enabled ? nextRun(schedule, project.timezone) : null,
      });
      await this.journal.record(tx, {
        actor: { type: 'user', id: actor.userId, role: actor.role },
        action: 'routines.update',
        target: { type: 'routine', id },
        args: dto,
        status: 'succeeded',
      });
      await this.outbox.add<RoutineChangedEvent>(tx, {
        type: WORK_EVENTS.ROUTINE_CHANGED,
        payload: { projectId: actor.projectId, routineId: id, byUserId: actor.userId },
      });
      tx.afterCommit(() => this.stream.publish(actor.projectId, { type: 'routine.updated', routineId: id }));
      return this.view(tx, actor.projectId, id);
    });
  }

  /** «Запустить сейчас»: a one-off run outside the schedule. */
  async runNow(id: string): Promise<TaskResponseDto> {
    const actor = this.projectContext.actor();
    const taskId = await this.accountDb.transaction(async (tx) => {
      const routine = await this.mustFind(tx, actor.projectId, id);
      const task = await this.tasks.insert(tx.db, {
        account_id: tx.accountId,
        project_id: actor.projectId,
        agent_id: routine.agent_id,
        title: routine.title,
        description: routine.description,
        origin: 'routine',
        routine_id: routine.id,
        scheduled_at: new Date(),
        created_by: actor.userId,
      });
      await this.journal.record(tx, {
        actor: { type: 'user', id: actor.userId, role: actor.role },
        action: 'routines.run',
        target: { type: 'routine', id },
        args: { taskId: task.id },
        status: 'succeeded',
      });
      await this.tasksService.requestRun(tx, actor, task.id);
      return task.id;
    });
    return this.tasksService.get(taskId);
  }

  private async view(tx: AccountTx, projectId: string, id: string): Promise<RoutineResponseDto> {
    const routine = await this.mustFind(tx, projectId, id);
    return RoutineResponseDto.from(routine, await this.tasks.listByRoutine(tx.db, id, RECENT_RUNS));
  }

  private async mustFind(tx: AccountTx, projectId: string, id: string) {
    const routine = await this.routines.find(tx.db, projectId, id);
    if (!routine) throw new WorkException(WORK_ERRORS.ROUTINE_NOT_FOUND);
    return routine;
  }
}
