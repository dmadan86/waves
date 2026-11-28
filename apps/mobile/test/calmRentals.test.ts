import { describe, expect, it } from 'vitest';
import type { PersonalTenancy } from '@waves/core';

import { dueNow, leaseNudge, nameList, paidTenancies } from '../src/lib/calm/rentSummary';

const due = (tenancyId: string, amount: bigint, inDays: number, currency = 'INR') => ({
  tenancyId,
  amount,
  currency,
  inDays,
});
const tn = (id: string, endDate: string | null, status = 'active') =>
  ({ id, endDate, status, tenantName: id }) as unknown as PersonalTenancy;

describe('calm rentals', () => {
  it('totals what is due now in one currency', () => {
    expect(
      dueNow([due('a', 18000n, -3), due('b', 22000n, 3), due('c', 5n, 1, 'USD')], 'INR'),
    ).toEqual({
      total: 40000n,
      count: 3,
    });
  });
  it('treats everyone not owing as paid', () => {
    const all = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(paidTenancies(all, [{ tenancyId: 'a' }]).map((t) => t.id)).toEqual(['b', 'c']);
  });
  it('lists names, folding past three', () => {
    const join = (p: string[]) => p.join(', ');
    const more = (n: number) => `${n} more`;
    expect(nameList(['A', 'B', 'C'], join, more)).toBe('A, B, C');
    expect(nameList(['A', 'B', 'C', 'D'], join, more)).toBe('A, B, 2 more');
  });
  it('nudges the soonest lease ending within 90 days, ignoring ended and open ones', () => {
    const r = leaseNudge(
      [
        tn('far', '2027-03-01'),
        tn('soon', '2027-01-31'),
        tn('open', null),
        tn('gone', '2026-12-01', 'ended'),
      ],
      '2026-11-28',
    );
    expect(r?.tenancy.id).toBe('soon');
    expect(r?.days).toBe(64);
    expect(leaseNudge([tn('far', '2027-03-01')], '2026-11-28')).toBeNull();
  });
});
