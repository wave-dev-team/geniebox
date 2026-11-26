export interface TimeZoneOption {
  id: string;
  /** "GMT+3" in the given locale. */
  offset: string;
  /** Minutes east of UTC, for sorting. */
  minutes: number;
  city: string;
}

function offsetOf(zone: string, locale: string): { label: string; minutes: number } {
  const part = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'shortOffset' })
    .formatToParts(new Date())
    .find((item) => item.type === 'timeZoneName');
  const label = part?.value ?? 'GMT';
  const match = /([+-])(\d{1,2})(?::(\d{2}))?/.exec(label);
  const minutes = match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0)) : 0;
  return { label, minutes };
}

let cache: { locale: string; options: TimeZoneOption[] } | null = null;

/** IANA zones supported by the browser, sorted by UTC offset, then name. */
export function timeZoneOptions(locale: string): TimeZoneOption[] {
  if (cache?.locale === locale) {
    return cache.options;
  }
  const options = Intl.supportedValuesOf('timeZone').map((id) => {
    const { label, minutes } = offsetOf(id, locale);
    return { id, offset: label, minutes, city: id.split('/').pop()!.replaceAll('_', ' ') };
  });
  options.sort((a, b) => a.minutes - b.minutes || a.id.localeCompare(b.id));
  cache = { locale, options };
  return options;
}

export function describeTimeZone(id: string, locale: string): string {
  const { label } = offsetOf(id, locale);
  return `${id.split('/').pop()!.replaceAll('_', ' ')} · ${label}`;
}
