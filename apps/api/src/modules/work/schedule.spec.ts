import { nextRun } from './schedule.js';

describe('routine schedule', () => {
  // 2026-10-21 15:30 in Moscow (UTC+3).
  const from = new Date('2026-10-21T12:30:00Z');

  it('runs daily at the local hour of the project', () => {
    expect(nextRun('daily_18', 'Europe/Moscow', from).toISOString()).toBe('2026-10-21T15:00:00.000Z');
    expect(nextRun('daily_09', 'Europe/Moscow', from).toISOString()).toBe('2026-10-22T06:00:00.000Z');
    expect(nextRun('daily_21', 'Asia/Almaty', from).toISOString()).toBe('2026-10-21T16:00:00.000Z');
  });

  it('runs weekly on Monday morning', () => {
    expect(nextRun('weekly_mon_10', 'Europe/Moscow', from).toISOString()).toBe('2026-10-26T07:00:00.000Z');
  });

  it('aligns intervals to their step', () => {
    expect(nextRun('every_5m', 'UTC', from).toISOString()).toBe('2026-10-21T12:35:00.000Z');
    expect(nextRun('hourly', 'UTC', from).toISOString()).toBe('2026-10-21T13:00:00.000Z');
  });

  it('is strictly after the given moment', () => {
    const at = new Date('2026-10-21T15:00:00Z');
    expect(nextRun('daily_18', 'Europe/Moscow', at).toISOString()).toBe('2026-10-22T15:00:00.000Z');
  });
});
