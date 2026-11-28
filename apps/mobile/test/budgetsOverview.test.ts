import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PersonalBudget, PersonalTxn } from '@waves/core';

import { budgetsOverview } from '../src/lib/budgetsOverview';

const txn = (category: string, amount: bigint): PersonalTxn => ({
  id: `${category}${amount}`,
  kind: 'expense',
  amount,
  currency: 'INR',
  category,
  note: null,
  date: '2026-11-10',
  loanId: null,
  recurringId: null,
});
const cap = (id: string, category: string | null, limit: bigint): PersonalBudget => ({
  id,
  category,
  limit,
  currency: 'INR',
});

describe('budgetsOverview', () => {
  it('sums category caps and spend, and reports over budget', () => {
    const o = budgetsOverview(
      [cap('1', 'food', 2_500_000n), cap('2', 'travel', 1_000_000n)],
      [txn('food', 2_850_000n), txn('travel', 800_000n)],
      '2026-11',
      'INR',
    );
    expect(o).toMatchObject({ spent: 3_650_000n, limit: 3_500_000n, over: true });
    expect(o?.remaining).toBe(-150_000n);
    expect(o?.percent).toBe(104);
    expect(o?.overall).toBeNull();
  });
  it('is under budget with money left', () => {
    const o = budgetsOverview(
      [cap('1', 'food', 100_000n)],
      [txn('food', 25_000n)],
      '2026-11',
      'INR',
    );
    expect(o).toMatchObject({ over: false, remaining: 75_000n, percent: 25 });
  });
  it('prefers an explicit overall budget as the headline', () => {
    const all = cap('9', null, 500_000n);
    const o = budgetsOverview(
      [cap('1', 'food', 100_000n), all],
      [txn('food', 50_000n)],
      '2026-11',
      'INR',
    );
    expect(o?.limit).toBe(500_000n);
    expect(o?.overall).toBe(all);
  });
  it('ignores other currencies and returns null with nothing to measure', () => {
    expect(budgetsOverview([], [], '2026-11', 'INR')).toBeNull();
    expect(
      budgetsOverview([{ ...cap('1', 'food', 1n), currency: 'USD' }], [], '2026-11', 'INR'),
    ).toBeNull();
  });
});

describe('budgets screen shape', () => {
  const src = readFileSync(join(__dirname, '../src/app/personal/budgets.tsx'), 'utf8');
  it('matches the calm After structure', () => {
    expect(src).toMatch(/<PlanningTabs/);
    expect(src).toMatch(/c\.categories/);
    expect(src).toMatch(/c\.manage/);
    expect(src).toMatch(/'\/personal\/spending'/);
    expect(src).toMatch(/'\/settings\/categories'/);
  });
  it('switches Planning screens by replace, not push', () => {
    const tabs = readFileSync(join(__dirname, '../src/components/PlanningTabs.tsx'), 'utf8');
    expect(tabs).toMatch(/router\.replace/);
    expect(tabs).not.toMatch(/router\.push/);
    for (const f of ['recurring', 'loans']) {
      expect(readFileSync(join(__dirname, `../src/app/personal/${f}.tsx`), 'utf8')).toMatch(
        /<PlanningTabs/,
      );
    }
  });
});
