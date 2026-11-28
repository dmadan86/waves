import { describe, expect, it } from 'vitest';

import {
  daysLeftInMonth,
  overBy,
  percentUsed,
  sortCategories,
  topOver,
} from '../src/lib/calm/budgetSummary';

const c = (id: string, spent: bigint, limit: bigint) => ({ id, spent, limit });
const rows = [
  c('travel', 8000n, 10000n),
  c('others', 50000n, 20000n),
  c('bills', 12050n, 15000n),
  c('food', 28500n, 25000n),
  c('shopping', 14200n, 10000n),
];

describe('calm budgets', () => {
  it('sorts most over first, then closest to cap', () => {
    expect(sortCategories(rows).map((r) => r.id)).toEqual([
      'others',
      'shopping',
      'food',
      'bills',
      'travel',
    ]);
  });
  it('names the two categories most over for the summary sentence', () => {
    expect(topOver(rows).map((r) => r.id)).toEqual(['others', 'shopping']);
    expect(topOver([c('a', 1n, 10n)])).toEqual([]);
  });
  it('measures over amount and percent', () => {
    expect(overBy(c('x', 14200n, 10000n))).toBe(4200n);
    expect(overBy(c('x', 5n, 10n))).toBe(0n);
    expect(percentUsed(c('x', 14200n, 10000n))).toBe(142);
    expect(percentUsed(c('x', 1n, 0n))).toBe(0);
  });
  it('counts days left only in the current month', () => {
    expect(daysLeftInMonth('2026-11', '2026-11-28')).toBe(2);
    expect(daysLeftInMonth('2026-10', '2026-11-28')).toBeNull();
  });
});
