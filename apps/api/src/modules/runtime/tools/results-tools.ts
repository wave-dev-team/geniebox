import { z } from 'zod';

import { Injectable, type OnModuleInit } from '@nestjs/common';

import { addDays, todayIn } from '../../metrics/days.js';
import { CHECK_VERDICTS } from '../../metrics/metrics.constants.js';
import { MetricsRepository } from '../../metrics/repositories/metrics.repository.js';
import { ResultsRepository } from '../../metrics/repositories/results.repository.js';
import { StreamPublisher } from '../../stream/stream.publisher.js';
import { TasksRepository } from '../../work/repositories/tasks.repository.js';
import { defineTool, type ToolExecution } from '../broker/broker.types.js';
import { ToolError } from '../broker/tool-executor.js';
import { ToolRegistry } from '../broker/tool-registry.js';

const text = (max: number) => z.string().trim().min(1).max(max);

const readSchema = z
  .object({
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,40}$/)
      .optional(),
    days: z.number().int().min(7).max(90).default(30),
  })
  .strict();

const insightSchema = z
  .object({
    text: text(600),
    facts: z
      .array(z.object({ label: text(60), value: text(60), highlight: z.boolean().default(false) }).strict())
      .min(1)
      .max(10),
    note: text(300).optional(),
    periodDays: z.number().int().min(1).max(90).optional(),
    decisionId: z.uuid().optional(),
  })
  .strict();

const checkSchema = z
  .object({
    verdict: z.enum(CHECK_VERDICTS),
    result: text(600),
    effectValue: z.number().finite().min(-1e12).max(1e12).optional(),
    comparison: text(160).optional(),
    confidence: text(160).optional(),
    sample: z.number().int().min(0).max(100_000_000).optional(),
    outcome: text(160).optional(),
  })
  .strict();

/**
 * Official metrics for agents (read only), the insight of the day, and the verdict of a
 * check. `record_check` is offered only inside a check task.
 */
@Injectable()
export class ResultsTools implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly metrics: MetricsRepository,
    private readonly results: ResultsRepository,
    private readonly tasks: TasksRepository,
    private readonly stream: StreamPublisher,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      defineTool({
        id: 'metrics_read',
        title: 'Смотреть метрики',
        description:
          'Official metrics of the project: without key — the list with the last values; with key — daily points for N days.',
        kind: 'platform',
        audience: ['agent', 'manager'],
        risk: 'low',
        mutating: false,
        schema: readSchema,
        execute: (ctx, args) => this.read(ctx, args),
      }),
    );
    this.registry.register(
      defineTool({
        id: 'publish_insight',
        title: 'Вывод дня',
        description:
          'Publish the insight of the day on the summary: one finding in 1–3 sentences and the facts it rests on (label and value; highlight the one that matters).',
        kind: 'platform',
        audience: ['agent', 'manager'],
        risk: 'low',
        mutating: false,
        schema: insightSchema,
        execute: (ctx, args) => this.publish(ctx, args),
      }),
    );
    this.registry.register(
      defineTool({
        id: 'record_check',
        title: 'Итог проверки',
        description:
          "Record the verdict of this check: worked (with the effect per month in the metric's units, the comparison with control and the sample), not_worked or inconclusive. Ends the task.",
        kind: 'platform',
        audience: ['agent'],
        risk: 'low',
        mutating: false,
        terminal: true,
        scope: 'check',
        schema: checkSchema,
        execute: (ctx, args) => this.record(ctx, args),
      }),
    );
  }

  private async read(ctx: ToolExecution, args: z.infer<typeof readSchema>) {
    const project = await ctx.tx.db
      .selectFrom('projects')
      .select('timezone')
      .where('id', '=', ctx.projectId)
      .executeTakeFirstOrThrow();
    const to = todayIn(project.timezone);
    const all = await this.metrics.list(ctx.tx.db, ctx.projectId);
    if (!args.key) {
      return {
        metrics: await Promise.all(
          all.map(async (metric) => {
            const last = (await this.metrics.points(ctx.tx.db, metric.id, addDays(to, -6), to)).at(-1);
            return {
              key: metric.key,
              title: metric.title,
              unit: metric.unit,
              aggregation: metric.aggregation,
              hasSource: metric.source !== null,
              last: last ?? null,
            };
          }),
        ),
      };
    }
    const metric = all.find((m) => m.key === args.key);
    if (!metric) throw new ToolError('METRIC_UNKNOWN');
    return {
      key: metric.key,
      unit: metric.unit,
      aggregation: metric.aggregation,
      points: await this.metrics.points(ctx.tx.db, metric.id, addDays(to, 1 - args.days), to),
    };
  }

  private async publish(ctx: ToolExecution, args: z.infer<typeof insightSchema>) {
    if (args.decisionId) {
      const decision = await ctx.tx.db
        .selectFrom('decisions')
        .select('id')
        .where('id', '=', args.decisionId)
        .where('project_id', '=', ctx.projectId)
        .executeTakeFirst();
      if (!decision) throw new ToolError('DECISION_UNKNOWN');
    }
    const insight = await this.results.insertInsight(ctx.tx.db, {
      account_id: ctx.accountId,
      project_id: ctx.projectId,
      agent_id: ctx.agent.id,
      task_id: ctx.taskId,
      text: args.text,
      facts: args.facts.map((fact) => ({ ...fact, highlight: fact.highlight ?? false })),
      note: args.note ?? null,
      period_days: args.periodDays ?? null,
      decision_id: args.decisionId ?? null,
    });
    ctx.tx.afterCommit(() => this.stream.publish(ctx.projectId, { type: 'metrics.updated' }));
    return { insightId: insight.id };
  }

  private async record(ctx: ToolExecution, args: z.infer<typeof checkSchema>) {
    if (!ctx.taskId) throw new ToolError('NO_TASK');
    const check = await this.results.checkOfTask(ctx.tx.db, ctx.taskId);
    if (!check || check.status !== 'running') throw new ToolError('NO_CHECK');
    const idea = check.idea_id ? await this.results.findIdea(ctx.tx.db, check.idea_id) : undefined;
    // An effect counts only against a control group on enough data.
    if (args.verdict === 'worked' && idea) {
      if (args.effectValue === undefined || !args.comparison || args.sample === undefined) {
        throw new ToolError('CHECK_NEEDS_CONTROL');
      }
      if (args.sample < idea.experiment.minSample) throw new ToolError('CHECK_SAMPLE_TOO_SMALL');
    }
    await this.results.transitionCheck(ctx.tx.db, check.id, ['running'], {
      status: 'done',
      verdict: args.verdict,
      result: args.result,
      finished_at: new Date(),
    });
    if (idea && idea.status === 'running') {
      await this.results.updateIdea(ctx.tx.db, idea.id, {
        status: args.verdict === 'worked' ? 'adopted' : 'rejected',
        effect_value: args.verdict === 'worked' ? String(args.effectValue) : '0',
        comparison: args.comparison ?? null,
        confidence: args.confidence ?? null,
        outcome: args.outcome ?? null,
        sample: args.sample ?? null,
        finished_at: new Date(),
      });
    }
    await this.tasks.update(ctx.tx.db, ctx.taskId, { result: args.result });
    ctx.tx.afterCommit(() => this.stream.publish(ctx.projectId, { type: 'metrics.updated' }));
    return { checkId: check.id, verdict: args.verdict };
  }
}
