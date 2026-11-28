import { z } from 'zod';

import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../../config/env.schema.js';
import { OutboxService } from '../../../outbox/outbox.service.js';
import { ScheduledTasksService } from '../../../scheduling/scheduled-tasks.service.js';
import { StreamPublisher } from '../../stream/stream.publisher.js';
import {
  type DecisionCreatedEvent,
  type RoutineChangedEvent,
  type TaskRunRequestedEvent,
  WORK_EVENTS,
} from '../../work/events/work.events.js';
import { ConversationsRepository } from '../../work/repositories/conversations.repository.js';
import { DecisionsRepository } from '../../work/repositories/decisions.repository.js';
import { RoutinesRepository } from '../../work/repositories/routines.repository.js';
import { TasksRepository } from '../../work/repositories/tasks.repository.js';
import { nextRun, SCHEDULE_KEYS } from '../../work/schedule.js';
import { RISKS } from '../../work/work.constants.js';
import { defineTool, llmToolName, type ToolExecution } from '../broker/broker.types.js';
import { ToolError } from '../broker/tool-executor.js';
import { ToolRegistry } from '../broker/tool-registry.js';
import { RUNTIME_TASKS } from '../runtime.jobs.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const text = (max: number) => z.string().trim().min(1).max(max);
const fact = z.object({ label: text(40), value: text(160) }).strict();

const MAX_TASK_DEPTH = 3;
const MAX_TASK_CHILDREN = 5;
const MAX_ACTIVE_ROUTINES = 10;

const assignTaskSchema = z
  .object({
    agentId: z.uuid(),
    title: text(160),
    why: text(500),
    steps: z.array(text(160)).max(6).optional(),
    delayHours: z
      .number()
      .min(0)
      .max(24 * 30)
      .optional(),
    waitForResult: z.boolean().optional(),
  })
  .strict();

const assignRoutineSchema = z
  .object({
    agentId: z.uuid(),
    title: text(120),
    description: text(1000).optional(),
    schedule: z.enum(SCHEDULE_KEYS),
  })
  .strict();

const reportProgressSchema = z
  .object({
    steps: z.array(text(160)).min(1).max(8).optional(),
    currentStep: z.number().int().min(0).max(7).optional(),
    progressText: text(60).optional(),
    progressPct: z.number().int().min(0).max(100).optional(),
    summary: text(200).optional(),
  })
  .strict();

const termOption = z
  .object({
    value: text(40),
    label: text(40),
    effect: text(80).optional(),
    cost: text(80).optional(),
  })
  .strict();

const proposeDecisionSchema = z
  .object({
    title: text(160),
    meta: text(200).optional(),
    effect: text(80).optional(),
    cost: text(80).optional(),
    risk: z.enum(RISKS),
    riskNote: text(160).optional(),
    why: z.array(text(200)).min(1).max(6),
    plan: z.array(fact).max(6).optional(),
    terms: z
      .object({ label: text(40), proposed: text(40), options: z.array(termOption).min(2).max(5) })
      .strict()
      .refine((terms) => terms.options.some((option) => option.value === terms.proposed), {
        message: 'proposed must be one of options',
      })
      .optional(),
    yesLabel: text(40).optional(),
    yesText: text(200).optional(),
    experiment: z
      .object({
        metricKey: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
        controlPct: z.number().int().min(5).max(50),
        durationDays: z.number().int().min(3).max(60),
        minSample: z.number().int().min(10).max(10_000_000),
        guardrails: z.array(text(60)).max(4).default([]),
      })
      .strict()
      .optional(),
    check: z
      .object({ inDays: z.number().int().min(1).max(60), what: text(160) })
      .strict()
      .optional(),
    actions: z
      .array(
        z
          .object({
            toolId: z.string().regex(/^[a-z][a-z0-9_.]{1,60}$/),
            args: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .max(5)
      .optional(),
  })
  .strict();

const finishTaskSchema = z
  .object({
    result: text(2000),
    summary: text(200).optional(),
    facts: z.array(fact).max(6).optional(),
  })
  .strict();

const continueTaskSchema = z
  .object({
    nextTitle: text(160),
    nextPrompt: text(2000),
    summary: text(200),
  })
  .strict();

const noteSchema = z.object({ text: text(300) }).strict();
const emptySchema = z.object({}).strict();

/**
 * Work inside Geniebox (no outside effects): delegate a task, report progress, propose a
 * decision, finish, look at the project, keep a note. Every call still goes through the broker.
 */
@Injectable()
export class PlatformTools implements OnModuleInit {
  private readonly decisionTtlDays: number;

  constructor(
    private readonly registry: ToolRegistry,
    private readonly tasks: TasksRepository,
    private readonly routines: RoutinesRepository,
    private readonly decisions: DecisionsRepository,
    private readonly conversations: ConversationsRepository,
    private readonly outbox: OutboxService,
    private readonly stream: StreamPublisher,
    private readonly scheduler: ScheduledTasksService,
    config: ConfigService<Env, true>,
  ) {
    this.decisionTtlDays = config.get('DECISION_TTL_DAYS', { infer: true });
  }

  onModuleInit(): void {
    const tools = [
      defineTool({
        id: 'assign_task',
        title: 'Поручить задачу',
        description:
          'Give a task to an agent of the team (use the id from <team>). Optionally set delayHours for delayed execution. When called from a task, the parent waits for the result by default.',
        kind: 'platform',
        audience: ['manager', 'agent'],
        risk: 'low',
        mutating: false,
        schema: assignTaskSchema,
        execute: (ctx, args) => this.assignTask(ctx, args),
      }),
      defineTool({
        id: 'assign_routine',
        title: 'Создать регулярную задачу',
        description:
          'Create a recurring routine for an agent of the team on a preset schedule (every_5m, hourly, daily_09, daily_18, daily_21, weekly_mon_10, continuous).',
        kind: 'platform',
        audience: ['manager', 'agent'],
        risk: 'low',
        mutating: false,
        schema: assignRoutineSchema,
        execute: (ctx, args) => this.assignRoutine(ctx, args),
      }),
      defineTool({
        id: 'report_progress',
        title: 'Ход выполнения',
        description:
          'Plan the steps of the current task once (steps), then move through them (currentStep) and show progress.',
        kind: 'platform',
        audience: ['agent', 'manager'],
        risk: 'low',
        mutating: false,
        schema: reportProgressSchema,
        execute: (ctx, args) => this.reportProgress(ctx, args),
      }),
      defineTool({
        id: 'propose_decision',
        title: 'Предложить решение',
        description:
          "Propose something that needs the owner's yes: effect, cost, risk, reasons, how it will be checked, optional changeable terms, the broker actions to run on yes, and for a measurable effect an experiment with a control group and a check. Ends your turn.",
        kind: 'platform',
        audience: ['agent'],
        risk: 'low',
        mutating: false,
        terminal: true,
        schema: proposeDecisionSchema,
        execute: (ctx, args) => this.proposeDecision(ctx, args),
      }),
      defineTool({
        id: 'finish_task',
        title: 'Завершить задачу',
        description: 'Finish the current task with a short result for the owner. Ends your turn.',
        kind: 'platform',
        audience: ['agent', 'manager'],
        risk: 'low',
        mutating: false,
        terminal: true,
        schema: finishTaskSchema,
        execute: (ctx, args) => this.finishTask(ctx, args),
      }),
      defineTool({
        id: 'continue_task',
        title: 'Продолжить задачу',
        description:
          'Save intermediate progress and schedule an immediate follow-up task for yourself to continue long multi-step analysis without hitting the step limit. Ends your turn.',
        kind: 'platform',
        audience: ['agent'],
        risk: 'low',
        mutating: false,
        terminal: true,
        schema: continueTaskSchema,
        execute: (ctx, args) => this.continueTask(ctx, args),
      }),
      defineTool({
        id: 'project_overview',
        title: 'Обзор проекта',
        description: 'Team, tasks, pending decisions and connections of the project right now.',
        kind: 'platform',
        audience: ['agent', 'manager'],
        risk: 'low',
        mutating: false,
        schema: emptySchema,
        execute: (ctx) => this.overview(ctx),
      }),
      defineTool({
        id: 'notes_write',
        title: 'Записать вывод',
        description: 'Save a short, verified conclusion about the project for future work.',
        kind: 'platform',
        audience: ['agent'],
        risk: 'low',
        mutating: false,
        schema: noteSchema,
        execute: (ctx, args) => this.writeNote(ctx, args),
      }),
    ];
    for (const tool of tools) this.registry.register(tool);
  }

  private async assignTask(ctx: ToolExecution, args: z.infer<typeof assignTaskSchema>) {
    const project = await ctx.tx.db
      .selectFrom('projects')
      .select('agents_paused')
      .where('id', '=', ctx.projectId)
      .where('deleted_at', 'is', null)
      .forShare()
      .executeTakeFirst();
    if (!project || project.agents_paused) throw new ToolError('KILL_SWITCH_PROJECT');
    const agent = await ctx.tx.db
      .selectFrom('agents')
      .select(['id', 'kind', 'status'])
      .where('id', '=', args.agentId)
      .where('project_id', '=', ctx.projectId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!agent || agent.kind !== 'agent') throw new ToolError('AGENT_NOT_IN_TEAM');
    if (agent.status === 'paused') throw new ToolError('AGENT_PAUSED');

    if (ctx.taskId) {
      let depth = 0;
      let cursorId: string | null = ctx.taskId;
      while (cursorId && depth < MAX_TASK_DEPTH) {
        const parent = await this.tasks.findById(ctx.tx.db, cursorId);
        if (!parent?.parent_task_id) break;
        depth++;
        cursorId = parent.parent_task_id;
      }
      if (depth >= MAX_TASK_DEPTH) throw new ToolError('TASK_DEPTH_LIMIT');

      const siblings = await this.tasks.listByParent(ctx.tx.db, ctx.taskId);
      if (siblings.length >= MAX_TASK_CHILDREN) throw new ToolError('TASK_CHILDREN_LIMIT');

      if (agent.id === ctx.agent.id && (!args.delayHours || args.delayHours < 1)) {
        throw new ToolError('TASK_SELF_DELEGATION');
      }
    }

    const delayMs = args.delayHours ? Math.round(args.delayHours * 3600_000) : 0;
    const scheduledAt = new Date(Date.now() + delayMs);
    const origin = ctx.agent.kind === 'manager' ? 'manager' : 'agent';

    const task = await this.tasks.insert(
      ctx.tx.db,
      {
        account_id: ctx.accountId,
        project_id: ctx.projectId,
        agent_id: agent.id,
        parent_task_id: ctx.taskId ?? null,
        assigned_by_agent_id: ctx.agent.id,
        title: args.title,
        description: args.why,
        origin,
        mode: ctx.mode,
        conversation_id: ctx.conversationId,
        scheduled_at: scheduledAt,
        created_by: ctx.userId,
      },
      args.steps ?? [],
    );
    if (ctx.replyMessageId) {
      await this.conversations.addCard(ctx.tx.db, ctx.replyMessageId, { type: 'task', id: task.id });
    }
    if (delayMs > 0) {
      await this.scheduler.schedule(ctx.tx, {
        type: RUNTIME_TASKS.TASK_RUN,
        payload: {
          accountId: ctx.accountId,
          projectId: ctx.projectId,
          taskId: task.id,
          userId: ctx.userId,
        },
        runAt: scheduledAt,
        dedupeKey: `task:${task.id}`,
      });
    } else {
      await this.outbox.add<TaskRunRequestedEvent>(ctx.tx, {
        type: WORK_EVENTS.TASK_RUN_REQUESTED,
        payload: { projectId: ctx.projectId, taskId: task.id, byUserId: ctx.userId },
      });
    }
    ctx.tx.afterCommit(() => this.stream.publish(ctx.projectId, { type: 'task.updated', taskId: task.id }));
    return { taskId: task.id, status: 'planned', scheduledAt: scheduledAt.toISOString() };
  }

  private async assignRoutine(ctx: ToolExecution, args: z.infer<typeof assignRoutineSchema>) {
    const project = await ctx.tx.db
      .selectFrom('projects')
      .select(['agents_paused', 'timezone'])
      .where('id', '=', ctx.projectId)
      .where('deleted_at', 'is', null)
      .forShare()
      .executeTakeFirst();
    if (!project || project.agents_paused) throw new ToolError('KILL_SWITCH_PROJECT');
    const agent = await ctx.tx.db
      .selectFrom('agents')
      .select(['id', 'kind', 'status'])
      .where('id', '=', args.agentId)
      .where('project_id', '=', ctx.projectId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!agent || agent.kind !== 'agent') throw new ToolError('AGENT_NOT_IN_TEAM');
    if (agent.status === 'paused') throw new ToolError('AGENT_PAUSED');

    const existing = await this.routines.list(ctx.tx.db, ctx.projectId);
    const normalized = args.title.trim().toLowerCase();
    const duplicate = existing.find(
      (r) => r.agent_id === agent.id && r.enabled && r.title.trim().toLowerCase() === normalized,
    );
    if (duplicate) {
      return { routineId: duplicate.id, deduplicated: true };
    }
    if (existing.filter((r) => r.enabled).length >= MAX_ACTIVE_ROUTINES) {
      throw new ToolError('ROUTINE_LIMIT');
    }

    const routine = await this.routines.insert(ctx.tx.db, {
      account_id: ctx.accountId,
      project_id: ctx.projectId,
      agent_id: agent.id,
      assigned_by_agent_id: ctx.agent.id,
      title: args.title,
      description: args.description ?? null,
      schedule: args.schedule,
      enabled: true,
      next_run_at: nextRun(args.schedule, project.timezone),
      created_by: ctx.userId,
    });
    if (!routine) throw new ToolError('ROUTINE_CREATE_FAILED');

    await this.outbox.add<RoutineChangedEvent>(ctx.tx, {
      type: WORK_EVENTS.ROUTINE_CHANGED,
      payload: { projectId: ctx.projectId, routineId: routine.id, byUserId: ctx.userId ?? ctx.agent.id },
    });
    ctx.tx.afterCommit(() =>
      this.stream.publish(ctx.projectId, { type: 'routine.updated', routineId: routine.id }),
    );
    return { routineId: routine.id, schedule: routine.schedule };
  }

  private async reportProgress(ctx: ToolExecution, args: z.infer<typeof reportProgressSchema>) {
    if (!ctx.taskId) throw new ToolError('NO_TASK');
    const steps = await this.tasks.listSteps(ctx.tx.db, [ctx.taskId]);
    if (args.steps && steps.length === 0) {
      await this.tasks.replaceSteps(ctx.tx.db, ctx.accountId, ctx.taskId, args.steps);
    }
    const count = steps.length || args.steps?.length || 0;
    if (args.currentStep !== undefined && args.currentStep < count) {
      for (let position = 0; position < args.currentStep; position++) {
        await this.tasks.setStep(ctx.tx.db, ctx.taskId, position, 'done');
      }
      await this.tasks.setStep(ctx.tx.db, ctx.taskId, args.currentStep, 'current');
    }
    const patch = {
      ...(args.progressText ? { progress_text: args.progressText } : {}),
      ...(args.progressPct !== undefined ? { progress_pct: args.progressPct } : {}),
      ...(args.summary ? { summary: args.summary } : {}),
    };
    if (Object.keys(patch).length > 0) {
      await this.tasks.update(ctx.tx.db, ctx.taskId, patch);
    }
    const taskId = ctx.taskId;
    ctx.tx.afterCommit(() => this.stream.publish(ctx.projectId, { type: 'task.updated', taskId }));
    return { ok: true };
  }

  private async proposeDecision(ctx: ToolExecution, args: z.infer<typeof proposeDecisionSchema>) {
    if (await this.decisions.inCooldown(ctx.tx.db, ctx.agent.id, args.title)) {
      throw new ToolError('DECISION_COOLDOWN');
    }
    if (args.experiment) {
      const metric = await ctx.tx.db
        .selectFrom('metric_definitions')
        .select('id')
        .where('project_id', '=', ctx.projectId)
        .where('key', '=', args.experiment.metricKey)
        .executeTakeFirst();
      if (!metric) {
        const available = await ctx.tx.db
          .selectFrom('metric_definitions')
          .select('key')
          .where('project_id', '=', ctx.projectId)
          .execute();
        throw new ToolError('METRIC_UNKNOWN', {
          availableMetricKeys: available.map((m) => m.key),
        });
      }
    }
    const normalizedActions: Array<{ toolId: string; args: Record<string, unknown> }> = [];
    for (const action of args.actions ?? []) {
      const stripped = action.toolId.replace(/^functions\./, '');
      const tool =
        this.registry.get(stripped) ??
        this.registry.all().find((candidate) => llmToolName(candidate.id) === stripped);
      if (!tool?.mutating || tool.kind !== 'catalog') throw new ToolError('ACTION_NOT_ALLOWED');
      if (!tool.schema.safeParse(action.args).success) throw new ToolError('ACTION_ARGUMENTS_INVALID');
      normalizedActions.push({ toolId: tool.id, args: action.args });
    }
    const decision = await this.decisions.insert(ctx.tx.db, {
      account_id: ctx.accountId,
      project_id: ctx.projectId,
      agent_id: ctx.agent.id,
      task_id: ctx.taskId,
      title: args.title,
      meta: args.meta ?? null,
      effect: args.effect ?? null,
      cost: args.cost ?? null,
      risk: args.risk,
      risk_note: args.riskNote ?? null,
      why: args.why,
      plan: args.plan ?? [],
      terms: args.terms
        ? {
            label: args.terms.label,
            proposed: args.terms.proposed,
            options: args.terms.options.map((option) => ({
              value: option.value,
              label: option.label,
              effect: option.effect ?? null,
              cost: option.cost ?? null,
            })),
          }
        : null,
      yes_label: args.yesLabel ?? 'Да',
      yes_text: args.yesText ?? null,
      pending_actions: normalizedActions,
      experiment: args.experiment ? JSON.stringify(args.experiment) : null,
      check_spec: args.check ? JSON.stringify(args.check) : null,
      expires_at: new Date(Date.now() + this.decisionTtlDays * DAY_MS),
    });
    if (ctx.replyMessageId) {
      await this.conversations.addCard(ctx.tx.db, ctx.replyMessageId, {
        type: 'decision',
        id: decision.id,
      });
    }
    await this.outbox.add<DecisionCreatedEvent>(ctx.tx, {
      type: WORK_EVENTS.DECISION_CREATED,
      payload: { projectId: ctx.projectId, decisionId: decision.id },
    });
    await this.scheduler.schedule(ctx.tx, {
      type: RUNTIME_TASKS.DECISION_EXPIRE,
      payload: { decisionId: decision.id },
      runAt: decision.expires_at!,
      dedupeKey: decision.id,
    });
    ctx.tx.afterCommit(() =>
      this.stream.publish(ctx.projectId, { type: 'decision.updated', decisionId: decision.id }),
    );
    return { decisionId: decision.id, status: 'pending' };
  }

  private async finishTask(ctx: ToolExecution, args: z.infer<typeof finishTaskSchema>) {
    if (!ctx.taskId) throw new ToolError('NO_TASK');
    await this.tasks.update(ctx.tx.db, ctx.taskId, {
      result: args.result,
      summary: args.summary ?? null,
      ...(args.facts ? { facts: args.facts } : {}),
    });
    return { ok: true };
  }

  private async continueTask(ctx: ToolExecution, args: z.infer<typeof continueTaskSchema>) {
    if (!ctx.taskId) throw new ToolError('NO_TASK');
    const current = await this.tasks.findById(ctx.tx.db, ctx.taskId);
    if (!current) throw new ToolError('NO_TASK');
    await this.tasks.update(ctx.tx.db, ctx.taskId, {
      result: args.summary,
      summary: args.summary,
    });
    const next = await this.tasks.insert(
      ctx.tx.db,
      {
        account_id: ctx.accountId,
        project_id: ctx.projectId,
        agent_id: ctx.agent.id,
        parent_task_id: current.parent_task_id ?? null,
        assigned_by_agent_id: ctx.agent.id,
        title: args.nextTitle,
        description: args.nextPrompt,
        origin: 'agent',
        mode: ctx.mode,
        conversation_id: ctx.conversationId,
        scheduled_at: new Date(),
        created_by: ctx.userId,
      },
      [],
    );
    await this.outbox.add<TaskRunRequestedEvent>(ctx.tx, {
      type: WORK_EVENTS.TASK_RUN_REQUESTED,
      payload: { projectId: ctx.projectId, taskId: next.id, byUserId: ctx.userId },
    });
    ctx.tx.afterCommit(() => this.stream.publish(ctx.projectId, { type: 'task.updated', taskId: next.id }));
    return { continuedTaskId: next.id };
  }

  private async overview(ctx: ToolExecution) {
    const db = ctx.tx.db;
    const [team, tasks, pending, connections, recent] = await Promise.all([
      db
        .selectFrom('agents')
        .select(['display_name', 'template_key', 'status', 'kind'])
        .where('project_id', '=', ctx.projectId)
        .where('deleted_at', 'is', null)
        .execute(),
      this.tasks.countByStatus(db, ctx.projectId),
      this.decisions.countPending(db, ctx.projectId),
      db
        .selectFrom('connections')
        .select(['name', 'provider_key', 'status'])
        .where('project_id', '=', ctx.projectId)
        .where('deleted_at', 'is', null)
        .execute(),
      db
        .selectFrom('tasks')
        .select(['title', 'result', 'finished_at'])
        .where('project_id', '=', ctx.projectId)
        .where('status', '=', 'done')
        .where('finished_at', '>', new Date(Date.now() - DAY_MS))
        .orderBy('finished_at', 'desc')
        .limit(10)
        .execute(),
    ]);
    return {
      team: team
        .filter((agent) => agent.kind === 'agent')
        .map((agent) => ({ name: agent.template_key ?? agent.display_name, status: agent.status })),
      tasks,
      pendingDecisions: pending,
      connections: connections.map((c) => ({
        name: c.name,
        provider: c.provider_key,
        status: c.status,
      })),
      doneLastDay: recent.map((task) => ({
        title: task.title,
        result: task.result?.slice(0, 200) ?? null,
      })),
    };
  }

  private async writeNote(ctx: ToolExecution, args: z.infer<typeof noteSchema>) {
    await ctx.tx.db
      .insertInto('agent_notes')
      .values({ account_id: ctx.accountId, agent_id: ctx.agent.id, text: args.text })
      .execute();
    return { ok: true };
  }
}
