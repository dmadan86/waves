import { describe, expect, it } from 'vitest';

import type { PersonalRecurring } from '@waves/core';

import {
  daysBetween,
  percentChange,
  previousMonthPrefix,
  upcomingRules,
} from '@/lib/homeDashboard';

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

describe('upcomingRules', () => {
  const rule = (over: Partial<PersonalRecurring>): PersonalRecurring =>
    ({
      id: 'r',
      txnKind: 'expense',
      amount: 100n,
      currency: 'INR',
      category: null,
      note: null,
      cadence: 'monthly',
      interval: 1,
      secondDay: null,
      anchorDate: '2026-01-01',
      nextDate: '2026-10-01',
      endDate: null,
      autoPost: false,
      active: true,
      ...over,
    }) as PersonalRecurring;

  it('lists active, unfinished rules soonest first', () => {
    const rules = [
      rule({ id: 'later', nextDate: '2026-10-20' }),
      rule({ id: 'paused', nextDate: '2026-10-02', active: false }),
      rule({ id: 'ended', nextDate: '2026-10-03', endDate: '2026-09-30' }),
      rule({ id: 'soon', nextDate: '2026-10-05' }),
    ];
    expect(upcomingRules(rules).map((r) => r.id)).toEqual(['soon', 'later']);
  });
});

describe('daysBetween', () => {
  it('counts whole days either way', () => {
    expect(daysBetween('2026-09-27', '2026-09-30')).toBe(3);
    expect(daysBetween('2026-09-27', '2026-09-25')).toBe(-2);
    expect(daysBetween('2026-09-27', '2026-09-27')).toBe(0);
  });
});
