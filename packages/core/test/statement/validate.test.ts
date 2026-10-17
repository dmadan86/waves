/**
 * The model's reading of a statement is checked, never trusted: bad rows are
 * dropped and counted, summaries never become rows, the row cap holds, and the
 * statement's own balances can unmask a misread.
 */

import { describe, expect, it } from 'vitest';

import {
  applyBalanceCheck,
  PRO_MONTHLY_STATEMENT_IMPORTS,
  STATEMENT_MAX_ROWS,
  validateStatementExtraction,
} from '../../src';

const row = (over: Record<string, unknown> = {}) => ({
  date: '2026-10-01',
  dateText: '01/10/26',
  description: 'UPI-SWIGGY-627412345678',
  amount: '45000',
  direction: 'debit',
  ref: '627412345678',
  balance: null,
  confidence: 0.95,
  isTotalOrSummary: false,
  ...over,
});

const ok = (raw: unknown, options = {}) => {
  const result = validateStatementExtraction(raw, options);
  if (!result.ok) throw new Error('malformed');
  return result.extraction;
};

describe('validateStatementExtraction', () => {
  it('rejects anything that is not {rows: []}', () => {
    expect(validateStatementExtraction(null)).toEqual({ ok: false, reason: 'malformed' });
    expect(validateStatementExtraction({ rows: 'x' })).toEqual({ ok: false, reason: 'malformed' });
    expect(validateStatementExtraction([])).toEqual({ ok: false, reason: 'malformed' });
  });

  it('keeps a good row exactly', () => {
    const { rows, currency } = ok({ currency: 'inr', rows: [row()] });
    expect(currency).toBe('INR');
    expect(rows).toEqual([
      {
        index: 0,
        date: '2026-10-01',
        description: 'UPI-SWIGGY-627412345678',
        amount: '45000',
        direction: 'debit',
        ref: '627412345678',
        balance: null,
        confidence: 0.95,
        warnings: [],
      },
    ]);
  });

  it('drops rows with no description, a bad amount or no direction, and counts them', () => {
    const extraction = ok({
      rows: [
        row(),
        row({ description: '  ' }),
        row({ amount: '12.50' }),
        row({ amount: '-5' }),
        row({ amount: 1.5 }),
        row({ direction: 'sideways' }),
        'nope',
      ],
    });
    expect(extraction.rows).toHaveLength(1);
    expect(extraction.warnings).toContainEqual({ code: 'rows_dropped_invalid', count: 6 });
  });

  it('never turns a total or summary line into a row', () => {
    const extraction = ok({
      rows: [row(), row({ description: 'Closing balance', isTotalOrSummary: true })],
    });
    expect(extraction.rows).toHaveLength(1);
    expect(extraction.warnings).toContainEqual({ code: 'summary_rows_dropped', count: 1 });
  });

  it('accepts amounts as safe integers and normalises leading zeros', () => {
    const { rows } = ok({ rows: [row({ amount: 45000 }), row({ amount: '000450' })] });
    expect(rows.map((r) => r.amount)).toEqual(['45000', '450']);
  });

  it('flags a bad date, a zero amount and low confidence on the row', () => {
    const { rows } = ok({
      rows: [row({ date: '2026-02-31', amount: '0', confidence: 0.3 })],
    });
    expect(rows[0]!.date).toBeNull();
    expect(rows[0]!.warnings).toEqual(['bad_date', 'zero_amount', 'low_confidence']);
  });

  it('normalises a reference the way the SMS key does', () => {
    const { rows } = ok({ rows: [row({ ref: ' hdfcn5 2026100212345 ' })] });
    expect(rows[0]!.ref).toBe('HDFCN52026100212345');
  });

  it('caps the rows at 5000 and says how many were cut', () => {
    expect(STATEMENT_MAX_ROWS).toBe(5000);
    const many = Array.from({ length: 5003 }, () => row());
    const extraction = ok({ rows: many });
    expect(extraction.rows).toHaveLength(5000);
    expect(extraction.warnings).toContainEqual({ code: 'rows_truncated', count: 3 });
  });

  it('says there were no rows rather than returning nothing silently', () => {
    expect(ok({ rows: [] }).warnings).toContainEqual({ code: 'no_rows', count: 0 });
  });

  it('runs the balance check on model output: a row that does not add up starts flagged', () => {
    const { rows } = ok({
      openingBalance: '5000000',
      rows: [
        row({ amount: '45000', balance: '4955000' }),
        row({ amount: '120050', balance: '4800000', ref: null, description: 'ZOMATO' }),
        row({ amount: '500000', balance: '4300000', ref: null, description: 'ATM' }),
      ],
    });
    expect(rows[0]!.warnings).not.toContain('balance_mismatch');
    expect(rows[1]!.warnings).toContain('balance_mismatch');
    expect(rows[2]!.warnings).not.toContain('balance_mismatch');
  });
});

describe('applyBalanceCheck', () => {
  const mk = (amount: string, direction: 'debit' | 'credit', balance: string) => ({
    index: 0,
    date: '2026-10-01',
    description: 'x',
    amount,
    direction,
    ref: null,
    balance,
    confidence: 1,
    warnings: [] as const,
  });

  it('is idempotent: re-running clears and recomputes', () => {
    const rows = [mk('100', 'debit', '900'), mk('50', 'credit', '999')];
    const first = applyBalanceCheck(rows);
    expect(first.failed).toBe(1);
    const second = applyBalanceCheck(first.rows);
    expect(second.rows[1]!.warnings).toEqual(['balance_mismatch']);
  });

  it('does not flag a row it cannot compare', () => {
    const result = applyBalanceCheck([
      mk('100', 'debit', '900'),
      { ...mk('1', 'debit', '1'), balance: null },
    ]);
    expect(result.checked).toBe(0);
    expect(result.failed).toBe(0);
  });
});

describe('quota constants', () => {
  it('is 30 files a month', () => {
    expect(PRO_MONTHLY_STATEMENT_IMPORTS).toBe(30);
  });
});
