import { describe, expect, it } from 'vitest';

import { headlineGroupCounts, percentChange, previousMonthPrefix } from '@/lib/homeDashboard';

describe('previousMonthPrefix', () => {
  it('steps back one month, across a year', () => {
    expect(previousMonthPrefix('2026-09')).toBe('2026-08');
    expect(previousMonthPrefix('2026-10')).toBe('2026-09');
    expect(previousMonthPrefix('2026-01')).toBe('2025-12');
  });

  it('leaves something that is not a month alone', () => {
    expect(previousMonthPrefix('')).toBe('');
  });
});

describe('percentChange', () => {
  it('is the whole-percent change from before to now', () => {
    expect(percentChange(108n, 100n)).toBe(8);
    expect(percentChange(95n, 100n)).toBe(-5);
    expect(percentChange(100n, 100n)).toBe(0);
  });

  it('has nothing to say without a last month', () => {
    expect(percentChange(500n, 0n)).toBeNull();
  });
});

describe('headlineGroupCounts', () => {
  const bal: Record<string, bigint> = { demo: 270000n, a: 500n, b: -500n, c: 900n };
  const groups = [
    { id: 'demo', default_currency: 'INR' },
    { id: 'a', default_currency: 'INR' },
    { id: 'b' },
    { id: 'c', default_currency: 'USD' },
  ];
  it('never counts the demo group and keeps to the headline currency', () => {
    expect(headlineGroupCounts(groups, 'INR', 'INR', (id) => bal[id] ?? 0n, 'demo')).toEqual({
      owed: 1,
      owing: 1,
    });
  });
  it('is zero for a new user whose only group is the demo', () => {
    expect(headlineGroupCounts([groups[0]!], 'INR', 'INR', (id) => bal[id]!, 'demo')).toEqual({
      owed: 0,
      owing: 0,
    });
  });
});
