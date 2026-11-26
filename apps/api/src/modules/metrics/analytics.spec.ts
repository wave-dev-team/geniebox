import { details } from './activity.service.js';
import { cardNumbers, periodTotals, rightStreak, windowValue } from './analytics.js';
import { addDays, dayIn, daysBetween } from './days.js';
import { defaultMetrics } from './metrics.constants.js';

const TODAY = '2026-10-21';

function series(days: number, value: (offset: number) => number) {
  return daysBetween(addDays(TODAY, 1 - days), TODAY).map((day, index, all) => ({
    day,
    value: value(all.length - 1 - index),
  }));
}

describe('days', () => {
  it('adds days across months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });

  it("takes the day in the project's time zone", () => {
    const at = new Date('2026-10-20T22:30:00Z');
    expect(dayIn('Europe/Moscow', at)).toBe('2026-10-21');
    expect(dayIn('UTC', at)).toBe('2026-10-20');
  });
});

describe('windows and cards', () => {
  it('sums a flow and takes the last point of a state, no data is null', () => {
    const map = new Map([
      [TODAY, 10],
      [addDays(TODAY, -2), 5],
    ]);
    expect(windowValue(map, 'sum', TODAY, 7)).toBe(15);
    expect(windowValue(map, 'last', TODAY, 7)).toBe(10);
    expect(windowValue(map, 'sum', addDays(TODAY, -10), 7)).toBeNull();
  });

  it('sees a metric growing for weeks in a row', () => {
    // Each day is worth more the closer it is to today: every week beats the one before.
    const card = cardNumbers(
      series(70, (o) => 100 - o),
      'count',
      'sum',
      'up',
      TODAY,
    );
    expect(card.periodDays).toBe(7);
    expect(card.trend).toBe('growing');
    expect(card.streakWeeks).toBeGreaterThanOrEqual(2);
    expect(card.good).toBe(true);
  });

  it('calls a jump above the usual and judges it by the direction', () => {
    const points = series(70, (o) => (o < 7 ? 20 : 10 + (o % 3)));
    const card = cardNumbers(points, 'percent', 'sum', 'down', TODAY);
    expect(card.trend === 'above_usual' || card.trend === 'growing').toBe(true);
    expect(card.good).toBe(false);
  });

  it('keeps a flat metric usual and a metric without points without data', () => {
    expect(
      cardNumbers(
        series(70, () => 10),
        'count',
        'sum',
        'up',
        TODAY,
      ).trend,
    ).toBe('usual');
    expect(cardNumbers([], 'money', 'sum', 'up', TODAY)).toMatchObject({
      periodDays: 30,
      value: null,
      trend: 'no_data',
      good: null,
    });
  });

  it('totals a chart period and the one before', () => {
    expect(
      periodTotals(
        series(60, () => 2),
        'sum',
        TODAY,
        30,
      ),
    ).toEqual({
      total: 60,
      previous: 60,
    });
  });
});

describe('right streak', () => {
  it('counts right proposals until the first miss', () => {
    const at = (d: number) => new Date(Date.UTC(2026, 9, d));
    expect(
      rightStreak([
        { at: at(20), right: true },
        { at: at(18), right: true },
        { at: at(15), right: false },
        { at: at(10), right: true },
      ]),
    ).toBe(2);
    expect(rightStreak([])).toBe(0);
  });
});

describe('default metrics', () => {
  it('starts with the main metric and does not repeat it', () => {
    const keys = defaultMetrics('revenue', null).map((m) => m.key);
    expect(keys[0]).toBe('revenue');
    expect(new Set(keys).size).toBe(keys.length);
    expect(defaultMetrics('custom', 'Заявки')[0]).toMatchObject({ key: 'custom', title: 'Заявки' });
  });
});

describe('journal details', () => {
  it('shows a few scalars and the error instead of the result', () => {
    expect(details({ args: { days: 7, nested: { a: 1 } }, result: { visits: 12 }, error_code: null })).toBe(
      'days 7 · visits 12',
    );
    expect(details({ args: {}, result: null, error_code: 'NO_CONNECTION' })).toBe('NO_CONNECTION');
  });
});
