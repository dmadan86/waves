import { describe, expect, it } from 'vitest';
import {
  BILL_PRESETS,
  billsMonthlyTotal,
  billUpcoming,
  hasHouseholdHome,
  householdSummary,
  incomeByMember,
  incomeTotal,
  mergeHouseholdUpcoming,
  monthlyEquivalent,
  monthlySpend,
  nextDayOfMonth,
  perDayLeft,
  savablePicks,
} from '../src/group/household';

const rule = (
  amount: bigint,
  cadence: 'weekly' | 'semimonthly' | 'monthly' | 'yearly',
  interval = 1,
) => ({
  amount,
  cadence,
  interval,
  currency: 'INR',
  status: 'active',
});

describe('hasHouseholdHome', () => {
  it('opens for couples, homes and pooled groups only', () => {
    expect(hasHouseholdHome({ type: 'couple' })).toBe(true);
    expect(hasHouseholdHome({ type: 'home', ledger_mode: 'split' })).toBe(true);
    expect(hasHouseholdHome({ type: 'other', ledger_mode: 'pool' })).toBe(true);
    expect(hasHouseholdHome({ type: 'other', ledger_mode: 'split' })).toBe(false);
    expect(hasHouseholdHome({ type: 'trip' })).toBe(false);
    expect(hasHouseholdHome(null)).toBe(false);
  });
});

describe('monthlyEquivalent', () => {
  it('turns every cadence into a month', () => {
    expect(monthlyEquivalent(rule(1200000n, 'monthly'))).toBe(1200000n);
    expect(monthlyEquivalent(rule(3000000n, 'monthly', 3))).toBe(1000000n);
    expect(monthlyEquivalent(rule(1200000n, 'yearly'))).toBe(100000n);
    expect(monthlyEquivalent(rule(50000n, 'semimonthly'))).toBe(100000n);
    expect(monthlyEquivalent(rule(1200n, 'weekly'))).toBe(5200n);
  });
  it('totals only active bills in the currency', () => {
    expect(
      billsMonthlyTotal(
        [
          rule(100n, 'monthly'),
          { ...rule(900n, 'monthly'), status: 'paused' },
          { ...rule(500n, 'monthly'), currency: 'USD' },
        ],
        'INR',
      ),
    ).toBe(100n);
  });
});

describe('bill picker', () => {
  it('turns groceries and fuel into budgets, not bills', () => {
    const picks = [
      { preset: 'rent' as const, amount: 5000000n, payerId: 'a' },
      { preset: 'groceries' as const, amount: 1000000n, payerId: 'a' },
      { preset: 'fuel' as const, amount: 400000n, payerId: '' },
      { preset: 'internet' as const, amount: 0n, payerId: 'a' },
      { preset: 'water' as const, amount: 10000n, payerId: '' },
    ];
    const { bills, budgets } = savablePicks(picks);
    expect(bills.map((p) => p.preset)).toEqual(['rent']);
    expect(budgets.map((p) => p.preset)).toEqual(['groceries', 'fuel']);
  });
  it('has unique presets', () => {
    expect(new Set(BILL_PRESETS.map((p) => p.id)).size).toBe(BILL_PRESETS.length);
  });
  it('finds the next day of the month', () => {
    expect(nextDayOfMonth('2026-11-05', 5)).toBe('2026-11-05');
    expect(nextDayOfMonth('2026-11-06', 5)).toBe('2026-12-05');
    expect(nextDayOfMonth('2026-12-20', 1)).toBe('2027-01-01');
    expect(nextDayOfMonth('2026-11-06', 31)).toBe('2026-11-28');
  });
});

describe('income plans', () => {
  const plans = [
    { memberId: 'a', amount: 8000000n, currency: 'INR', active: true },
    { memberId: 'b', amount: 6500000n, currency: 'INR', active: true },
    { memberId: 'b', amount: 100n, currency: 'INR', active: false },
    { memberId: 'c', amount: 2000000n, currency: 'USD', active: true },
  ];
  it('totals active plans in the currency', () => {
    expect(incomeTotal(plans, 'INR')).toBe(14500000n);
    expect(incomeByMember(plans, 'INR').get('b')).toBe(6500000n);
  });
});

describe('summary', () => {
  it('computes left and change', () => {
    const s = householdSummary({ spent: 4230000n, lastMonthSpent: 5000000n, income: 14500000n });
    expect(s.left).toBe(10270000n);
    expect(s.changePct).toBe(-15);
    expect(householdSummary({ spent: 1n, lastMonthSpent: 0n, income: 0n }).changePct).toBeNull();
    expect(householdSummary({ spent: 5n, lastMonthSpent: 1n, income: 1n }).left).toBe(-4n);
  });
  it('buckets six months, oldest first', () => {
    const rows = monthlySpend(
      [
        { date: '2026-11-02', amount: 100n, currency: 'INR' },
        { date: '2026-11-10', amount: 50n, currency: 'INR' },
        { date: '2026-06-30', amount: 7n, currency: 'INR' },
        { date: '2026-05-30', amount: 9n, currency: 'INR' },
        { date: '2026-11-11', amount: 9n, currency: 'USD' },
      ],
      'INR',
      '2026-11-20',
    );
    expect(rows.map((r) => r.month)).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
    ]);
    expect(rows[0]!.total).toBe(7n);
    expect(rows[5]!.total).toBe(150n);
  });
  it('splits what is left over the days remaining', () => {
    expect(perDayLeft(1000n, '2026-11-21')).toBe(100n); // 10 days incl. today
    expect(perDayLeft(-5n, '2026-11-21')).toBe(0n);
  });
});

describe('upcoming', () => {
  const rules: Parameters<typeof billUpcoming>[0] = [
    {
      id: 'r1',
      description: 'Rent',
      amount: 5000000n,
      currency: 'INR',
      nextDate: '2026-12-01',
      status: 'active',
      payers: { a: 5000000n },
    },
    {
      id: 'r2',
      description: 'Wi-Fi',
      amount: 80000n,
      currency: 'INR',
      nextDate: '2026-11-22',
      status: 'active',
      payers: { a: 80000n },
    },
    {
      id: 'r3',
      description: 'Late',
      amount: 1n,
      currency: 'INR',
      nextDate: '2026-11-18',
      status: 'active',
      payers: {},
    },
    {
      id: 'r4',
      description: 'Far',
      amount: 1n,
      currency: 'INR',
      nextDate: '2027-02-01',
      status: 'active',
      payers: {},
    },
    {
      id: 'r5',
      description: 'Paused',
      amount: 1n,
      currency: 'INR',
      nextDate: '2026-11-25',
      status: 'paused',
      payers: {},
    },
  ];
  it('lists bills in the window, overdue first, and merges by date', () => {
    const bills = billUpcoming(rules, '2026-11-21', 30);
    expect(bills.map((b) => b.title).sort()).toEqual(['Late', 'Rent', 'Wi-Fi']);
    expect(bills.find((b) => b.title === 'Late')!.inDays).toBe(-3);
    const merged = mergeHouseholdUpcoming([bills], 0);
    expect(merged.map((m) => m.title)).toEqual(['Late', 'Wi-Fi', 'Rent']);
    expect(mergeHouseholdUpcoming([bills], 2)).toHaveLength(2);
  });
});
