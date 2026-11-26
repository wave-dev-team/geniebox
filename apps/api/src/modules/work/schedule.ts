/**
 * Routine schedules. Presets instead of free cron: the owner picks from the list, and
 * the next run is computed in the project time zone.
 */
export const SCHEDULES = {
  every_5m: { kind: 'interval', minutes: 5 },
  hourly: { kind: 'interval', minutes: 60 },
  daily_09: { kind: 'daily', hour: 9 },
  daily_18: { kind: 'daily', hour: 18 },
  daily_21: { kind: 'daily', hour: 21 },
  weekly_mon_10: { kind: 'weekly', weekday: 1, hour: 10 },
  // «Постоянно»: a short cycle; the agent itself decides if there is work.
  continuous: { kind: 'interval', minutes: 15 },
} as const satisfies Record<string, Schedule>;

export type ScheduleKey = keyof typeof SCHEDULES;
export const SCHEDULE_KEYS = Object.keys(SCHEDULES) as ScheduleKey[];

type Schedule =
  | { kind: 'interval'; minutes: number }
  | { kind: 'daily'; hour: number }
  | { kind: 'weekly'; weekday: number; hour: number };

export function isScheduleKey(value: string): value is ScheduleKey {
  return Object.hasOwn(SCHEDULES, value);
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Offset of `timeZone` from UTC at `at`, in minutes (Moscow → +180). */
function offsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((local - at.getTime()) / MINUTE);
}

/** Local calendar date (y, m, d, weekday) of `at` in `timeZone`. */
function localDate(timeZone: string, at: Date): { y: number; m: number; d: number; weekday: number } {
  const shifted = new Date(at.getTime() + offsetMinutes(timeZone, at) * MINUTE);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

/** UTC instant of local `hour:00` on the local date (y, m, d) in `timeZone`. */
function atLocal(timeZone: string, y: number, m: number, d: number, hour: number): Date {
  const guess = new Date(Date.UTC(y, m, d, hour));
  return new Date(guess.getTime() - offsetMinutes(timeZone, guess) * MINUTE);
}

/** Next run strictly after `from`. */
export function nextRun(key: ScheduleKey, timeZone: string, from: Date = new Date()): Date {
  const schedule: Schedule = SCHEDULES[key];
  if (schedule.kind === 'interval') {
    const step = schedule.minutes * MINUTE;
    return new Date(Math.floor(from.getTime() / step) * step + step);
  }
  const today = localDate(timeZone, from);
  for (let i = 0; i <= 7; i++) {
    const day = new Date(Date.UTC(today.y, today.m, today.d) + i * DAY);
    if (schedule.kind === 'weekly' && day.getUTCDay() !== schedule.weekday) continue;
    const at = atLocal(timeZone, day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), schedule.hour);
    if (at.getTime() > from.getTime()) return at;
  }
  throw new Error(`No next run for schedule ${key}`);
}
