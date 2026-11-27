import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { DecisionResponseDto } from '../../work/dto/decision.dto.js';
import type { Trend } from '../analytics.js';
import {
  CHECK_STATUSES,
  CHECK_VERDICTS,
  type CheckStatus,
  type CheckVerdict,
  GOOD_DIRECTIONS,
  type GoodDirection,
  IDEA_STATUSES,
  type IdeaStatus,
  METRIC_AGGREGATIONS,
  METRIC_UNITS,
  type MetricAggregation,
  type MetricUnit,
} from '../metrics.constants.js';
import type { CheckRow, IdeaRow, InsightRow } from '../repositories/results.repository.js';
import { PointDto } from './metric.dto.js';

const TRENDS = ['growing', 'falling', 'above_usual', 'below_usual', 'usual', 'no_data'] as const;

export class SummaryQueryDto {
  @ApiPropertyOptional({ enum: [7, 30, 90], default: 30, description: 'Chart period' })
  @IsOptional()
  @Type(() => Number)
  @IsIn([7, 30, 90])
  days?: 7 | 30 | 90;
}

export class MetricRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  key: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: METRIC_UNITS })
  unit: MetricUnit;

  @ApiProperty({ enum: METRIC_AGGREGATIONS })
  aggregation: MetricAggregation;

  @ApiProperty({ enum: GOOD_DIRECTIONS })
  goodDirection: GoodDirection;
}

export class SummaryCardDto {
  @ApiProperty({ type: MetricRefDto })
  metric: MetricRefDto;

  @ApiProperty({ description: 'Window of the value: 30 (money), 7 (counts) or 1 (a state)' })
  periodDays: number;

  @ApiProperty({ nullable: true, type: Number })
  value: number | null;

  @ApiProperty({ nullable: true, type: Number, description: 'The window before' })
  previous: number | null;

  @ApiProperty({ nullable: true, type: Number, description: 'Average of the four windows before' })
  usual: number | null;

  @ApiProperty({ enum: TRENDS })
  trend: Trend;

  @ApiProperty({ description: 'Weeks in a row for growing / falling' })
  streakWeeks: number;

  @ApiProperty({ nullable: true, type: Boolean, description: 'Change is good by the direction' })
  good: boolean | null;

  @ApiProperty({ nullable: true, type: String, example: 'UNAUTHORIZED' })
  lastError: string | null;
}

export class ConnectionsHealthDto {
  @ApiProperty()
  total: number;

  @ApiProperty()
  ok: number;

  @ApiProperty()
  failing: number;
}

export class SummaryChartDto {
  @ApiProperty({ type: MetricRefDto })
  metric: MetricRefDto;

  @ApiProperty()
  days: number;

  @ApiProperty({ type: [PointDto] })
  points: PointDto[];

  @ApiProperty({ nullable: true, type: Number })
  total: number | null;

  @ApiProperty({ nullable: true, type: Number })
  previousTotal: number | null;
}

export class InsightFactDto {
  @ApiProperty()
  label: string;

  @ApiProperty()
  value: string;

  @ApiProperty()
  highlight: boolean;
}

export class InsightResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  agentId: string;

  @ApiProperty()
  text: string;

  @ApiProperty({ type: [InsightFactDto] })
  facts: InsightFactDto[];

  @ApiProperty({ nullable: true, type: String })
  note: string | null;

  @ApiProperty({ nullable: true, type: Number })
  periodDays: number | null;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  decisionId: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  static from(row: InsightRow): InsightResponseDto {
    return {
      id: row.id,
      agentId: row.agent_id,
      text: row.text,
      facts: row.facts,
      note: row.note,
      periodDays: row.period_days,
      decisionId: row.decision_id,
      createdAt: row.created_at.toISOString(),
    };
  }
}

export class DoneItemDto {
  @ApiProperty({ format: 'uuid' })
  taskId: string;

  @ApiProperty({ format: 'uuid' })
  agentId: string;

  @ApiProperty({ format: 'date-time' })
  at: string;

  @ApiProperty()
  text: string;
}

export class TeamCostDto {
  @ApiProperty({ description: "Agents' prices plus AI this month, roubles" })
  totalRub: number;

  @ApiProperty()
  agentsRub: number;

  @ApiProperty()
  aiRub: number;

  @ApiProperty()
  agents: number;

  @ApiProperty({ nullable: true, type: Number, description: 'Share of revenue for 30 days, %' })
  revenueSharePct: number | null;
}

export class CheckItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  agentId: string;

  @ApiProperty()
  what: string;

  @ApiProperty({ format: 'date-time' })
  dueAt: string;

  @ApiProperty({ enum: CHECK_STATUSES })
  status: CheckStatus;

  @ApiProperty({ nullable: true, enum: CHECK_VERDICTS })
  verdict: CheckVerdict | null;

  @ApiProperty({ nullable: true, type: String })
  result: string | null;

  static from(row: CheckRow): CheckItemDto {
    return {
      id: row.id,
      agentId: row.agent_id,
      what: row.what,
      dueAt: row.due_at.toISOString(),
      status: row.status,
      verdict: row.verdict,
      result: row.result,
    };
  }
}

export class ExperimentItemDto {
  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  ideaId: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  decisionId: string | null;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: [...IDEA_STATUSES, 'pending'] })
  status: IdeaStatus | 'pending';

  @ApiProperty({ nullable: true, type: Number, description: 'Day of the experiment' })
  day: number | null;

  @ApiProperty()
  durationDays: number;

  @ApiProperty({ nullable: true, type: String })
  outcome: string | null;
}

export class SummaryResponseDto {
  @ApiProperty({ type: [SummaryCardDto] })
  cards: SummaryCardDto[];

  @ApiProperty({ type: ConnectionsHealthDto })
  connections: ConnectionsHealthDto;

  @ApiProperty({ nullable: true, type: SummaryChartDto })
  chart: SummaryChartDto | null;

  @ApiProperty({ nullable: true, type: InsightResponseDto })
  insight: InsightResponseDto | null;

  @ApiProperty({ type: [DecisionResponseDto] })
  pendingDecisions: DecisionResponseDto[];

  @ApiProperty()
  pendingTotal: number;

  @ApiProperty({ type: [DoneItemDto] })
  done: DoneItemDto[];

  @ApiProperty({ type: TeamCostDto })
  team: TeamCostDto;

  @ApiProperty({ type: [CheckItemDto] })
  checks: CheckItemDto[];

  @ApiProperty({ type: [ExperimentItemDto] })
  experiments: ExperimentItemDto[];

  @ApiProperty({ description: 'The project has official metrics' })
  hasMetrics: boolean;
}

export class IdeaResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  agentId: string;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  decisionId: string | null;

  @ApiProperty()
  metricKey: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: IDEA_STATUSES })
  status: IdeaStatus;

  @ApiProperty({ nullable: true, type: Number, description: 'Metric units per month' })
  effectValue: number | null;

  @ApiProperty({ nullable: true, type: String, example: '71% против 66% у контроля' })
  comparison: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'надёжно, выборка 2 100' })
  confidence: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Оставили для всех' })
  outcome: string | null;

  @ApiProperty()
  durationDays: number;

  @ApiProperty()
  controlPct: number;

  @ApiProperty({ format: 'date-time' })
  startedAt: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  finishedAt: string | null;

  static from(row: IdeaRow): IdeaResponseDto {
    return {
      id: row.id,
      agentId: row.agent_id,
      decisionId: row.decision_id,
      metricKey: row.metric_key,
      title: row.title,
      status: row.status,
      effectValue: row.effect_value,
      comparison: row.comparison,
      confidence: row.confidence,
      outcome: row.outcome,
      durationDays: row.experiment.durationDays,
      controlPct: row.experiment.controlPct,
      startedAt: row.started_at.toISOString(),
      finishedAt: row.finished_at?.toISOString() ?? null,
    };
  }
}

export class AgentContributionDto {
  @ApiProperty({ format: 'uuid' })
  agentId: string;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Confirmed effect, metric units/month',
  })
  effect: number | null;

  @ApiProperty({ description: 'Ideas of the agent in the period' })
  ideas: number;
}

export class ResultsMetricDto {
  @ApiProperty()
  key: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: METRIC_UNITS })
  unit: MetricUnit;
}

export class ResultsResponseDto {
  @ApiProperty({ nullable: true, type: ResultsMetricDto })
  metric: ResultsMetricDto | null;

  @ApiProperty({ type: [ResultsMetricDto], description: 'Metrics to choose from' })
  metrics: ResultsMetricDto[];

  @ApiProperty()
  days: number;

  @ApiProperty({ description: 'Confirmed effect of adopted ideas, metric units per month' })
  brought: number;

  @ApiProperty({ type: TeamCostDto })
  team: TeamCostDto;

  @ApiProperty({ nullable: true, type: Number, description: 'Money metric: brought / team cost' })
  payback: number | null;

  @ApiProperty({ nullable: true, type: Number, description: 'Other metric: roubles per unit' })
  costPerUnit: number | null;

  @ApiProperty()
  worked: number;

  @ApiProperty()
  notWorked: number;

  @ApiProperty()
  running: number;

  @ApiProperty({ type: [IdeaResponseDto] })
  ideas: IdeaResponseDto[];

  @ApiProperty({ type: [AgentContributionDto] })
  agents: AgentContributionDto[];
}

export class AgentStatsDto {
  @ApiProperty({ nullable: true, type: Number, description: 'Confirmed effect, main metric/month' })
  brought: number | null;

  @ApiProperty({ nullable: true, type: ResultsMetricDto })
  metric: ResultsMetricDto | null;

  @ApiProperty({ description: "AI this month plus the agent's price, roubles" })
  costMonthRub: number;

  @ApiProperty()
  aiMonthRub: number;

  @ApiProperty()
  priceRub: number;

  @ApiProperty({ nullable: true, type: Number })
  aiLimitRub: number | null;

  @ApiProperty({ nullable: true, type: Number, description: 'Accepted of decided proposals, %' })
  acceptedPct: number | null;

  @ApiProperty()
  decided: number;

  @ApiProperty({ description: 'Actions in services for 7 days, own and approved' })
  actionsWeek: number;

  @ApiProperty({ description: 'Right proposals in a row' })
  streak: number;

  @ApiProperty()
  streakTarget: number;

  @ApiProperty()
  ideas: number;

  @ApiProperty()
  ideasConfirmed: number;

  @ApiProperty({ type: [CheckItemDto] })
  checks: CheckItemDto[];
}

export const ACTIVITY_PERIODS = ['today', '7d', '30d'] as const;
export const ACTIVITY_RESULTS = ['ok', 'approval', 'refused', 'failed'] as const;

export class ActivityQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  agentId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  connectionId?: string;

  @ApiPropertyOptional({ enum: ACTIVITY_RESULTS })
  @IsOptional()
  @IsIn(ACTIVITY_RESULTS)
  result?: (typeof ACTIVITY_RESULTS)[number];

  @ApiPropertyOptional({ enum: ACTIVITY_PERIODS, default: 'today' })
  @IsOptional()
  @IsIn(ACTIVITY_PERIODS)
  period?: (typeof ACTIVITY_PERIODS)[number];

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page' })
  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{8,120}$/)
  cursor?: string;
}

export class ActivityItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'date-time' })
  at: string;

  @ApiProperty({ format: 'uuid' })
  agentId: string;

  @ApiProperty({ example: 'analytics.read' })
  toolId: string;

  @ApiProperty({ example: 'days 7 · visits 1 240' })
  details: string;

  @ApiProperty({ nullable: true, enum: ['auto', 'notify', 'approve', 'deny'] })
  mode: string | null;

  @ApiProperty({ enum: ['executed', 'approval', 'denied', 'rejected', 'failed', 'blocked'] })
  status: string;

  @ApiProperty({ nullable: true, type: String })
  errorCode: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  connectionId: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  taskId: string | null;
}

export class ActivityPageDto {
  @ApiProperty({ type: [ActivityItemDto] })
  items: ActivityItemDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor: string | null;
}
