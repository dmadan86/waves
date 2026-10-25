import { describe, expect, it } from 'vitest';

import { filterRecurrings, nextDateLabel, type RecurringFilter } from './recurringList';

const rules = [
  { txnKind: 'expense' as const, active: true },
  { txnKind: 'income' as const, active: false },
  { txnKind: 'expense' as const, active: false },
  { txnKind: 'income' as const, active: true },
];

describe('filterRecurrings', () => {
  it.each<[RecurringFilter, number[]]>([
    ['all', [0, 1, 2, 3]],
    ['bills', [0, 2]],
    ['income', [1, 3]],
    ['active', [0, 3]],
    ['paused', [1, 2]],
  ])('filters %s while preserving order and records', (filter, indexes) => {
    expect(filterRecurrings(rules, filter)).toEqual(indexes.map((i) => rules[i]));
    expect(rules).toHaveLength(4);
  });
  it('accepts empty lists', () => expect(filterRecurrings([], 'all')).toEqual([]));
});

describe('nextDateLabel', () => {
  it('formats a calendar date with a short month', () => {
    expect(nextDateLabel('2026-11-06', 'en-GB')).toBe('6 Nov 2026');
  });
  it.each(['ta-IN', 'hi-IN', 'ar'])('localizes for %s', (locale) => {
    expect(nextDateLabel('2026-11-06', locale)).toBe(
      new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(new Date(2026, 10, 6)),
    );
  });
  it('keeps the calendar day at year boundaries', () => {
    expect(nextDateLabel('2027-01-01', 'en-GB')).toBe('1 Jan 2027');
  });
});
