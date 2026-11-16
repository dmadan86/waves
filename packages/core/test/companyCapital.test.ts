import { describe, expect, it } from 'vitest';

import {
  capUsages,
  capWindow,
  companyEntryFromRow,
  companySpendItems,
  evaluateCompanyPolicies,
  flagsForEntry,
  workingCapital,
  type CompanyPolicies,
  type CompanyPolicyRule,
  type SpendItem,
  type VendorLine,
} from '../src';

let n = 0;
const entry = (kind: string, amount: string, day: string, over: Record<string, unknown> = {}) => {
  n += 1;
  return companyEntryFromRow({
    id: `e${n}`,
    group_id: 'g',
    member_id: 'm',
    entry_kind: kind,
    amount,
    currency: 'INR',
    calc_mode: 'typed',
    occurred_on: day,
    status: 'approved',
    version: 1,
    created_at: `${day}T00:00:00Z`,
    deleted_at: null,
    ...over,
  } as never);
};
const item = (id: string, day: string, amount: bigint): SpendItem => ({ id, day, amount });
const pol = (...rules: CompanyPolicyRule[]): CompanyPolicies => ({ version: 1, rules });
const top = (id: string, amt: string, at: string, direction: 'in' | 'out' = 'in') =>
  ({ id, type: 'capital', limitMinor: amt, direction, effect: 'warn', by: 'm', at }) as const;
const cap = (id: string, amt: string, period: 'days' | 'week' | 'month' | 'year', days?: number) =>
  ({ id, type: 'company_cap', limitMinor: amt, period, days, effect: 'warn' }) as const;

describe('capWindow', () => {
  it('day and 3 days are rolling windows ending today', () => {
    expect(capWindow('days', 1, '2026-11-18')).toEqual({ from: '2026-11-18', to: '2026-11-18' });
    expect(capWindow('days', 3, '2026-11-01')).toEqual({ from: '2026-10-30', to: '2026-11-01' });
  });
  it('week starts Monday', () => {
    // 2026-11-16 is a Monday, 2026-11-22 a Sunday
    expect(capWindow('week', 1, '2026-11-16')).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(capWindow('week', 1, '2026-11-22')).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(capWindow('week', 1, '2026-11-23').from).toBe('2026-11-23');
  });
  it('month and year are calendar', () => {
    expect(capWindow('month', 1, '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(capWindow('year', 1, '2026-06-30')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
});

describe('spend and working capital', () => {
  it('counts what leaves the company once', () => {
    const line = (id: string, kind: string, status: string, amount: bigint) =>
      ({
        id,
        kind,
        status,
        amount,
        occurredOn: '2026-11-10',
        deleted: false,
      }) as unknown as VendorLine;
    const items = companySpendItems(
      [
        entry('expense', '1000', '2026-11-10'),
        entry('expense', '500', '2026-11-10', { status: 'submitted' }),
        entry('advance', '2000', '2026-11-11'),
        entry('reimbursement', '1000', '2026-11-12', { direction: 'company_to_employee' }),
        entry('wage_payment', '5000', '2026-11-12', { claims_minor: '1000' }),
      ],
      [
        line('v1', 'payment', 'approved', 300n),
        line('v2', 'bill', 'approved', 900n),
        line('v3', 'advance', 'pending', 50n),
      ],
    );
    expect(items.reduce((s, i) => s + i.amount, 0n)).toBe(1000n + 2000n + 4000n + 300n);
  });
  it('balance after spend and top-ups, ignoring spend before the first record', () => {
    const spend = [
      item('a', '2026-11-01', 999n),
      item('b', '2026-11-10', 12000n),
      item('c', '2026-11-12', 3000n),
    ];
    const p = pol(top('t1', '50000', '2026-11-05T09:00:00Z'));
    expect(workingCapital(p, spend)).toMatchObject({
      capital: 50000n,
      spent: 15000n,
      left: 35000n,
    });
    const more = pol(
      top('t1', '50000', '2026-11-05T09:00:00Z'),
      top('t2', '10000', '2026-11-11T09:00:00Z'),
      top('t3', '2000', '2026-11-11T10:00:00Z', 'out'),
    );
    expect(workingCapital(more, spend).left).toBe(58000n - 15000n);
    expect(workingCapital(pol(), spend).set).toBe(false);
  });
});

describe('caps', () => {
  const p = pol(cap('w', '10000', 'week'));
  const spend = [
    item('a', '2026-11-16', 4000n),
    item('b', '2026-11-19', 3200n),
    item('x', '2026-11-15', 9999n),
  ];
  const subject = {
    memberId: 'm',
    kind: 'expense',
    category: 'fuel',
    amount: 3000n,
    occurredOn: '2026-11-20',
  } as const;
  it('reports usage for the current period', () => {
    expect(capUsages(p, spend, '2026-11-20')[0]).toMatchObject({
      used: 7200n,
      limit: 10000n,
      over: false,
    });
    expect(capUsages(pol(cap('d', '5000', 'days', 3)), spend, '2026-11-19')[0]?.used).toBe(3200n);
  });
  it('flags an entry that crosses a cap, warn only', () => {
    const f = evaluateCompanyPolicies(subject, [], p, { hasReceipt: true, spend });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ code: 'COMPANY_CAP', effect: 'warn', actualMinor: 10200n });
    const under = { ...subject, amount: 2800n };
    expect(evaluateCompanyPolicies(under, [], p, { hasReceipt: true, spend })).toEqual([]);
    expect(evaluateCompanyPolicies(subject, [], p, { hasReceipt: true })).toEqual([]);
  });
  it('does not count an entry against itself', () => {
    const own = entry('expense', '3000', '2026-11-20');
    const all = [...spend, item(own.id, own.occurredOn, 3000n)];
    expect(flagsForEntry(own, [own], p, new Set(), all)).toHaveLength(1);
    expect(flagsForEntry(own, [own], pol(cap('w', '10200', 'week')), new Set(), all)).toEqual([]);
  });
});
