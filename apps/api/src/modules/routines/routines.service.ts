import { randomUUID } from 'node:crypto';

import { type Selectable, sql, type Transaction } from 'kysely';

import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ClsService } from 'nestjs-cls';

import { type CreateRoutine, routineCadenceSchema, routineSchema } from '@workspace/types';

import { RoutineDirectory } from '../../database/routine-directory.js';
import { type RequestContext, TenantDb } from '../../database/tenant-db.js';
import type { DB, TaskRoutines } from '../../database/types.js';
import { type TaskOwner, TasksRepository } from '../tasks/tasks.repository.js';

const day = 86_400_000;
const step = (cadence: string) => day * (routineCadenceSchema.parse(cadence) === 'daily' ? 1 : 7);

function scope(tx: Transaction<DB>, owner: TaskOwner) {
  return tx
    .selectFrom('task_routines')
    .selectAll()
    .where('tenant_id', '=', owner.tenantId)
    .where('user_id', '=', owner.userId);
}

function dto(row: Selectable<TaskRoutines>) {
  return routineSchema.parse({
    id: row.id,
    title: row.title,
    description: row.description,
    cadence: row.cadence,
    enabled: row.enabled,
    nextRunAt: row.next_run_at.toISOString(),
  });
}

@Injectable()
export class RoutinesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoutinesService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;

  constructor(
    private readonly db: TenantDb,
    private readonly tasks: TasksRepository,
    private readonly directory: RoutineDirectory,
    private readonly context: ClsService<RequestContext>,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.running ??= this.tick()
        .catch(() => {
          this.logger.warn('Task schedules could not be processed');
        })
        .finally(() => {
          this.running = undefined;
        });
    }, 60_000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
  }

  async tick() {
    for (const row of await this.directory.due()) {
      const owner = { tenantId: row.tenant_id, userId: row.user_id };
      try {
        await this.context.runWith({ tenantId: owner.tenantId }, () => this.run(owner, row.id, true));
      } catch {
        this.logger.warn({ routineId: row.id }, 'Scheduled task could not be started');
      }
    }
  }

  async list(owner: TaskOwner) {
    const rows = await this.db.transaction((tx) => scope(tx, owner).orderBy('created_at', 'desc').execute());
    return rows.map(dto);
  }

  create(owner: TaskOwner, input: CreateRoutine) {
    return this.db.transaction(async (tx) => {
      // The per-user lock bounds the list even when several clients create schedules together.
      await sql`select pg_advisory_xact_lock(hashtextextended(${`task-routines:${owner.tenantId}:${owner.userId}`}, 0))`.execute(
        tx,
      );
      const owned = scope(tx, owner);
      const existing = await owned.where('id', '=', input.id).executeTakeFirst();
      if (existing) {
        if (
          existing.title !== input.title ||
          existing.description !== input.description ||
          existing.cadence !== input.cadence
        ) {
          throw new ConflictException();
        }
        return dto(existing);
      }
      const { count } = await owned
        .clearSelect()
        .select((eb) => eb.fn.countAll().as('count'))
        .executeTakeFirstOrThrow();
      if (Number(count) >= 30) throw new ConflictException();
      const record = await tx
        .insertInto('task_routines')
        .values({
          tenant_id: owner.tenantId,
          user_id: owner.userId,
          id: input.id,
          title: input.title,
          description: input.description,
          cadence: input.cadence,
          next_run_at: new Date(Date.now() + step(input.cadence)),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return dto(record);
    });
  }

  enable(owner: TaskOwner, id: string, enabled: boolean) {
    return this.db.transaction(async (tx) => {
      const record = await scope(tx, owner).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!record) throw new NotFoundException();
      if (record.enabled === enabled) return dto(record);
      const updated = await tx
        .updateTable('task_routines')
        .set({
          enabled,
          next_run_at: enabled ? new Date(Date.now() + step(record.cadence)) : undefined,
        })
        .where('tenant_id', '=', owner.tenantId)
        .where('user_id', '=', owner.userId)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return dto(updated);
    });
  }

  async run(owner: TaskOwner, id: string, scheduled = false, requestId: string = randomUUID()) {
    const traceId = this.context.getId() ?? randomUUID();
    const task = await this.db.transaction(async (tx) => {
      let query = scope(tx, owner).where('id', '=', id).forUpdate();
      if (scheduled)
        query = query
          .where('enabled', '=', true)
          .where('next_run_at', '<=', sql<Date>`now()`)
          .skipLocked();
      const record = await query.executeTakeFirst();
      if (!record && !scheduled) throw new NotFoundException();
      if (!record) return undefined;
      const { row, created } = await this.tasks.createInTransaction(
        tx,
        owner,
        {
          id: requestId,
          title: record.title,
          description: record.description,
          agentId: null,
          dueOn: null,
        },
        undefined,
        traceId,
      );
      if (
        !created &&
        (row.title !== record.title || row.description !== record.description || row.agent_id || row.due_on)
      ) {
        throw new ConflictException();
      }
      if (scheduled) {
        const span = step(record.cadence);
        const previous = record.next_run_at.getTime();
        const next = previous + (Math.floor(Math.max(0, Date.now() - previous) / span) + 1) * span;
        await tx
          .updateTable('task_routines')
          .set({ next_run_at: new Date(next) })
          .where('tenant_id', '=', owner.tenantId)
          .where('user_id', '=', owner.userId)
          .where('id', '=', id)
          .execute();
      }
      return { taskId: row.id, created };
    });
    if (task?.created)
      this.events.emit('task.created', {
        ...owner,
        taskId: task.taskId,
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        traceId,
        status: 'planned',
      });
    return task && { taskId: task.taskId };
  }
}
