import { describe, expect, it } from 'vitest';

import {
  cushionMonths,
  dayPlan,
  leftThisWeek,
  leftToday,
  monthRecap,
  recapTarget,
  saveTips,
  weekRecap,
  weekStartOf,
  weekVsUsual,
  type PersonalBudget,
  type PersonalRecurring,
  type PersonalTxn,
} from '../src/personal/index.js';

const txn = (o: Partial<PersonalTxn>): PersonalTxn => ({
  id: o.id ?? Math.random().toString(36),
  kind: o.kind ?? 'expense',
  amount: o.amount ?? 0n,
  currency: 'INR',
  category: o.category ?? null,
  note: null,
  date: o.date ?? '2026-11-10',
  loanId: null,
  recurringId: o.recurringId ?? null,
});

const rule = (o: Partial<PersonalRecurring>): PersonalRecurring => ({
  id: o.id ?? 'r',
  txnKind: o.txnKind ?? 'expense',
  amount: o.amount ?? 0n,
  currency: 'INR',
  category: o.category ?? null,
  note: o.note ?? null,
  cadence: o.cadence ?? 'monthly',
  interval: 1,
  secondDay: null,
  anchorDate: '2026-01-05',
  nextDate: o.nextDate ?? '2026-11-25',
  endDate: null,
  autoPost: false,
  active: true,
});

// Wed 2026-11-18, 13 days left in the month (18..30), 5 days left in the week.
const today = '2026-11-18';
const base = { budgets: [] as PersonalBudget[], currency: 'INR' as const, today };

describe('dayPlan', () => {
  it('spreads income − bills − spent over the days left', () => {
    const txns = [
      txn({ kind: 'income', amount: 100_000_00n, date: '2026-11-01' }),
      txn({ amount: 10_000_00n, date: '2026-11-05' }),
    ];
    const recurrings = [rule({ amount: 13_000_00n, nextDate: '2026-11-25' })];
    // (100000 − 13000 − 10000) / 13 days
    const input = { ...base, txns, recurrings };
    expect(dayPlan(input)!.perDay).toBe(77_000_00n / 13n);
    expect(leftToday(input)).toBe(77_000_00n / 13n);
    expect(leftThisWeek(input)).toBe((77_000_00n / 13n) * 5n);
  });

  it("subtracts today's spend from today only", () => {
    const txns = [
      txn({ kind: 'income', amount: 130_000n, date: '2026-11-01' }),
      txn({ amount: 1_000n, date: today }),
    ];
    const p = dayPlan({ ...base, txns, recurrings: [] })!;
    expect(p.perDay).toBe(10_000n);
    expect(p.leftToday).toBe(9_000n);
    expect(p.leftThisWeek).toBe(49_000n);
  });

  it('never gives the week more than the month has left', () => {
    const txns = [
      txn({ kind: 'income', amount: 10_000n, date: '2026-11-01' }),
      txn({ amount: 9_900n }),
    ];
    expect(leftThisWeek({ ...base, txns, recurrings: [] })).toBe(35n);
  });

  it('falls back to the overall budget, else null', () => {
    const budgets: PersonalBudget[] = [
      { id: 'b', category: null, limit: 130_000n, currency: 'INR' },
    ];
    const txns = [txn({ amount: 0n })];
    expect(dayPlan({ ...base, budgets, txns, recurrings: [] })!.perDay).toBe(10_000n);
    expect(dayPlan({ ...base, txns, recurrings: [] })).toBeNull();
  });
});

describe('weeks', () => {
  it('finds the Monday', () => {
    expect(weekStartOf('2026-11-18')).toBe('2026-11-16');
    expect(weekStartOf('2026-11-22')).toBe('2026-11-16');
  });

  it('compares a week with the average of the four before', () => {
    const txns = [
      txn({ amount: 4_000n, date: '2026-11-02' }),
      txn({ amount: 4_000n, date: '2026-11-09' }),
      txn({ amount: 1_000n, date: '2026-11-16' }),
    ];
    expect(weekVsUsual(txns, 'INR', '2026-11-16')).toEqual({
      spent: 1_000n,
      usual: 2_000n,
      delta: -1_000n,
    });
    expect(weekVsUsual(txns, 'INR', '2026-10-05')).toBeNull();
  });

  it('builds the week recap with biggest category and next bill', () => {
    const txns = [
      txn({ amount: 500n, date: '2026-11-10', category: 'food' }),
      txn({ amount: 300n, date: '2026-11-11', category: 'transport' }),
    ];
    const r = weekRecap(
      { ...base, today: '2026-11-17', txns, recurrings: [rule({ amount: 99n })] },
      '2026-11-09',
    );
    expect(r.spent).toBe(800n);
    expect(r.topCategory?.category).toBe('food');
    expect(r.nextBill?.rule.amount).toBe(99n);
  });
});

describe('recapTarget', () => {
  it('opens Sunday 18:00 to Tuesday, monthly on the 1st-3rd', () => {
    expect(recapTarget('2026-11-22', 17)).toBeNull();
    expect(recapTarget('2026-11-22', 18)).toEqual({ kind: 'week', key: '2026-11-16' });
    expect(recapTarget('2026-11-24', 9)).toEqual({ kind: 'week', key: '2026-11-16' });
    expect(recapTarget('2026-11-25', 9)).toBeNull();
    expect(recapTarget('2026-12-02', 9)).toEqual({ kind: 'month', key: '2026-11' });
    expect(recapTarget('2026-12-09', 20)).toBeNull();
  });
});

describe('monthRecap', () => {
  const t = (m: string, inc: bigint, exp: bigint) => [
    txn({ kind: 'income', amount: inc, date: `${m}-01` }),
    txn({ amount: exp, date: `${m}-02`, category: 'food' }),
  ];
  it('ranks best against the last 3 months and gives a 6-month trend', () => {
    const txns = [
      ...t('2026-07', 100n, 90n),
      ...t('2026-08', 100n, 80n),
      ...t('2026-09', 100n, 70n),
      ...t('2026-10', 100n, 40n),
    ];
    const r = monthRecap(txns, '2026-10', 'INR');
    expect(r.leftOver).toBe(60n);
    expect(r.rank).toBe('best');
    expect(r.rankMonths).toBe(4);
    expect(r.topCategory?.category).toBe('food');
    expect(r.trend).toHaveLength(6);
    expect(r.trend[5]!.spent).toBe(40n);
  });
  it('has no rank without history', () => {
    expect(monthRecap(t('2026-10', 100n, 40n), '2026-10', 'INR').rank).toBeNull();
  });
});

describe('saveTips', () => {
  it('ranks over-median, subscriptions and overspent budgets', () => {
    const txns = [
      txn({ amount: 1_000n, date: '2026-08-05', category: 'food' }),
      txn({ amount: 1_000n, date: '2026-09-05', category: 'food' }),
      txn({ amount: 1_000n, date: '2026-10-05', category: 'food' }),
      txn({ amount: 3_000n, date: '2026-11-05', category: 'food' }),
    ];
    const recurrings = [
      rule({ id: 'n', amount: 649n, note: 'Netflix' }),
      rule({ id: 'r', amount: 20_000n, note: 'Rent' }),
    ];
    const budgets: PersonalBudget[] = [
      { id: 'b', category: 'food', limit: 2_500n, currency: 'INR' },
    ];
    const tips = saveTips({ ...base, txns, recurrings, budgets });
    expect(tips.map((x) => x.kind).sort()).toEqual(['overBudget', 'overMedian', 'subscriptions']);
    const over = tips.find((x) => x.kind === 'overMedian')!;
    expect(over.amount).toBe(2_000n);
    expect(over.category).toBe('food');
    expect(tips.find((x) => x.kind === 'overBudget')!.amount).toBe(500n);
    const subs = tips.find((x) => x.kind === 'subscriptions')!;
    expect(subs.amount).toBe(649n * 12n);
    expect(subs.params.count).toBe(1);
    expect(tips.length).toBeLessThanOrEqual(3);
  });
  it('is empty with nothing to say', () => {
    expect(saveTips({ ...base, txns: [], recurrings: [] })).toEqual([]);
  });
});

describe('cushionMonths', () => {
  it('is savings over bills plus average everyday spend; null without savings', () => {
    const txns = [
      txn({ amount: 3_000n, date: '2026-08-05' }),
      txn({ amount: 3_000n, date: '2026-09-05' }),
      txn({ amount: 3_000n, date: '2026-10-05' }),
    ];
    const recurrings = [rule({ amount: 2_000n })];
    const input = { ...base, txns, recurrings };
    expect(cushionMonths(25_000n, input)).toBe(5);
    expect(cushionMonths(null, input)).toBeNull();
    expect(cushionMonths(1n, { ...input, txns: [], recurrings: [] })).toBeNull();
  });
});
