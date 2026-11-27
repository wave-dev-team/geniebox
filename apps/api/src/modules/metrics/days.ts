const DAY_MS = 24 * 60 * 60 * 1000;

/** Today in the project's time zone as an ISO day. */
export function todayIn(timezone: string, now = new Date()): string {
  return dayIn(timezone, now);
}

export function dayIn(timezone: string, at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Days from `from` to `to` inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to && out.length < 1000; day = addDays(day, 1)) out.push(day);
  return out;
}

export function isIsoDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
