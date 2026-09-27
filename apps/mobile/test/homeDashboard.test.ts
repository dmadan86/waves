import { describe, expect, it } from 'vitest';

import { percentChange, previousMonthPrefix } from '@/lib/homeDashboard';

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
