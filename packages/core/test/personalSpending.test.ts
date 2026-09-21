/**
 * The Spending screen's arithmetic (A48). The three-way split of a month, the
 * chart's window, the half-year category view and the currency honesty — all
 * pure, so the figures a person reads about their own money are pinned here
 * rather than on a device.
 *
 * The case worth keeping an eye on is the injected bills classification: until
 * a recurring rule can say what kind it is, nothing is a bill, and the totals
 * must still add up to exactly the month's net.
 */

import { describe, expect, it } from 'vitest';

import {
  computePersonalSpending,
  monthlySummary,
  personalCategoryTotals,
  personalSpendingCurrencies,
  personalSpendingTrend,
  recentMonths,
  spentInMonth,
  type PersonalTxn,
} from '../src/personal/index.js';

const txn = (over: Partial<PersonalTxn>): PersonalTxn => ({
  id: over.id ?? crypto.randomUUID(),
  kind: over.kind ?? 'expense',
  amount: over.amount ?? 0n,
  currency: over.currency ?? 'INR',
  category: over.category ?? null,
  note: over.note ?? null,
  date: over.date ?? '2026-09-15',
  loanId: over.loanId ?? null,
  recurringId: over.recurringId ?? null,
});

/** A month with rent (a bill), groceries and a salary. */
const ledger: PersonalTxn[] = [
  txn({ id: 'a', kind: 'income', amount: 200_000n, date: '2026-09-01', category: 'salary' }),
  txn({ id: 'b', amount: 90_000n, date: '2026-09-05', category: 'rent', recurringId: 'rule-rent' }),
  txn({ id: 'c', amount: 12_000n, date: '2026-09-11', category: 'groceries' }),
  txn({ id: 'd', amount: 3_000n, date: '2026-09-19', category: 'dining' }),
  // Last month, for the trend.
  txn({ id: 'e', kind: 'income', amount: 200_000n, date: '2026-08-01', category: 'salary' }),
  txn({ id: 'f', amount: 20_000n, date: '2026-08-14', category: 'groceries' }),
];

const bills = { isBillLike: (id: string): boolean => id === 'rule-rent' };

describe('computePersonalSpending', () => {
  it('splits a month into income, bills, spending and what was left', () => {
    const split = computePersonalSpending(ledger, '2026-09', 'INR', bills);
    expect(split.income).toBe(200_000n);
    expect(split.bills).toBe(90_000n);
    expect(split.spending).toBe(15_000n);
    expect(split.leftOver).toBe(95_000n);
  });

  it('calls nothing a bill until a classifier says so', () => {
    // The default the screen ships with today: `kind` does not exist yet, so the
    // Bills row reads zero and the rent falls through to Spending.
    const split = computePersonalSpending(ledger, '2026-09', 'INR');
    expect(split.bills).toBe(0n);
    expect(split.spending).toBe(105_000n);
    expect(split.leftOver).toBe(95_000n);
  });

  it('leaves the same net however the expense is classified', () => {
    // The whole point of the split: it rearranges the month, it never changes it.
    const net = monthlySummary(ledger, '2026-09', 'INR').net;
    for (const options of [{}, bills, { isBillLike: () => true }]) {
      expect(computePersonalSpending(ledger, '2026-09', 'INR', options).leftOver).toBe(net);
    }
  });

  it('only counts a bill when the entry came from a bill-like rule', () => {
    // An ordinary expense that happens to be in a bill's category is not a bill;
    // the link is the recurring id, never the category.
    const strays = [
      txn({ amount: 5_000n, date: '2026-09-02', category: 'rent' }),
      txn({ amount: 7_000n, date: '2026-09-03', recurringId: 'rule-gym' }),
    ];
    const split = computePersonalSpending(strays, '2026-09', 'INR', bills);
    expect(split.bills).toBe(0n);
    expect(split.spending).toBe(12_000n);
  });

  it('reads only the currency it was asked about', () => {
    const mixed = [
      txn({ amount: 10_000n, date: '2026-09-04', currency: 'INR' }),
      txn({ amount: 500n, date: '2026-09-04', currency: 'GBP' }),
      txn({ kind: 'income', amount: 2_000n, date: '2026-09-04', currency: 'GBP' }),
    ];
    expect(computePersonalSpending(mixed, '2026-09', 'INR').spending).toBe(10_000n);
    expect(computePersonalSpending(mixed, '2026-09', 'GBP')).toMatchObject({
      income: 2_000n,
      spending: 500n,
      leftOver: 1_500n,
    });
  });

  it('goes negative when the month ran past its income', () => {
    const overspent = [
      txn({ kind: 'income', amount: 1_000n, date: '2026-09-02' }),
      txn({ amount: 4_000n, date: '2026-09-08' }),
    ];
    expect(computePersonalSpending(overspent, '2026-09', 'INR').leftOver).toBe(-3_000n);
  });

  it('files a first-of-month entry in its own month', () => {
    // Sliced off the string, never parsed — a Date would move this one east of
    // UTC and file September's salary under August.
    expect(computePersonalSpending(ledger, '2026-09', 'INR').income).toBe(200_000n);
    expect(computePersonalSpending(ledger, '2026-08', 'INR').income).toBe(200_000n);
  });

  it('reads an empty ledger as a month of zeroes, not a crash', () => {
    expect(computePersonalSpending([], '2026-09', 'INR')).toEqual({
      month: '2026-09',
      income: 0n,
      bills: 0n,
      spending: 0n,
      leftOver: 0n,
    });
  });
});

describe('personalSpendingTrend', () => {
  it('answers for every month asked, in order, keeping the empty ones', () => {
    const months = recentMonths('2026-09', 6);
    const trend = personalSpendingTrend(ledger, months, 'INR', bills);
    expect(trend.map((m) => m.month)).toEqual(months);
    expect(trend).toHaveLength(6);
    // April to July are empty; they are still columns.
    expect(trend.slice(0, 4).every((m) => m.income === 0n && m.spending === 0n)).toBe(true);
    expect(trend[4]).toMatchObject({ month: '2026-08', income: 200_000n, spending: 20_000n });
    expect(trend[5]).toMatchObject({ month: '2026-09', bills: 90_000n, spending: 15_000n });
  });
});

describe('spentInMonth', () => {
  it('takes the bills out of the spent column when asked', () => {
    const split = computePersonalSpending(ledger, '2026-09', 'INR', bills);
    expect(spentInMonth(split, true)).toBe(105_000n);
    expect(spentInMonth(split, false)).toBe(15_000n);
  });
});

describe('personalCategoryTotals', () => {
  const months = recentMonths('2026-09', 6);

  it('sums a window by category, biggest first, with a share of the whole', () => {
    const totals = personalCategoryTotals(ledger, months, 'INR');
    expect(totals.map((c) => c.category)).toEqual(['rent', 'groceries', 'dining']);
    expect(totals[0]).toMatchObject({ category: 'rent', spent: 90_000n });
    expect(totals[1]).toMatchObject({ category: 'groceries', spent: 32_000n });
    // 90,000 of 125,000 spent across the window.
    expect(totals[0]?.share).toBeCloseTo(0.72, 4);
    expect(totals.reduce((sum, c) => sum + c.spent, 0n)).toBe(125_000n);
  });

  it('drops the bills when asked, and keeps them by default', () => {
    expect(personalCategoryTotals(ledger, months, 'INR', bills).map((c) => c.category)).toContain(
      'rent',
    );
    const without = personalCategoryTotals(ledger, months, 'INR', {
      ...bills,
      includeBills: false,
    });
    expect(without.map((c) => c.category)).toEqual(['groceries', 'dining']);
    // The shares are re-based on the narrower question, not left over from the
    // wider one.
    expect(without.reduce((sum, c) => sum + c.share, 0)).toBeCloseTo(1, 3);
  });

  it('keeps an uncategorised row of its own, and puts it last on a tie', () => {
    const scrappy = [
      txn({ amount: 1_000n, date: '2026-09-01', category: null }),
      txn({ amount: 1_000n, date: '2026-09-02', category: 'dining' }),
    ];
    expect(personalCategoryTotals(scrappy, months, 'INR').map((c) => c.category)).toEqual([
      'dining',
      null,
    ]);
  });

  it('counts no income and nothing outside the window', () => {
    const totals = personalCategoryTotals(ledger, ['2026-09'], 'INR');
    expect(totals.map((c) => c.category)).toEqual(['rent', 'groceries', 'dining']);
    expect(totals.reduce((sum, c) => sum + c.spent, 0n)).toBe(105_000n);
  });

  it('gives every category a zero share when nothing was spent', () => {
    const nothing = [txn({ amount: 0n, date: '2026-09-01', category: 'dining' })];
    expect(personalCategoryTotals(nothing, months, 'INR')[0]?.share).toBe(0);
  });
});

describe('personalSpendingCurrencies', () => {
  it('puts the preferred currency first and sorts the rest', () => {
    const mixed = [
      txn({ currency: 'USD' }),
      txn({ currency: 'GBP' }),
      txn({ currency: 'INR' }),
      txn({ currency: 'GBP' }),
    ];
    expect(personalSpendingCurrencies(mixed, 'INR')).toEqual(['INR', 'GBP', 'USD']);
    expect(personalSpendingCurrencies(mixed, 'GBP')).toEqual(['GBP', 'INR', 'USD']);
  });

  it('always offers the preferred currency, even on an empty ledger', () => {
    expect(personalSpendingCurrencies([], 'INR')).toEqual(['INR']);
  });
});
