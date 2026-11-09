import { describe, expect, it } from 'vitest';
import type { MoneyDate } from '@waves/core';
import { filterUpcoming, overdueTotal, upcomingCounts } from '../src/lib/upcomingList';

const item = (title: string, overdue: boolean, amountMinor: bigint | null): MoneyDate => ({
  id: title,
  day: '2026-11-01',
  kind: 'vendor_bill',
  title,
  amountMinor,
  currency: 'INR',
  memberId: null,
  overdue,
  route: null,
});
const items = [
  item('Anand Stationery', true, 92500n),
  item('BILL-0001', true, 2400000n),
  item('Arjun Nair +5', true, null),
  item('Mehta Traders', false, 100n),
];

describe('upcoming list', () => {
  it('counts overdue and upcoming', () => {
    expect(upcomingCounts(items)).toEqual({ all: 4, overdue: 3, upcoming: 1 });
  });
  it('filters by pill and query', () => {
    expect(filterUpcoming(items, 'upcoming', '').map((i) => i.title)).toEqual(['Mehta Traders']);
    expect(filterUpcoming(items, 'overdue', ' bill-0001 ').map((i) => i.title)).toEqual([
      'BILL-0001',
    ]);
    expect(filterUpcoming(items, 'all', 'zzz')).toEqual([]);
  });
  it('totals only overdue amounts', () => {
    expect(overdueTotal(items)).toBe(2492500n);
  });
});
