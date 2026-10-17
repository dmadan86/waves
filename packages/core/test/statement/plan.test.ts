/**
 * An imported statement against what Review and the ledger already hold:
 * merge into SMS drafts by reference, drop the same transaction twice, warn on
 * the ledger, and never tick money in.
 */

import { describe, expect, it } from 'vitest';

import {
  canImportStatements,
  FREE_MONTHLY_STATEMENT_PREVIEWS,
  parseStatementTable,
  planStatementImport,
  PlanTier,
  previewStatement,
  statementDedupeKey,
  statementImportMonthlyLimit,
  statementPreviewMonthlyLimit,
  type ExistingExpense,
  type StatementRow,
} from '../../src';
import { statementTable } from './fixtures';

function rowsOf(bank: string): StatementRow[] {
  const result = parseStatementTable(statementTable(`${bank}.csv`), { today: '2026-10-17' });
  if (!result.ok) throw new Error(result.reason);
  return result.rows;
}

describe('planStatementImport', () => {
  const rows = rowsOf('hdfc');

  it('ticks debits, shows credits unticked under money in', () => {
    const plan = planStatementImport(rows, { currency: 'INR' });
    const out = plan.items.filter((i) => i.section === 'out');
    const money = plan.items.filter((i) => i.section === 'in');
    expect(out).toHaveLength(6);
    expect(money).toHaveLength(2);
    expect(out.every((i) => i.ticked)).toBe(true);
    expect(money.some((i) => i.ticked)).toBe(false);
    expect(plan.summary).toMatchObject({
      added: 8,
      merged: 0,
      duplicatesSkipped: 0,
      moneyOut: 6,
      moneyIn: 2,
    });
    expect(plan.summary.spentMinor).toBe(45000n + 120050n + 500000n + 345678n + 80000n + 1000000n);
  });

  it('merges a row into the SMS draft that shares its reference, instead of adding a second', () => {
    const plan = planStatementImport(rows, {
      currency: 'INR',
      draftKeys: new Set(['ref:627412345678', 'ref:627512345679']),
    });
    const merged = plan.items.filter((i) => i.status === 'merged_sms');
    expect(merged.map((i) => i.mergeInto)).toEqual(['ref:627412345678', 'ref:627512345679']);
    expect(plan.summary).toMatchObject({ added: 6, merged: 2, duplicatesSkipped: 2 });
  });

  it('keys a referenced row exactly as the SMS parser would, and others by content', () => {
    expect(statementDedupeKey(rows[0]!)).toBe('ref:627412345678');
    expect(statementDedupeKey(rows[3]!, 1)).toMatch(/^stmt:2026-10-04:debit:500000:ATW/);
  });

  it('drops the same reference twice in one file, but keeps two identical coffees', () => {
    const coffee = { ...rows[3]!, ref: null, description: 'POS COFFEE', amount: '12000' };
    const plan = planStatementImport(
      [
        rows[0]!,
        { ...rows[0]!, index: 99 },
        { ...coffee, balance: '1000' },
        { ...coffee, balance: '-11000' },
        { ...coffee, balance: '-11000' },
      ],
      { currency: 'INR' },
    );
    expect(plan.items.map((i) => i.status)).toEqual([
      'new',
      'duplicate_in_file',
      'new',
      'new',
      'duplicate_in_file',
    ]);
    expect(plan.summary).toMatchObject({ added: 3, inFile: 2, duplicatesSkipped: 2 });
    // Identical reference-less rows still get distinct draft keys.
    expect(new Set(plan.items.map((i) => i.key)).size).toBeGreaterThanOrEqual(4);
  });

  it('leaves a likely ledger duplicate unticked and a possible one ticked with its match', () => {
    const existing: ExistingExpense[] = [
      {
        id: 'e1',
        date: '2026-10-01',
        currency: 'INR',
        amount: 45000n,
        description: 'UPI-SWIGGY-SWIGGY@ICICI-ICIC0000001-627412345678-ORDER',
      },
      {
        id: 'e2',
        date: '2026-10-02',
        currency: 'INR',
        amount: 120050n,
        description: 'ZOMATO food',
      },
    ];
    const plan = planStatementImport(rows, { currency: 'INR', existing });
    const first = plan.items[0]!;
    const third = plan.items[2]!;
    expect(first).toMatchObject({ status: 'likely_duplicate', ticked: false, duplicateOf: 'e1' });
    expect(third).toMatchObject({ status: 'possible_duplicate', ticked: true, duplicateOf: 'e2' });
  });

  it('starts unticked anything the balance check or confidence doubts', () => {
    const doubtful = [
      { ...rows[0]!, warnings: ['balance_mismatch' as const] },
      { ...rows[2]!, warnings: ['low_confidence' as const] },
      { ...rows[5]! },
    ];
    const plan = planStatementImport(doubtful, { currency: 'INR' });
    expect(plan.items.map((i) => i.ticked)).toEqual([false, false, true]);
    expect(plan.items[0]!.flags).toEqual(['balance_mismatch']);
  });

  it('does not compare money in against the ledger', () => {
    const existing: ExistingExpense[] = [
      {
        id: 'e',
        date: '2026-10-02',
        currency: 'INR',
        amount: 8500000n,
        description: 'ACME LTD SALARY',
      },
    ];
    const plan = planStatementImport(rows, { currency: 'INR', existing });
    expect(plan.items[1]!.status).toBe('new');
  });

  it('re-importing the same statement merges everything into the first import', () => {
    const first = planStatementImport(rows, { currency: 'INR' });
    const second = planStatementImport(rows, {
      currency: 'INR',
      draftKeys: new Set(first.items.map((i) => i.key)),
    });
    expect(second.summary.added).toBe(2); // only the reference-less rows (ATM, POS) have no shared key
  });
});

describe('previewStatement', () => {
  it('gives the Free teaser: how many, how much spent, the first three', () => {
    const preview = previewStatement(rowsOf('sbi'));
    expect(preview.count).toBe(8);
    expect(preview.spentMinor).toBe(2_090_728n);
    expect(preview.first.map((r) => r.amount)).toEqual(['45000', '8500000', '120050']);
  });
});

describe('plan gate', () => {
  it('is Pro only, 30 files, with two Free previews', () => {
    expect(canImportStatements(PlanTier.Free)).toBe(false);
    expect(canImportStatements(PlanTier.Pro)).toBe(true);
    expect(statementImportMonthlyLimit(PlanTier.Free)).toBe(0);
    expect(statementImportMonthlyLimit(PlanTier.Pro)).toBe(30);
    expect(statementPreviewMonthlyLimit(PlanTier.Free)).toBe(FREE_MONTHLY_STATEMENT_PREVIEWS);
    expect(FREE_MONTHLY_STATEMENT_PREVIEWS).toBe(2);
    expect(statementPreviewMonthlyLimit(PlanTier.Pro)).toBe(Number.POSITIVE_INFINITY);
  });
});
