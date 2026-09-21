/**
 * The budget sheet's two derived figures: the six-month context line under the
 * amount, and the size of one tap on the − / + stepper beside it.
 *
 * The first test in `budgetSpendWindow` is the one that matters most — it pins
 * the window's filter to `personalBudgetProgress`'s. The two numbers sit one
 * above the other on the same sheet, so the day they disagree about whether a
 * loan repayment is spending, both of them stop being believed.
 */

import { describe, expect, it } from 'vitest';

import {
  budgetSpendWindow,
  budgetStep,
  personalBudgetProgress,
  type PersonalBudget,
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

const food: PersonalBudget = {
  id: 'b1',
  category: 'food',
  limit: 500_000n,
  currency: 'INR',
};

describe('budgetSpendWindow', () => {
  it('counts the six months ending at the anchor, the anchor included', () => {
    const txns = [
      txn({ amount: 1_000n, category: 'food', date: '2026-04-10' }), // in window
      txn({ amount: 2_000n, category: 'food', date: '2026-09-02' }), // the anchor month
      txn({ amount: 9_000n, category: 'food', date: '2026-03-31' }), // one month too old
    ];
    const window = budgetSpendWindow(txns, food, '2026-09');
    expect(window.total).toBe(3_000n);
    expect(window.months).toBe(6);
    expect(window.monthsWithSpend).toBe(2);
  });

  it('excludes the same things the progress bar above it excludes', () => {
    const txns = [
      txn({ amount: 1_000n, category: 'food', date: '2026-09-04' }),
      txn({ amount: 500n, category: 'food', date: '2026-09-05', kind: 'income' }),
      txn({ amount: 700n, category: 'food', date: '2026-09-06', loanId: 'loan-1' }),
      txn({ amount: 300n, category: 'travel', date: '2026-09-07' }),
      txn({ amount: 400n, category: 'food', date: '2026-09-08', currency: 'USD' }),
    ];
    // One month of window, so the two figures are measuring the same thing and
    // any difference is a difference of rule rather than of period.
    expect(budgetSpendWindow(txns, food, '2026-09', 1).total).toBe(
      personalBudgetProgress(food, txns, '2026-09').spent,
    );
    expect(budgetSpendWindow(txns, food, '2026-09', 1).total).toBe(1_000n);
  });

  it('takes every category for an overall budget', () => {
    const txns = [
      txn({ amount: 1_000n, category: 'food', date: '2026-09-04' }),
      txn({ amount: 300n, category: 'travel', date: '2026-08-07' }),
      txn({ amount: 200n, category: null, date: '2026-07-07' }),
    ];
    const window = budgetSpendWindow(txns, { category: null, currency: 'INR' }, '2026-09');
    expect(window.total).toBe(1_500n);
    expect(window.monthsWithSpend).toBe(3);
  });

  it('spreads the average over the whole window, not over the busy months', () => {
    // One ₹6,000 month in six: ₹1,000 a month, not ₹6,000 a month.
    const txns = [txn({ amount: 600_000n, category: 'food', date: '2026-06-11' })];
    const window = budgetSpendWindow(txns, food, '2026-09');
    expect(window.average).toBe(100_000n);
    expect(window.monthsWithSpend).toBe(1);
  });

  it('is empty, not zero-ish, when nothing was spent', () => {
    const window = budgetSpendWindow([], food, '2026-09');
    expect(window.total).toBe(0n);
    expect(window.monthsWithSpend).toBe(0);
    expect(window.average).toBe(0n);
  });

  it('does not count a zero-amount entry as a month with spend', () => {
    const txns = [txn({ amount: 0n, category: 'food', date: '2026-08-11' })];
    expect(budgetSpendWindow(txns, food, '2026-09').monthsWithSpend).toBe(0);
  });

  it('survives a malformed anchor by collapsing to that one key', () => {
    // `recentMonths` falls back to `[month]`, so the window is one bad key wide
    // and matches nothing — a blank line, never a crash.
    const txns = [txn({ amount: 1_000n, category: 'food', date: '2026-09-04' })];
    const window = budgetSpendWindow(txns, food, 'nonsense');
    expect(window.total).toBe(0n);
    expect(window.months).toBe(1);
  });
});

describe('budgetStep', () => {
  it('steps a rupee amount by a round tenth of itself', () => {
    expect(budgetStep(500_000n, 'INR')).toBe(50_000n); // ₹5,000 → ₹500
    expect(budgetStep(120_000n, 'INR')).toBe(10_000n); // ₹1,200 → ₹100
    expect(budgetStep(8_000n, 'INR')).toBe(500n); // ₹80 → ₹5
  });

  it('rounds down onto the 1-2-5 ladder rather than to an arbitrary tenth', () => {
    expect(budgetStep(300_000n, 'INR')).toBe(20_000n); // ₹3,000 → ₹200, not ₹300
    expect(budgetStep(700_000n, 'INR')).toBe(50_000n); // ₹7,000 → ₹500, not ₹700
  });

  it('never steps in fractions of a major unit', () => {
    expect(budgetStep(500n, 'INR')).toBe(100n); // ₹5 → ₹1, not 50 paise
    expect(budgetStep(1n, 'INR')).toBe(100n);
  });

  it('opens a fresh budget on a round ten', () => {
    expect(budgetStep(0n, 'INR')).toBe(1_000n); // ₹10
    expect(budgetStep(-5n, 'INR')).toBe(1_000n);
  });

  it('reads the ladder in the currency’s own major unit', () => {
    // Yen has no minor unit, so the same ladder lands on whole yen.
    expect(budgetStep(5_000n, 'JPY')).toBe(500n);
    expect(budgetStep(0n, 'JPY')).toBe(10n);
    expect(budgetStep(50_000n, 'USD')).toBe(5_000n); // $500 → $50
  });
});
