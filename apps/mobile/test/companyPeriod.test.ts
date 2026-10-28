import { describe, expect, it } from 'vitest';

import { periodRange } from '@/lib/companyPeriod';

describe('periodRange', () => {
  it('cuts this month and last month, across a year end and a leap February', () => {
    expect(periodRange('month', '2026-10-28')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodRange('last', '2026-10-28')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodRange('last', '2027-01-05')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(periodRange('last', '2028-03-01')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
  it('all time spans everything', () => {
    const { from, to } = periodRange('all', '2026-10-28');
    expect('2026-10-28' >= from && '2026-10-28' <= to).toBe(true);
  });
});
