import { describe, expect, it } from 'vitest';

import { percentChange, previousMonthPrefix, relativeUnit } from '@/lib/homeDashboard';

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

describe('relativeUnit', () => {
  const now = Date.parse('2026-09-27T12:00:00Z');
  it('picks the largest whole unit', () => {
    expect(relativeUnit(now - 30_000, now)).toBeNull();
    expect(relativeUnit(now - 5 * 60_000, now)).toEqual({ value: -5, unit: 'minute' });
    expect(relativeUnit(now - 3 * 3_600_000, now)).toEqual({ value: -3, unit: 'hour' });
    expect(relativeUnit(now - 2 * 86_400_000, now)).toEqual({ value: -2, unit: 'day' });
    expect(relativeUnit(now - 70 * 86_400_000, now)).toEqual({ value: -2, unit: 'month' });
    expect(relativeUnit(now - 800 * 86_400_000, now)).toEqual({ value: -2, unit: 'year' });
  });
});
