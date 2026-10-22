/**
 * The text layer of a statement PDF, read without a model. The direction of
 * each row is worked out from the running balance, so these pin that arithmetic
 * and the cases where it cannot be trusted.
 */

import { describe, expect, it } from 'vitest';

import { applyBalanceCheck, parseStatementText } from '../../src';
import { EXPECTED, EXPECTED_DATES, statementText } from './fixtures';

describe.each(['hdfc', 'sbi', 'axis'])('%s text dump', (bank) => {
  it('reads every row with the right direction, and the balances agree', () => {
    const result = parseStatementText([statementText(`${bank}.pdf.txt`)], { today: '2026-10-17' });
    expect(result.rows.map((r) => [r.direction, r.amount, r.balance])).toEqual(
      EXPECTED.map(([d, a, b]) => [d, a, b]),
    );
    expect(result.rows.map((r) => r.date)).toEqual(EXPECTED_DATES);
    expect(result.balanceFailed).toBe(0);
    // The statement states its opening balance (HDFC, Axis) or it does not (SBI).
    expect(result.rows.slice(1).every((r) => r.confidence >= 0.9)).toBe(true);
    expect(result.unreadable).toBe(0);
  });
});

describe('hdfc text dump', () => {
  const result = parseStatementText([statementText('hdfc.pdf.txt')], { today: '2026-10-17' });

  it('joins wrapped narrations and finds the reference inside', () => {
    expect(result.rows[0]!.description).toContain(
      'UPI-SWIGGY-SWIGGY@ICICI-ICIC0000001-627412345678-ORDER',
    );
    expect(result.rows[0]!.ref).toBe('627412345678');
    expect(result.rows[1]!.ref).toBe('HDFCN52026100212345');
  });

  it('uses the stated opening balance, so even the first row is verified', () => {
    expect(result.openingBalance).toBe('5000000');
    expect(result.rows[0]!.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.balanceChecked).toBe(8);
  });

  it('leaves the header block and footer out of the rows', () => {
    const text = result.rows.map((r) => r.description).join(' ');
    expect(text).not.toMatch(/SAMPLE HOLDER|sample.holder|GSTIN|computer generated|Page 1/);
  });
});

describe('without an opening balance', () => {
  const text = statementText('sbi.pdf.txt');

  it('marks the first row as a guess rather than trusting its wording', () => {
    const result = parseStatementText([text], { today: '2026-10-17' });
    expect(result.openingBalance).toBeNull();
    expect(result.rows[0]!.confidence).toBeLessThan(0.6);
    expect(result.rows[0]!.warnings).toContain('low_confidence');
  });

  it('takes the opening balance from the caller when it is known', () => {
    const result = parseStatementText([text], { today: '2026-10-17', openingBalance: '5000000' });
    expect(result.rows[0]!.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.rows[0]!.direction).toBe('debit');
  });
});

describe('a file that runs newest first', () => {
  it('works out directions against the row below, and the check agrees', () => {
    const result = parseStatementText([statementText('newest-first.pdf.txt')], {
      today: '2026-10-17',
    });
    expect(result.rows[0]!.date).toBe('2026-10-09');
    expect(result.rows[0]!.direction).toBe('debit');
    const credit = result.rows.find((r) => r.amount === '8500000');
    expect(credit?.direction).toBe('credit');
    expect(result.balanceFailed).toBe(0);
    expect(applyBalanceCheck(result.rows).order).toBe('newest_first');
  });
});

describe('a misread amount', () => {
  it('is flagged by the balance check instead of passing quietly', () => {
    const text = statementText('axis.pdf.txt').replace(
      '1,200.50 1,33,349.50',
      '1,290.50 1,33,349.50',
    );
    const result = parseStatementText([text], { today: '2026-10-17' });
    const bad = result.rows[2]!;
    expect(bad.warnings).toContain('balance_mismatch');
    expect(bad.confidence).toBeLessThan(0.6);
    expect(result.rows[3]!.warnings).not.toContain('balance_mismatch');
  });
});

describe('pathological whitespace', () => {
  // Statement text is user-uploaded and also parsed server-side: no input may go super-linear.
  const bad = [
    `page${'\t'.repeat(50_000)}no${'\t'.repeat(50_000)}`,
    `page${'\t'.repeat(50_000)}`,
    `2020${'\t\t'.repeat(25_000)}x\ry`,
    '\t\t'.repeat(25_000),
    ' \t'.repeat(25_000),
  ];

  it.each(bad.map((text, i) => [i, text] as const))('case %i parses in under 50 ms', (_i, text) => {
    const start = performance.now();
    parseStatementText([`${text}\n${text}`], { today: '2026-10-17' });
    expect(performance.now() - start).toBeLessThan(50);
  });
});
