import { describe, expect, it } from 'vitest';
import type { PersonalBudget, PersonalRecurring, PersonalTxn } from '@waves/core';

import { budgetNudge } from '../src/lib/calm/budgetNudge';
import { recentlyPaid } from '../src/lib/calm/doneLine';
import { needsYou, uncategorizedTxns, visibleNeeds } from '../src/lib/calm/needsYou';
import {
  dailyPace,
  spendByDate,
  weekDays,
  weekStartDate,
  weekSummary,
} from '../src/lib/calm/weekPace';
import type { UpcomingRow } from '../src/lib/personalUpcoming';

const txn = (p: Partial<PersonalTxn> & { id: string; date: string }): PersonalTxn =>
  ({
    kind: 'expense',
    amount: 100n,
    currency: 'INR',
    category: 'food',
    note: null,
    loanId: null,
    recurringId: null,
    ...p,
  }) as PersonalTxn;

describe('week strip', () => {
  it('starts the week on the locale first day', () => {
    // 2026-11-28 is a Saturday.
    expect(weekStartDate('2026-11-28', 1)).toBe('2026-11-23');
    expect(weekStartDate('2026-11-28', 0)).toBe('2026-11-22');
    expect(weekStartDate('2026-11-28', 6)).toBe('2026-11-28');
  });
  it('spreads the monthly cap over the days of the month', () => {
    expect(dailyPace(30000n, '2026-11')).toBe(1000n);
    expect(dailyPace(null, '2026-11')).toBeNull();
    expect(dailyPace(0n, '2026-11')).toBeNull();
  });
  it('rings past days by pace, ambers the ones over, greys the future, dots due bills', () => {
    const spent = spendByDate(
      [
        txn({ id: 'a', date: '2026-11-23', amount: 500n }),
        txn({ id: 'b', date: '2026-11-24', amount: 2500n }),
        txn({ id: 'c', date: '2026-11-28', amount: 1000n }),
        txn({ id: 'l', date: '2026-11-25', amount: 9000n, loanId: 'x' }),
      ],
      'INR',
      '2026-11-23',
      '2026-11-29',
    );
    const days = weekDays({
      today: '2026-11-28',
      weekStart: 1,
      spent,
      pace: 1000n,
      dueDates: new Set(['2026-11-28']),
    });
    expect(days.map((d) => d.state)).toEqual([
      'past',
      'past',
      'past',
      'past',
      'past',
      'today',
      'future',
    ]);
    expect(days[0]).toMatchObject({ fill: 0.5, over: false });
    expect(days[1]).toMatchObject({ fill: 1, over: true });
    expect(days[2]).toMatchObject({ fill: 0, over: false });
    expect(days[5]).toMatchObject({ fill: 1, over: false, due: true });
    expect(days[6]).toMatchObject({ fill: 0, over: false, due: false });
  });
  it('says on track or over pace; no verdict without a budget', () => {
    const mk = (pace: bigint | null) =>
      weekDays({
        today: '2026-11-24',
        weekStart: 1,
        spent: { '2026-11-23': 900n, '2026-11-24': 900n },
        pace,
        dueDates: new Set(),
      });
    expect(weekSummary(mk(1000n), 1000n)).toEqual({ spent: 1800n, verdict: 'onTrack' });
    expect(weekSummary(mk(800n), 800n).verdict).toBe('overPace');
    expect(weekSummary(mk(null), null)).toEqual({ spent: 1800n, verdict: null });
  });
});

const rule = (id: string, autoPost = false): PersonalRecurring =>
  ({ id, autoPost, txnKind: 'expense' }) as PersonalRecurring;
const bill = (key: string, inDays: number, ruleId: string, income = false): UpcomingRow => ({
  key,
  kind: 'bill',
  tone: 'brand',
  inDays,
  date: '2026-11-28',
  ruleId,
  income,
});

describe('needs you', () => {
  const items = needsYou({
    bills: [
      bill('b-today', 0, 'r1'),
      bill('b-late', -2, 'r2'),
      bill('b-auto', 0, 'r3'),
      bill('soon', 2, 'r1'),
    ],
    recurrings: [rule('r1'), rule('r2'), rule('r3', true)],
    rent: [{ key: 'rent', tenancyId: 't', propertyId: 'p', inDays: -3 }],
    uncategorized: [txn({ id: 'u1', date: '2026-11-27', category: null })],
  });
  it('orders overdue, then uncategorised, then due today; skips auto-post and future', () => {
    expect(items.map((i) => i.key)).toEqual(['rent', 'b-late', 'uncategorized', 'b-today']);
  });
  it('collapses past three behind Show more', () => {
    expect(visibleNeeds(items, false)).toHaveLength(3);
    expect(visibleNeeds(items, true)).toHaveLength(4);
  });
  it('finds this month uncategorised expenses only', () => {
    const list = uncategorizedTxns(
      [
        txn({ id: '1', date: '2026-11-02', category: null }),
        txn({ id: '2', date: '2026-10-30', category: null }),
        txn({ id: '3', date: '2026-11-03' }),
        txn({ id: '4', date: '2026-11-04', category: null, kind: 'income' }),
      ],
      '2026-11',
      'INR',
    );
    expect(list.map((t) => t.id)).toEqual(['1']);
  });
});

describe('budget nudge and done line', () => {
  const b = (category: string | null, limit: bigint): PersonalBudget =>
    ({ id: String(category), category, limit, currency: 'INR' }) as PersonalBudget;
  it('nudges from 90% on with the money and days left', () => {
    const n = budgetNudge(
      [b('food', 10000n), b('fun', 10000n)],
      [txn({ id: 'x', date: '2026-11-10', amount: 9000n, category: 'food' })],
      'INR',
      '2026-11-28',
    );
    expect(n).toMatchObject({ category: 'food', percent: 90, remaining: 1000n, daysLeft: 2 });
    expect(
      budgetNudge(
        [b('food', 10000n)],
        [txn({ id: 'y', date: '2026-11-10', amount: 8000n })],
        'INR',
        '2026-11-28',
      ),
    ).toBeNull();
  });
  it('reads yesterday and today bills as one line', () => {
    const t = [
      txn({ id: 'n', date: '2026-11-27', recurringId: 'r' }),
      txn({ id: 'o', date: '2026-11-20', recurringId: 'r' }),
      txn({ id: 'm', date: '2026-11-27' }),
    ];
    expect(recentlyPaid(t, '2026-11-28')).toMatchObject({ count: 1, when: 'yesterday' });
    expect(recentlyPaid([], '2026-11-28')).toBeNull();
  });
});
