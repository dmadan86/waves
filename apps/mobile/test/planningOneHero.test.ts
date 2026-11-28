/** Budgets and Loans draw the one SummaryCard hero (docs/design-standard.md), like Transactions and Recurring. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('planning one hero', () => {
  for (const file of ['budgets', 'loans', 'recurring']) {
    it(`${file} renders SummaryCard`, () => {
      expect(read(`src/app/personal/${file}.tsx`)).toMatch(/<SummaryCard\b/);
    });
  }
  it('loans dropped its own hero and illustration', () => {
    const loans = read('src/app/personal/loans.tsx');
    expect(loans).not.toMatch(/TotalHalf|personal-loans\.webp|LinearGradient/);
  });
  it('budgets dropped the plain "Spent of planned" card', () => {
    const budgets = read('src/app/personal/budgets.tsx');
    expect(budgets).not.toMatch(/budgetsPlanned|budgetsOfBudget/);
  });
});
