import { sql } from 'kysely';

import { Injectable } from '@nestjs/common';

import { AccountDb, type AccountTx } from '../../database/scoped-db.js';
import { AGENT_ERRORS, AgentException } from '../agents/agents.errors.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { ProjectContext } from '../projects/project-context.js';
import { DecisionResponseDto } from '../work/dto/decision.dto.js';
import { DecisionsRepository } from '../work/repositories/decisions.repository.js';
import { cardNumbers, periodTotals, rightStreak } from './analytics.js';
import { addDays, todayIn } from './days.js';
import { PointDto } from './dto/metric.dto.js';
import {
  AgentStatsDto,
  CheckItemDto,
  type ExperimentItemDto,
  IdeaResponseDto,
  InsightResponseDto,
  type MetricRefDto,
  ResultsResponseDto,
  SummaryResponseDto,
  type TeamCostDto,
} from './dto/summary.dto.js';
import { type Experiment, MAX_PINNED } from './metrics.constants.js';
import { METRICS_ERRORS, MetricsException } from './metrics.errors.js';
import { type MetricRow, MetricsRepository } from './repositories/metrics.repository.js';
import { ResultsRepository } from './repositories/results.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 182;

interface ProjectInfo {
  timezone: string;
  mainKey: string;
  trustStreak: number;
}

const ref = (metric: MetricRow): MetricRefDto => ({
  id: metric.id,
  key: metric.key,
  title: metric.title,
  unit: metric.unit,
  aggregation: metric.aggregation,
  goodDirection: metric.good_direction,
});

/**
 * Read models of the summary, results and agent numbers. Effects
 * count only when a check with a control group confirmed them (idea `adopted`).
 */
@Injectable()
export class ResultsService {
  constructor(
    private readonly accountDb: AccountDb,
    private readonly metrics: MetricsRepository,
    private readonly results: ResultsRepository,
    private readonly decisions: DecisionsRepository,
    private readonly projectContext: ProjectContext,
    private readonly catalog: CatalogService,
  ) {}

  /** Monthly price of the catalog version the agent runs on; custom agents cost only AI. */
  private priceOf(agent: { template_key: string | null; template_version_id: string | null }): number {
    return (
      this.catalog.forAgent({
        templateKey: agent.template_key,
        templateVersionId: agent.template_version_id,
      })?.content.price ?? 0
    );
  }

  async summary(days: number): Promise<SummaryResponseDto> {
    const { projectId } = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const project = await this.project(tx, projectId);
      const today = todayIn(project.timezone);
      const metrics = await this.metrics.list(tx.db, projectId);
      const history = async (metric: MetricRow) =>
        this.metrics.points(tx.db, metric.id, addDays(today, -HISTORY_DAYS), today);

      const pinned = metrics.filter((m) => m.pinned).slice(0, MAX_PINNED);
      const shown = pinned.length ? pinned : metrics.filter((m) => m.source).slice(0, MAX_PINNED);
      const cards = await Promise.all(
        shown.map(async (metric) => ({
          metric: ref(metric),
          ...cardNumbers(
            await history(metric),
            metric.unit,
            metric.aggregation,
            metric.good_direction,
            today,
          ),
          lastError: metric.last_error,
        })),
      );

      // The main metric when it has data; otherwise the first shown metric that has points.
      const candidates = [...metrics.filter((m) => m.key === project.mainKey), ...shown, ...metrics].filter(
        (m, i, all) => m.source && all.indexOf(m) === i,
      );
      let chart: SummaryResponseDto['chart'] = null;
      for (const candidate of candidates) {
        const points = await history(candidate);
        if (points.length === 0 && candidate !== candidates.at(-1)) continue;
        const totals = periodTotals(points, candidate.aggregation, today, days);
        chart = {
          metric: ref(candidate),
          days,
          points: PointDto.list(points.filter((p) => p.day > addDays(today, -days))),
          total: totals.total,
          previousTotal: totals.previous,
        };
        break;
      }

      const [insight, pending, pendingTotal, done, team, checks, experiments, connections] =
        await Promise.all([
          this.results.latestInsight(tx.db, projectId),
          this.decisions.list(tx.db, projectId, ['pending'], 3),
          this.decisions.countPending(tx.db, projectId),
          tx.db
            .selectFrom('tasks')
            .select(['id', 'agent_id', 'finished_at', 'result', 'summary', 'title'])
            .where('project_id', '=', projectId)
            .where('status', '=', 'done')
            .where('finished_at', '>', new Date(Date.now() - DAY_MS))
            .orderBy('finished_at', 'desc')
            .limit(8)
            .execute(),
          this.teamCost(tx, projectId, metrics, today),
          this.results.upcomingChecks(tx.db, projectId, undefined, 3),
          this.experiments(tx, projectId),
          tx.db
            .selectFrom('connections')
            .select('status')
            .where('project_id', '=', projectId)
            .where('deleted_at', 'is', null)
            .execute(),
        ]);

      return {
        cards,
        connections: {
          total: connections.length,
          ok: connections.filter((c) => c.status === 'ok').length,
          failing: connections.filter((c) => c.status === 'error').length,
        },
        chart,
        insight: insight ? InsightResponseDto.from(insight) : null,
        pendingDecisions: pending.map((row) => DecisionResponseDto.from(row)),
        pendingTotal,
        done: done.map((task) => ({
          taskId: task.id,
          agentId: task.agent_id,
          at: task.finished_at!.toISOString(),
          text: firstLine(task.result) ?? task.title,
        })),
        team,
        checks: checks.map((row) => CheckItemDto.from(row)),
        experiments,
        hasMetrics: metrics.length > 0,
      };
    });
  }

  async insight(id: string): Promise<InsightResponseDto> {
    const { projectId } = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const row = await this.results.findInsight(tx.db, projectId, id);
      if (!row) throw new MetricsException(METRICS_ERRORS.INSIGHT_NOT_FOUND);
      return InsightResponseDto.from(row);
    });
  }

  async resultsFor(days: number, metricKey: string | undefined): Promise<ResultsResponseDto> {
    const { projectId } = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const project = await this.project(tx, projectId);
      const today = todayIn(project.timezone);
      const metrics = await this.metrics.list(tx.db, projectId);
      const metric =
        metrics.find((m) => m.key === (metricKey ?? project.mainKey)) ??
        metrics.find((m) => m.key === 'revenue') ??
        metrics[0];
      const since = new Date(Date.now() - days * DAY_MS);
      const ideas = metric
        ? (await this.results.ideas(tx.db, projectId, since)).filter((idea) => idea.metric_key === metric.key)
        : [];
      const adopted = ideas.filter((idea) => idea.status === 'adopted');
      const brought = adopted.reduce((sum, idea) => sum + (idea.effect_value ?? 0), 0);
      const team = await this.teamCost(tx, projectId, metrics, today);
      const byAgent = new Map<string, { effect: number | null; ideas: number }>();
      for (const idea of ideas) {
        const entry = byAgent.get(idea.agent_id) ?? { effect: null, ideas: 0 };
        entry.ideas++;
        if (idea.status === 'adopted' && idea.effect_value !== null) {
          entry.effect = (entry.effect ?? 0) + idea.effect_value;
        }
        byAgent.set(idea.agent_id, entry);
      }
      const team_agents = await tx.db
        .selectFrom('agents')
        .select('id')
        .where('project_id', '=', projectId)
        .where('kind', '=', 'agent')
        .where('deleted_at', 'is', null)
        .execute();
      const agents = team_agents
        .map((agent) => ({
          agentId: agent.id,
          ...(byAgent.get(agent.id) ?? { effect: null, ideas: 0 }),
        }))
        .sort((a, b) => (b.effect ?? -1) - (a.effect ?? -1) || b.ideas - a.ideas);
      const money = metric?.unit === 'money';
      return {
        metric: metric ? { key: metric.key, title: metric.title, unit: metric.unit } : null,
        metrics: metrics.map((m) => ({ key: m.key, title: m.title, unit: m.unit })),
        days,
        brought,
        team,
        payback: money && team.totalRub > 0 ? round(brought / team.totalRub, 1) : null,
        costPerUnit: !money && brought > 0 ? round(team.totalRub / brought, 2) : null,
        worked: adopted.length,
        notWorked: ideas.filter((idea) => idea.status === 'rejected').length,
        running: ideas.filter((idea) => idea.status === 'running').length,
        ideas: ideas.map((idea) => IdeaResponseDto.from(idea)),
        agents,
      };
    });
  }

  async agentStats(agentId: string): Promise<AgentStatsDto> {
    const { projectId } = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const agent = await tx.db
        .selectFrom('agents')
        .select(['id', 'kind', 'template_key', 'template_version_id', 'limits', 'status'])
        .where('id', '=', agentId)
        .where('project_id', '=', projectId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!agent) throw new AgentException(AGENT_ERRORS.AGENT_NOT_FOUND);
      const project = await this.project(tx, projectId);
      const metrics = await this.metrics.list(tx.db, projectId);
      const main = metrics.find((m) => m.key === project.mainKey) ?? metrics[0];
      const monthStart = sql<Date>`date_trunc('month', now() AT TIME ZONE ${project.timezone}) AT TIME ZONE ${project.timezone}`;
      const [ai, decided, actions, ideas, finished, rejected, checks] = await Promise.all([
        tx.db
          .selectFrom('llm_calls')
          .select((eb) => eb.fn.coalesce(eb.fn.sum<string>('cost_rub'), sql<string>`0`).as('sum'))
          .where('agent_id', '=', agentId)
          .where('created_at', '>=', monthStart)
          .executeTakeFirstOrThrow(),
        tx.db
          .selectFrom('decisions')
          .select(['status'])
          .where('agent_id', '=', agentId)
          .where('status', 'in', ['accepted', 'modified', 'rejected', 'expired'])
          .execute(),
        tx.db
          .selectFrom('tool_calls')
          .select((eb) => eb.fn.countAll<string>().as('count'))
          .where('agent_id', '=', agentId)
          .where('status', '=', 'executed')
          // Actions in services: catalog tools have a dotted id, platform tools do not.
          .where('tool_id', 'like', '%.%')
          .where('created_at', '>', new Date(Date.now() - 7 * DAY_MS))
          .executeTakeFirstOrThrow(),
        this.results.ideasOfAgent(tx.db, agentId),
        this.results.finishedChecks(tx.db, agentId),
        tx.db
          .selectFrom('decisions')
          .select(['decided_at'])
          .where('agent_id', '=', agentId)
          .where('status', '=', 'rejected')
          .orderBy('decided_at', 'desc')
          .limit(50)
          .execute(),
        this.results.upcomingChecks(tx.db, projectId, agentId, 5),
      ]);
      const aiRub = Number(ai.sum);
      const priceRub = this.priceOf(agent);
      const limits = (agent.limits ?? {}) as Record<string, unknown>;
      const aiLimit = Number(limits.ai_budget_monthly);
      const accepted = decided.filter((d) => d.status === 'accepted' || d.status === 'modified');
      const confirmed = ideas.filter((idea) => idea.status === 'adopted');
      const streak = rightStreak([
        ...finished
          .filter((check) => check.verdict !== 'inconclusive')
          .map((check) => ({
            at: check.finished_at ?? check.created_at,
            right: check.verdict === 'worked',
          })),
        ...rejected.filter((d) => d.decided_at).map((d) => ({ at: d.decided_at!, right: false })),
      ]);
      const mainIdeas = confirmed.filter((idea) => main && idea.metric_key === main.key);
      return {
        brought: mainIdeas.length ? mainIdeas.reduce((sum, idea) => sum + (idea.effect_value ?? 0), 0) : null,
        metric: main ? { key: main.key, title: main.title, unit: main.unit } : null,
        costMonthRub: Math.round(aiRub + priceRub),
        aiMonthRub: round(aiRub, 2),
        priceRub,
        aiLimitRub: Number.isFinite(aiLimit) && aiLimit > 0 ? aiLimit : null,
        acceptedPct: decided.length ? Math.round((accepted.length / decided.length) * 100) : null,
        decided: decided.length,
        actionsWeek: Number(actions.count),
        streak,
        streakTarget: project.trustStreak,
        ideas: ideas.length,
        ideasConfirmed: confirmed.length,
        checks: checks.map((row) => CheckItemDto.from(row)),
      };
    });
  }

  private async project(tx: AccountTx, projectId: string): Promise<ProjectInfo> {
    const row = await tx.db
      .selectFrom('projects')
      .select(['timezone', 'main_metric', 'trust_streak'])
      .where('id', '=', projectId)
      .executeTakeFirstOrThrow();
    return { timezone: row.timezone, mainKey: row.main_metric, trustStreak: row.trust_streak };
  }

  /** Agents' monthly prices (catalog) plus AI spend since the start of the month. */
  private async teamCost(
    tx: AccountTx,
    projectId: string,
    metrics: MetricRow[],
    today: string,
  ): Promise<TeamCostDto> {
    const [agents, ai] = await Promise.all([
      tx.db
        .selectFrom('agents')
        .select(['template_key', 'template_version_id', 'kind'])
        .where('project_id', '=', projectId)
        .where('deleted_at', 'is', null)
        .execute(),
      tx.db
        .selectFrom('llm_calls')
        .select((eb) => eb.fn.coalesce(eb.fn.sum<string>('cost_rub'), sql<string>`0`).as('sum'))
        .where('project_id', '=', projectId)
        .where('created_at', '>=', new Date(`${today.slice(0, 8)}01T00:00:00Z`))
        .executeTakeFirstOrThrow(),
    ]);
    const team = agents.filter((a) => a.kind === 'agent');
    const agentsRub = team.reduce((sum, agent) => sum + this.priceOf(agent), 0);
    const aiRub = Number(ai.sum);
    const totalRub = Math.round(agentsRub + aiRub);
    const revenue = metrics.find((m) => m.key === 'revenue' && m.unit === 'money');
    let revenueSharePct: number | null = null;
    if (revenue) {
      const points = await this.metrics.points(tx.db, revenue.id, addDays(today, -29), today);
      const total = points.reduce((sum, p) => sum + p.value, 0);
      if (total > 0) revenueSharePct = round((totalRub / total) * 100, 1);
    }
    return { totalRub, agentsRub, aiRub: round(aiRub, 2), agents: team.length, revenueSharePct };
  }

  /** Running and recently finished experiments, and the ones waiting for the owner's yes. */
  private async experiments(tx: AccountTx, projectId: string): Promise<ExperimentItemDto[]> {
    const ideas = await this.results.ideas(tx.db, projectId, new Date(Date.now() - 14 * DAY_MS));
    const pending = await tx.db
      .selectFrom('decisions')
      .select(['id', 'title', 'experiment'])
      .where('project_id', '=', projectId)
      .where('status', '=', 'pending')
      .where('experiment', 'is not', null)
      .orderBy('created_at', 'desc')
      .limit(3)
      .execute();
    const items: ExperimentItemDto[] = ideas.slice(0, 4).map((idea) => ({
      ideaId: idea.id,
      decisionId: idea.decision_id,
      title: idea.title,
      status: idea.status,
      day:
        idea.status === 'running'
          ? Math.min(
              idea.experiment.durationDays,
              Math.floor((Date.now() - idea.started_at.getTime()) / DAY_MS) + 1,
            )
          : null,
      durationDays: idea.experiment.durationDays,
      outcome: idea.outcome,
    }));
    for (const decision of pending) {
      const experiment = decision.experiment as Experiment | null;
      items.push({
        ideaId: null,
        decisionId: decision.id,
        title: decision.title,
        status: 'pending',
        day: null,
        durationDays: experiment?.durationDays ?? 0,
        outcome: null,
      });
    }
    return items.slice(0, 5);
  }
}

function firstLine(text: string | null): string | null {
  const line = text
    ?.split('\n')
    .find((l) => l.trim())
    ?.trim();
  return line ? line.slice(0, 160) : null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
