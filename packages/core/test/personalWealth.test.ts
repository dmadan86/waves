import { describe, expect, it } from 'vitest';

import { addYears, pendingEscalation, raiseForOf, raisedRent } from '../src/personal/wealth';

import {
  decodeInvestment,
  decodeProperty,
  decodeRecurring,
  decodeTenancy,
  decodeTxn,
  encodeInvestment,
  encodeProperty,
  encodeRecurring,
  encodeTenancy,
  encodeTxn,
} from '../src/personal/types';

describe('wealth codecs', () => {
  it('investment round-trips and carries unknown fields', () => {
    const blob = {
      type: 'fund',
      name: 'Index fund',
      currency: 'USD',
      openingInvested: '120000',
      openingAsOf: '2026-01-01',
      currentValue: '134500',
      valueAsOf: '2026-11-03',
      maturityDate: null,
      status: 'active',
      note: null,
      future: 1,
    };
    const rec = decodeInvestment('i', blob);
    expect(rec.openingInvested).toBe(120000n);
    expect(rec.carried).toEqual({ future: 1 });
    expect(encodeInvestment(rec)).toEqual(blob);
  });
  it('investment degrades garbage', () => {
    expect(decodeInvestment('i', { type: 'zzz', status: 'x' })).toMatchObject({
      type: 'other',
      status: 'active',
      currentValue: null,
      openingInvested: 0n,
    });
  });
  it('property round-trips', () => {
    const blob = {
      type: 'shop',
      name: 'Shop 2',
      locality: null,
      currency: 'INR',
      status: 'active',
      note: null,
    };
    expect(encodeProperty(decodeProperty('p', blob))).toEqual(blob);
  });
  it('tenancy round-trips and degrades', () => {
    const blob = {
      propertyId: 'p',
      unit: null,
      tenantName: 'Ravi',
      tenantPhone: null,
      depositHeld: '18000000',
      rentFrequency: 'monthly',
      startDate: '2026-04-01',
      endDate: null,
      escalationPct: 5,
      status: 'active',
      endedOn: null,
      depositReturned: null,
      depositKept: null,
      note: null,
    };
    const rec = decodeTenancy('t', blob);
    expect(rec.depositHeld).toBe(18000000n);
    expect(rec.carried).toBeUndefined();
    expect(encodeTenancy(rec)).toEqual(blob);
    expect(decodeTenancy('t', { escalationPct: -2 }).escalationPct).toBeNull();
  });
  it('links on txn and recurring survive the round trip, without being carried', () => {
    const txn = decodeTxn('x', {
      kind: 'expense',
      amount: '10.00',
      investmentId: 'i',
      propertyId: 'p',
    });
    expect(txn).toMatchObject({ investmentId: 'i', propertyId: 'p', carried: undefined });
    expect(encodeTxn(txn)).toMatchObject({ investmentId: 'i', propertyId: 'p' });
    const rule = decodeRecurring('r', { tenancyId: 't', investmentId: 'i' });
    expect(rule.carried).toBeUndefined();
    expect(encodeRecurring(rule)).toMatchObject({ tenancyId: 't', investmentId: 'i' });
  });
});

import { monthlySummary, personalBudgetProgress, categoryBreakdown } from '../src/personal/compute';
import type { PersonalTxn } from '../src/personal/types';
import { computePersonalSpending } from '../src/personal/spending';

const tx = (over: Partial<PersonalTxn>): PersonalTxn => ({
  id: Math.random().toString(),
  kind: 'expense',
  amount: 100n,
  currency: 'INR',
  category: null,
  note: null,
  date: '2026-11-05',
  loanId: null,
  recurringId: null,
  ...over,
});

describe('invested money in month figures', () => {
  const txns = [
    tx({ kind: 'income', amount: 1000n, category: 'inc.salary' }),
    tx({ amount: 200n, category: 'food' }),
    tx({ amount: 300n, category: 'inv.fund' }),
    tx({ kind: 'income', amount: 50n, category: 'inv.fund' }),
  ];
  it('keeps invested out of Spent and Income but lowers net', () => {
    const s = monthlySummary(txns, '2026-11', 'INR');
    expect(s.invested).toBe(250n);
    expect(s.income).toBe(1000n);
    expect(s.expense - s.invested).toBe(200n);
    expect(s.net).toBe(550n);
  });
  it('splits it out of spending and leftOver', () => {
    const s = computePersonalSpending(txns, '2026-11', 'INR');
    expect(s).toMatchObject({ spending: 200n, invested: 250n, leftOver: 550n });
  });
  it('is not in budgets or the category breakdown', () => {
    const b = { id: 'b', category: null, limit: 1000n, currency: 'INR' };
    expect(personalBudgetProgress(b, txns, '2026-11').spent).toBe(200n);
    expect(categoryBreakdown(txns, '2026-11', 'INR').map((r) => r.category)).toEqual(['food']);
  });
});

import {
  investedSoFar,
  rentBalance,
  rentDues,
  settleDeposit,
  goingInPerMonth,
} from '../src/personal/wealth';

describe('wealth maths', () => {
  const rule = (id: string, anchor: string, amount: string, endDate: string | null) =>
    decodeRecurring(id, {
      txnKind: 'income',
      amount,
      anchorDate: anchor,
      endDate,
      cadence: 'monthly',
      category: 'inc.rent',
    });
  it('invested so far adds opening and entries, less withdrawals', () => {
    const inv = decodeInvestment('i', { openingInvested: '1000', currency: 'INR' });
    const txns = [
      tx({ amount: 500n, category: 'inv.fund', investmentId: 'i' }),
      tx({ kind: 'income', amount: 200n, category: 'inv.fund', investmentId: 'i' }),
      tx({ amount: 999n, category: 'inv.fund', investmentId: 'other' }),
    ];
    expect(investedSoFar(inv, txns)).toBe(1300n);
  });
  it('going in per month scales weekly', () => {
    const r = decodeRecurring('r', {
      txnKind: 'expense',
      amount: '1200',
      cadence: 'monthly',
      investmentId: 'i',
    });
    expect(goingInPerMonth([r], 'INR')).toBe(1200n);
  });
  it('a raise uses two rules; each due at its own price', () => {
    const dues = rentDues(
      [rule('a', '2026-09-05', '1000', '2026-10-31'), rule('b', '2026-11-05', '1200', null)],
      '2026-11-21',
    );
    expect(dues.map((d) => d.amount)).toEqual([1000n, 1000n, 1200n]);
  });
  it('part payments clear the oldest due first', () => {
    const dues = rentDues([rule('a', '2026-09-05', '1000', null)], '2026-11-21');
    const b = rentBalance(dues, [{ amount: 1000n }, { amount: 400n }], '2026-11-21');
    expect(b.lines.map((l) => l.status)).toEqual(['paid', 'part', 'overdue']);
    expect(b.balance).toBe(1600n);
    expect(b.ahead).toBe(0n);
    const c = rentBalance(dues, [{ amount: 3500n }], '2026-11-21');
    expect(c.balance).toBe(0n);
    expect(c.ahead).toBe(500n);
  });
  it('settles the advance into returned and kept', () => {
    expect(settleDeposit(18000n, 15000n)).toEqual({ returned: 15000n, kept: 3000n });
    expect(settleDeposit(100n, 500n)).toEqual({ returned: 100n, kept: 0n });
  });
});

describe('yearly rent increase', () => {
  it('raises in minor units and rounds to whole major units', () => {
    expect(raisedRent(2_500_000n, 5, 'INR')).toBe(2_625_000n);
    expect(raisedRent(123_456n, 5, 'USD')).toBe(129_600n);
  });
  it('leaves the rent alone for no pct, and keeps zero-decimal currencies whole', () => {
    expect(raisedRent(100_000n, 0, 'USD')).toBe(100_000n);
    expect(raisedRent(1_001n, 5, 'JPY')).toBe(1_051n);
  });
  it('waits for the anniversary window and stops once a newer rule exists', () => {
    const base = {
      startDate: '2025-03-10',
      endDate: null,
      escalationPct: 5,
      raisedFor: [],
    };
    expect(pendingEscalation({ ...base, today: '2026-03-02' })).toBeNull();
    expect(pendingEscalation({ ...base, today: '2026-03-03' })).toBe('2026-03-10');
    expect(pendingEscalation({ ...base, today: '2026-06-01' })).toBe('2026-03-10');
    expect(
      pendingEscalation({
        ...base,
        raisedFor: ['2026-03-10'],
        today: '2026-06-01',
      }),
    ).toBeNull();
    expect(pendingEscalation({ ...base, escalationPct: null, today: '2026-06-01' })).toBeNull();
    expect(pendingEscalation({ ...base, endDate: '2026-03-01', today: '2026-06-01' })).toBeNull();
  });
  it('is not suppressed by a rule that merely starts near the anniversary', () => {
    const base = { startDate: '2025-03-10', endDate: null, escalationPct: 5, raisedFor: [] };
    expect(pendingEscalation({ ...base, today: '2026-03-05' })).toBe('2026-03-10');
    expect(pendingEscalation({ ...base, raisedFor: ['2025-03-10'], today: '2026-03-05' })).toBe(
      '2026-03-10',
    );
  });
  it('reads which anniversary a rule was raised for', () => {
    expect(raiseForOf({ carried: { raiseFor: '2026-03-10' } })).toBe('2026-03-10');
    expect(raiseForOf({ carried: { raiseFor: 5 } })).toBeNull();
    expect(raiseForOf({})).toBeNull();
  });
  it('clamps a leap-day start', () => {
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28');
    expect(addYears('2024-02-29', 4)).toBe('2028-02-29');
  });
});
