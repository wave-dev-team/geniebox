import type { MainMetric } from '../projects/project.constants.js';

export const METRIC_UNITS = ['money', 'count', 'percent'] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];

export const METRIC_AGGREGATIONS = ['sum', 'last'] as const;
export type MetricAggregation = (typeof METRIC_AGGREGATIONS)[number];

export const GOOD_DIRECTIONS = ['up', 'down'] as const;
export type GoodDirection = (typeof GOOD_DIRECTIONS)[number];

/** Where the daily points of an official metric come from, and which provider it needs. */
export const METRIC_SOURCES = {
  'yookassa.revenue': { provider: 'yookassa', unit: 'money', aggregation: 'sum' },
  'yookassa.payments': { provider: 'yookassa', unit: 'count', aggregation: 'sum' },
  'metrika.visits': { provider: 'yandex_metrika', unit: 'count', aggregation: 'sum' },
  'metrika.users': { provider: 'yandex_metrika', unit: 'count', aggregation: 'sum' },
  'postgres.sql': { provider: 'postgres', unit: null, aggregation: null },
  'http_api.series': { provider: 'http_api', unit: null, aggregation: null },
} as const satisfies Record<
  string,
  { provider: string; unit: MetricUnit | null; aggregation: MetricAggregation | null }
>;
export type MetricSourceKind = keyof typeof METRIC_SOURCES;
export const METRIC_SOURCE_KINDS = Object.keys(METRIC_SOURCES) as MetricSourceKind[];

export interface MetricSource {
  kind: MetricSourceKind;
  /** postgres.sql: query with $1 (from) and $2 (to) returning (day, value). */
  query?: string;
  /** http_api.series: path appended to the connection URL. */
  path?: string;
}

export const MAX_PINNED = 3;
export const MAX_METRICS = 20;
/** First collection reaches back this far; later runs refresh the last days only. */
export const BACKFILL_DAYS = 90;
export const REFRESH_DAYS = 3;
export const COLLECT_EVERY_MS = 60 * 60 * 1000;
export const SQL_TIMEOUT_MS = 10_000;
export const SQL_MAX_ROWS = 400;
export const YOOKASSA_MAX_PAGES = 50;

export const IDEA_STATUSES = ['running', 'adopted', 'rejected'] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export const CHECK_STATUSES = ['pending', 'running', 'done', 'failed'] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const CHECK_VERDICTS = ['worked', 'not_worked', 'inconclusive'] as const;
export type CheckVerdict = (typeof CHECK_VERDICTS)[number];

export interface Experiment {
  metricKey: string;
  controlPct: number;
  durationDays: number;
  minSample: number;
  guardrails: string[];
}

export interface CheckSpec {
  inDays: number;
  what: string;
}

export interface InsightFact {
  label: string;
  value: string;
  highlight: boolean;
}

export interface DefaultMetric {
  key: string;
  title: string;
  unit: MetricUnit;
  aggregation: MetricAggregation;
  goodDirection: GoodDirection;
  /** Bound automatically when the project gets this kind of connection. */
  autoSource: MetricSourceKind | null;
}

/** Official metrics a new project starts with, by its main metric. */
export function defaultMetrics(main: MainMetric, customTitle: string | null): DefaultMetric[] {
  const revenue: DefaultMetric = {
    key: 'revenue',
    title: 'Выручка',
    unit: 'money',
    aggregation: 'sum',
    goodDirection: 'up',
    autoSource: 'yookassa.revenue',
  };
  const payments: DefaultMetric = {
    key: 'payments',
    title: 'Оплаты',
    unit: 'count',
    aggregation: 'sum',
    goodDirection: 'up',
    autoSource: 'yookassa.payments',
  };
  const visits: DefaultMetric = {
    key: 'visits',
    title: 'Визиты',
    unit: 'count',
    aggregation: 'sum',
    goodDirection: 'up',
    autoSource: 'metrika.visits',
  };
  const head: DefaultMetric =
    main === 'revenue'
      ? revenue
      : {
          key: main === 'custom' ? 'custom' : main,
          title:
            main === 'active_subscriptions'
              ? 'Активные подписки'
              : main === 'subscribers'
                ? 'Подписчики'
                : main === 'uptime'
                  ? 'Доступность'
                  : (customTitle ?? 'Главная метрика').slice(0, 60),
          unit: main === 'uptime' ? 'percent' : 'count',
          aggregation: 'last',
          goodDirection: 'up',
          autoSource: null,
        };
  return [head, ...[revenue, payments, visits].filter((metric) => metric.key !== head.key)];
}
