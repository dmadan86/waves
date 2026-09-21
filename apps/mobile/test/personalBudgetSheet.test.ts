/**
 * The budget editor's context is only useful when the scope is real.
 *
 * A category budget with no category picked must not show controls that measure
 * the whole ledger under a "Category" choice. The implementation is a React
 * screen, so these tests pin the source-level guards around the pure decisions.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const APP = join(__dirname, '../src/app');
const source = (path: string): string => readFileSync(join(APP, path), 'utf8');

describe('budget sheet evidence links', () => {
  it('hides the transactions link until a category scope has a category', () => {
    const budgets = source('personal/budgets.tsx');

    expect(budgets).toContain("const measuring = scope === 'overall' || category !== null;");
    expect(budgets).toContain('{measuring ? (');
    expect(budgets).toContain('onPress={openTransactions}');
  });

  it('treats a malformed transactions category param as no filter', () => {
    const transactions = source('personal/transactions.tsx');

    expect(transactions).toContain(
      "const filter = typeof params.category === 'string' ? params.category : null;",
    );
  });
});
