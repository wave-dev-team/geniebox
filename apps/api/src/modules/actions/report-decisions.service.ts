import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';

import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ClsService } from 'nestjs-cls';

import {
  createWorkTaskSchema,
  metricsReportSchema,
  type ReportDecisionInput,
  reportDecisionSchema,
} from '@workspace/types';

import { homeActor, type WorkspaceActor } from '../../common/auth/request-actor.js';
import { TenantDb } from '../../database/tenant-db.js';
import { AccountsRepository } from '../accounts/accounts.repository.js';
import { TasksRepository } from '../tasks/tasks.repository.js';

@Injectable()
export class ReportDecisionsService {
  constructor(
    private readonly db: TenantDb,
    private readonly accounts: AccountsRepository,
    private readonly tasks: TasksRepository,
    private readonly events: EventEmitter2,
    private readonly context: ClsService,
  ) {}

  async decide(actor: WorkspaceActor, id: string, input: ReportDecisionInput) {
    if ((await this.accounts.role(actor.tenantId, homeActor(actor))) !== 'owner')
      throw new ForbiddenException();
    const traceId = this.context.getId() ?? randomUUID();
    const result = await this.db.transaction(async (tx) => {
      // Serialize competing decisions so the task and decision always commit together.
      await sql`select pg_advisory_xact_lock(hashtextextended(${`report-decision:${actor.tenantId}:${id}`}, 0))`.execute(
        tx,
      );

      const existing = await tx
        .selectFrom('report_decisions')
        .selectAll()
        .where('report_id', '=', id)
        .executeTakeFirst();
      if (existing) {
        if (
          existing.decided_by !== actor.userId ||
          existing.outcome !== input.outcome ||
          existing.rationale !== input.rationale
        ) {
          throw new ConflictException();
        }
        return {
          decision: reportDecisionSchema.parse({
            ...input,
            taskId: existing.task_id,
            decidedAt: existing.created_at.toISOString(),
          }),
          taskCreated: false,
        };
      }

      const stored = await tx
        .selectFrom('metrics_reports')
        .select('payload')
        .where('id', '=', id)
        .executeTakeFirst();
      if (!stored) throw new NotFoundException();
      const report = metricsReportSchema.parse(stored.payload);
      const taskId = input.outcome === 'followUp' ? randomUUID() : null;
      if (taskId) {
        await this.tasks.createInTransaction(
          tx,
          actor,
          createWorkTaskSchema.parse({
            id: taskId,
            title: report.title,
            description: input.rationale,
            agentId: null,
            dueOn: null,
          }),
          undefined,
          traceId,
        );
      }
      const saved = await tx
        .insertInto('report_decisions')
        .values({
          tenant_id: actor.tenantId,
          report_id: id,
          decided_by: actor.userId,
          outcome: input.outcome,
          rationale: input.rationale,
          task_id: taskId,
        })
        .returning('created_at')
        .executeTakeFirstOrThrow();
      return {
        decision: reportDecisionSchema.parse({
          ...input,
          taskId,
          decidedAt: saved.created_at.toISOString(),
        }),
        taskCreated: Boolean(taskId),
      };
    });
    if (result.taskCreated) {
      this.events.emit('task.created', {
        tenantId: actor.tenantId,
        userId: actor.userId,
        taskId: result.decision.taskId,
        eventId: randomUUID(),
        occurredAt: result.decision.decidedAt,
        traceId,
        status: 'planned',
      });
    }
    return result.decision;
  }
}
