import { describe, expect, it } from 'vitest';

import { daysBetween, hasDue, mergeUpcoming, type UpcomingRow } from '../src/lib/personalUpcoming';

const row = (key: string, inDays: number): UpcomingRow => ({
  key,
  kind: 'bill',
  tone: 'brand',
  inDays,
  date: null,
});

describe('personal upcoming', () => {
  it('counts whole days', () => {
    expect(daysBetween('2026-11-16', '2026-11-21')).toBe(5);
    expect(daysBetween('2026-11-21', '2026-11-20')).toBe(-1);
  });

  it('sorts by date and keeps a seat for the to-do', () => {
    const rows = mergeUpcoming([row('c', 9), row('a', 1), row('b', 4)], 5, 3);
    expect(rows.map((r) => r.key)).toEqual(['a', 'b', 'todo']);
    expect(rows[2]?.left).toBe(5);
  });

  it('fills three rows without a to-do, and lists everything with no limit', () => {
    const dated = [row('a', 1), row('b', 2), row('c', 3), row('d', 4)];
    expect(mergeUpcoming(dated, 0, 3).map((r) => r.key)).toEqual(['a', 'b', 'c']);
    expect(mergeUpcoming(dated, 2, 0)).toHaveLength(5);
  });

  it('dots the bell for anything due by tomorrow, not the to-do', () => {
    expect(hasDue([row('a', 3)])).toBe(false);
    expect(hasDue([row('a', -2)])).toBe(true);
    expect(hasDue(mergeUpcoming([], 3, 3))).toBe(false);
  });
});
