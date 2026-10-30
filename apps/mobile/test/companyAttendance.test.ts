import { describe, expect, it } from 'vitest';
import { markAllTargets, stepIso, weekDays } from '../src/lib/companyAttendance';

describe('company attendance helpers', () => {
  it('returns Monday through Sunday for the selected week', () => {
    expect(weekDays('2026-10-30')).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
  });

  it('steps dates and months in UTC', () => {
    expect(stepIso('2026-10-30', 1, 'day')).toBe('2026-10-31');
    expect(stepIso('2026-10-30', 1, 'month')).toBe('2026-11-30');
  });

  it('marks only people who have no mark for the day', () => {
    expect(
      markAllTargets([{ id: 'a' }, { id: 'b' }], new Map([['a|2026-10-30', {}]]), '2026-10-30'),
    ).toEqual(['b']);
  });
});
