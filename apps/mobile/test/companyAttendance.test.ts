import { describe, expect, it } from 'vitest';
import {
  dayCounts,
  markAllTargets,
  riseIsGood,
  signedDelta,
  stepIso,
  weekDays,
} from '../src/lib/companyAttendance';

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

describe('yesterday deltas', () => {
  const marks = new Map<string, { status: 'present' | 'half' | 'absent' }>([
    ['a|2026-10-29', { status: 'present' }],
    ['b|2026-10-29', { status: 'absent' }],
    ['a|2026-10-30', { status: 'present' }],
    ['b|2026-10-30', { status: 'present' }],
    ['c|2026-10-30', { status: 'half' }],
  ]);
  const people = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('counts a day from the same marks map, skipping people not listed', () => {
    expect(dayCounts(people, marks as never, '2026-10-30')).toEqual({
      present: 2,
      half: 1,
      absent: 0,
    });
    expect(dayCounts(people.slice(0, 1), marks as never, '2026-10-29').present).toBe(1);
    expect(dayCounts(people, marks as never, '2026-10-28')).toEqual({
      present: 0,
      half: 0,
      absent: 0,
    });
  });
  it('signs deltas and knows which direction is good', () => {
    expect(signedDelta(2)).toBe('+2');
    expect(signedDelta(-1)).toBe('-1');
    expect(signedDelta(0)).toBe('0');
    expect(riseIsGood('present')).toBe(true);
    expect(riseIsGood('absent')).toBe(false);
    expect(riseIsGood('total')).toBeNull();
  });
});
