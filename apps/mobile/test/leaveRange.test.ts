import { describe, expect, it } from 'vitest';

import {
  isDayDisabled,
  markDays,
  pickDay,
  selectedDays,
  upcomingLeave,
} from '../src/lib/leaveRange';

const sel = (start: string, end: string, picking: 'start' | 'end' = 'start') => ({
  start,
  end,
  picking,
});

describe('pickDay', () => {
  it('picking start moves the end along when it would be before the start', () => {
    expect(pickDay(sel('2026-11-10', '2026-11-12'), '2026-11-15')).toEqual(
      sel('2026-11-15', '2026-11-15', 'end'),
    );
    expect(pickDay(sel('2026-11-10', '2026-11-12'), '2026-11-11')).toEqual(
      sel('2026-11-11', '2026-11-12', 'end'),
    );
  });
  it('picking end sets the end, then goes back to start', () => {
    expect(pickDay(sel('2026-11-10', '2026-11-10', 'end'), '2026-11-14')).toEqual(
      sel('2026-11-10', '2026-11-14'),
    );
  });
  it('tapping before the start resets the start', () => {
    expect(pickDay(sel('2026-11-10', '2026-11-10', 'end'), '2026-11-05')).toEqual(
      sel('2026-11-05', '2026-11-05', 'end'),
    );
  });
  it('the same day as the start is a one-day range', () => {
    expect(pickDay(sel('2026-11-10', '2026-11-10', 'end'), '2026-11-10')).toEqual(
      sel('2026-11-10', '2026-11-10'),
    );
  });
});

describe('selectedDays', () => {
  it('counts every calendar day, inclusive', () => {
    expect(selectedDays(sel('2026-11-10', '2026-11-14'), false)).toBe(5);
  });
  it('half day only counts on a single day', () => {
    expect(selectedDays(sel('2026-11-10', '2026-11-10'), true)).toBe(0.5);
    expect(selectedDays(sel('2026-11-10', '2026-11-11'), true)).toBe(2);
  });
  it('a backwards range is 0', () => {
    expect(selectedDays(sel('2026-11-12', '2026-11-10'), false)).toBe(0);
  });
});

describe('isDayDisabled', () => {
  it('allows 60 days back to 365 ahead', () => {
    expect(isDayDisabled('2026-09-11', '2026-11-10')).toBe(false);
    expect(isDayDisabled('2026-09-10', '2026-11-10')).toBe(true);
    expect(isDayDisabled('2027-11-10', '2026-11-10')).toBe(false);
    expect(isDayDisabled('2027-11-11', '2026-11-10')).toBe(true);
  });
});

describe('markDays', () => {
  it('expands spans inside the window only', () => {
    const m = markDays(
      [{ startDay: '2026-11-09', endDay: '2026-11-12', value: 1 }],
      '2026-11-10',
      '2026-11-11',
    );
    expect(Object.keys(m)).toEqual(['2026-11-10', '2026-11-11']);
  });
});

describe('upcomingLeave', () => {
  const l = (
    id: string,
    memberId: string,
    startDay: string,
    endDay: string,
    status: 'pending' | 'approved' | 'rejected',
  ) => ({ id, memberId, startDay, endDay, status });
  const rows = [
    l('a', 'm1', '2026-11-20', '2026-11-21', 'approved'),
    l('b', 'm1', '2026-11-05', '2026-11-09', 'approved'),
    l('c', 'm2', '2026-11-12', '2026-11-12', 'pending'),
    l('d', 'm1', '2026-11-11', '2026-11-11', 'rejected'),
    l('e', 'm1', '2026-11-08', '2026-11-11', 'approved'),
  ];
  it('keeps today-onward approved/pending, sorted by start', () => {
    expect(upcomingLeave(rows, '2026-11-10').map((x) => x.id)).toEqual(['e', 'c', 'a']);
  });
  it('filters by member, horizon and limit', () => {
    expect(upcomingLeave(rows, '2026-11-10', { memberId: 'm1' }).map((x) => x.id)).toEqual([
      'e',
      'a',
    ]);
    expect(upcomingLeave(rows, '2026-11-10', { withinDays: 5 }).map((x) => x.id)).toEqual([
      'e',
      'c',
    ]);
    expect(upcomingLeave(rows, '2026-11-10', { limit: 1 }).map((x) => x.id)).toEqual(['e']);
  });
});
