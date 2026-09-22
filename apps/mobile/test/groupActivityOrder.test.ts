/**
 * The order the dashboard's fifteen slots are handed out in.
 *
 * The property that matters is not "sorted descending" — it is that a group
 * nobody has touched cannot hold a slot in front of one somebody just spent in,
 * and that nothing shuffles when two groups are equally quiet.
 */
import { describe, expect, it } from 'vitest';

import { activityTime, orderByActivity } from '../src/lib/groupActivityOrder';

const at = (iso: string): number => activityTime(iso);

describe('reading a timestamp', () => {
  it('parses an ISO instant', () => {
    expect(activityTime('2026-09-22T10:00:00Z')).toBe(Date.parse('2026-09-22T10:00:00Z'));
  });

  it('treats the same instant written two ways as the same instant', () => {
    // Postgres, the queue and the device do not all spell an offset the same
    // way, and these two sort in opposite orders as plain text.
    expect(activityTime('2026-09-22T10:00:00Z')).toBe(activityTime('2026-09-22T10:00:00+00:00'));
  });

  it('is nothing rather than NaN for an absent or broken value', () => {
    // NaN would make every comparison false and the resulting order arbitrary.
    expect(activityTime(null)).toBe(0);
    expect(activityTime(undefined)).toBe(0);
    expect(activityTime('')).toBe(0);
    expect(activityTime('last tuesday')).toBe(0);
  });
});

describe('ordering groups by what is happening in them', () => {
  it('puts the most recently touched first', () => {
    const rows = [
      { id: 'march', at: at('2026-03-01T09:00:00Z') },
      { id: 'today', at: at('2026-09-22T09:00:00Z') },
      { id: 'august', at: at('2026-08-14T09:00:00Z') },
    ];
    expect(orderByActivity(rows, (row) => row.at).map((row) => row.id)).toEqual([
      'today',
      'august',
      'march',
    ]);
  });

  it('keeps the order it was given when two are equally quiet', () => {
    // Two groups nobody has touched must not trade places between renders.
    const rows = [
      { id: 'a', at: 0 },
      { id: 'b', at: 0 },
      { id: 'c', at: 0 },
    ];
    expect(orderByActivity(rows, (row) => row.at).map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });

  it('sinks a group with no activity below every group with some', () => {
    const rows = [
      { id: 'empty', at: 0 },
      { id: 'ancient', at: at('2020-01-01T00:00:00Z') },
    ];
    expect(orderByActivity(rows, (row) => row.at).map((row) => row.id)).toEqual([
      'ancient',
      'empty',
    ]);
  });

  it('leaves an empty list alone', () => {
    expect(orderByActivity([], () => 0)).toEqual([]);
  });

  it('does not mutate what it was given', () => {
    const rows = [
      { id: 'old', at: 1 },
      { id: 'new', at: 2 },
    ];
    orderByActivity(rows, (row) => row.at);
    expect(rows.map((row) => row.id)).toEqual(['old', 'new']);
  });
});
