import { addDays } from './days.js';
import type { GoodDirection, MetricAggregation, MetricUnit } from './metrics.constants.js';
import type { Point } from './repositories/metrics.repository.js';

export type Trend = 'growing' | 'falling' | 'above_usual' | 'below_usual' | 'usual' | 'no_data';

export interface CardNumbers {
  periodDays: number;
  value: number | null;
  previous: number | null;
  usual: number | null;
  trend: Trend;
  streakWeeks: number;
  good: boolean | null;
}

/** How long the window of a summary card is: a month of money, a week of counts, a state today. */
export function cardPeriod(unit: MetricUnit, aggregation: MetricAggregation): number {
  if (aggregation === 'last') return 1;
  return unit === 'money' ? 30 : 7;
}

/**
 * Value of the window that ends on `to` and is `days` long: a sum for flows, the last point for
 * states. Null when the window has no points at all (no data is not a zero).
 */
export function windowValue(
  points: Map<string, number>,
  aggregation: MetricAggregation,
  to: string,
  days: number,
): number | null {
  let sum = 0;
  let seen = false;
  for (let offset = 0; offset < days; offset++) {
    const value = points.get(addDays(to, -offset));
    if (value === undefined) continue;
    if (aggregation === 'last') return value;
    sum += value;
    seen = true;
  }
  return seen ? sum : null;
}

/** For a state, the last known point not after `to` within a week. */
function stateAt(points: Map<string, number>, to: string): number | null {
  return windowValue(points, 'last', to, 7);
}

export function cardNumbers(
  points: Point[],
  unit: MetricUnit,
  aggregation: MetricAggregation,
  direction: GoodDirection,
  today: string,
): CardNumbers {
  const map = new Map(points.map((p) => [p.day, p.value]));
  const periodDays = cardPeriod(unit, aggregation);
  const at = (end: string) =>
    aggregation === 'last' ? stateAt(map, end) : windowValue(map, aggregation, end, periodDays);
  const step = aggregation === 'last' ? 7 : periodDays;
  const value = at(today);
  const previous = at(addDays(today, -step));
  const history = [1, 2, 3, 4]
    .map((n) => at(addDays(today, -step * n)))
    .filter((v): v is number => v !== null);
  const usual = history.length ? history.reduce((a, b) => a + b, 0) / history.length : null;

  // Weekly windows (7-day sums or weekly states) going back: how many weeks in a row it moved.
  const weekly = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
    aggregation === 'last'
      ? stateAt(map, addDays(today, -7 * n))
      : windowValue(map, 'sum', addDays(today, -7 * n), 7),
  );
  let rising = 0;
  let fallingWeeks = 0;
  for (let i = 0; i < weekly.length - 1; i++) {
    const [now, before] = [weekly[i], weekly[i + 1]];
    if (now === null || before === null || now === undefined || before === undefined) break;
    if (now > before && fallingWeeks === 0) rising++;
    else if (now < before && rising === 0) fallingWeeks++;
    else break;
  }

  let trend: Trend;
  let streakWeeks = 0;
  if (value === null) trend = 'no_data';
  else if (rising >= 2) {
    trend = 'growing';
    streakWeeks = rising;
  } else if (fallingWeeks >= 2) {
    trend = 'falling';
    streakWeeks = fallingWeeks;
  } else if (usual === null || usual === 0) trend = 'usual';
  else if (value > usual * 1.05) trend = 'above_usual';
  else if (value < usual * 0.95) trend = 'below_usual';
  else trend = 'usual';

  const up = trend === 'growing' || trend === 'above_usual';
  const down = trend === 'falling' || trend === 'below_usual';
  const good = trend === 'no_data' ? null : up ? direction === 'up' : down ? direction === 'down' : true;
  return { periodDays, value, previous, usual, trend, streakWeeks, good };
}

/** Total of a chart period and the period before it. */
export function periodTotals(
  points: Point[],
  aggregation: MetricAggregation,
  today: string,
  days: number,
): { total: number | null; previous: number | null } {
  const map = new Map(points.map((p) => [p.day, p.value]));
  return {
    total: windowValue(map, aggregation, today, days),
    previous: windowValue(map, aggregation, addDays(today, -days), days),
  };
}

/**
 * Streak of right proposals: finished checks and rejected proposals, newest first; counts
 * `worked` until the first miss.
 */
export function rightStreak(events: Array<{ at: Date; right: boolean }>): number {
  let streak = 0;
  for (const event of [...events].sort((a, b) => b.at.getTime() - a.at.getTime())) {
    if (!event.right) break;
    streak++;
  }
  return streak;
}
