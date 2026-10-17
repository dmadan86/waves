/**
 * The five bank layouts, each against a synthetic export: the header is
 * recognised, every row is read to the paisa, references come out of the
 * narration, and the statement's own balances agree.
 */

import { describe, expect, it } from 'vitest';

import { detectBankProfile, parseStatementTable, readTable } from '../../src';
import { EXPECTED, EXPECTED_DATES, statementTable, statementText } from './fixtures';

const BANKS = [
  ['hdfc', 'HDFC Bank'],
  ['icici', 'ICICI Bank'],
  ['sbi', 'State Bank of India'],
  ['axis', 'Axis Bank'],
  ['kotak', 'Kotak Mahindra Bank'],
] as const;

describe.each(BANKS)('%s export', (id, bank) => {
  const table = statementTable(`${id}.csv`);

  it('is recognised by its header, past any preamble', () => {
    expect(detectBankProfile(table)?.profile.id).toBe(id);
  });

  it('reads every transaction exactly, with a passing balance check', () => {
    const result = parseStatementTable(table, { today: '2026-10-17' });
    if (!result.ok) throw new Error(result.reason);
    expect(result.bank).toBe(bank);
    expect(result.rows.map((r) => [r.direction, r.amount, r.balance])).toEqual(
      EXPECTED.map(([d, a, b]) => [d, a, b]),
    );
    expect(result.rows.map((r) => r.date)).toEqual(EXPECTED_DATES);
    expect(result.balanceChecked).toBe(7); // the first row has no earlier balance
    expect(result.balanceFailed).toBe(0);
    expect(result.rows.every((r) => r.warnings.length === 0)).toBe(true);
  });

  it('pulls the UPI / IMPS / NEFT references the SMS would carry', () => {
    const result = parseStatementTable(table, { today: '2026-10-17' });
    if (!result.ok) throw new Error(result.reason);
    expect(result.rows[0]!.ref).toBe('627412345678');
    expect(result.rows[2]!.ref).toBe('627512345679');
    expect(result.rows[4]!.ref).toBe('627612345680');
    expect(result.rows[6]!.ref).toBe('627712345681');
  });
});

describe('profiles', () => {
  it('refuses a file that is none of the five, so the column mapper takes over', () => {
    const table = readTable('Date,Payee,Amount\n01/10/2026,Cafe,120.00\n');
    expect(detectBankProfile(table)).toBeNull();
    expect(parseStatementTable(table)).toEqual({ ok: false, reason: 'unknown_layout' });
  });

  it('reads a bank outside the five from its header words alone, at lower confidence', () => {
    const csv =
      'Transaction Date,Details,Money Out,Money In,Running Balance\n' +
      '13/10/2026,UPI/P2M/627412345678/CAFE,120.00,,880.00\n' +
      '14/10/2026,SALARY,,1000.00,1880.00\n';
    const result = parseStatementTable(readTable(csv), { today: '2026-10-17' });
    if (!result.ok) throw new Error(result.reason);
    expect(result.profile).toBe('generic');
    expect(result.bank).toBeNull();
    expect(result.rows.map((r) => [r.date, r.direction, r.amount, r.confidence])).toEqual([
      ['2026-10-13', 'debit', '12000', 0.8],
      ['2026-10-14', 'credit', '100000', 0.8],
    ]);
    expect(result.balanceFailed).toBe(0);
  });

  it('does not take a Splitwise export for a bank', () => {
    const table = readTable(
      'Date,Description,Category,Cost,Currency,Asha\n2026-10-01,Dinner,Food,500.00,INR,250.00\n',
    );
    expect(detectBankProfile(table)).toBeNull();
  });

  it('flags a row whose balance does not follow from the one before it', () => {
    const text = statementText('hdfc.csv').replace('1200.50', '1200.60');
    const result = parseStatementTable(readTable(text), { today: '2026-10-17' });
    if (!result.ok) throw new Error(result.reason);
    expect(result.balanceFailed).toBe(1);
    expect(result.rows[2]!.warnings).toContain('balance_mismatch');
    expect(result.rows[3]!.warnings).not.toContain('balance_mismatch');
  });

  it('joins a narration that wrapped onto the next spreadsheet row', () => {
    const csv =
      'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n' +
      '01/10/26,UPI-SWIGGY-SWIGGY@ICICI,0000627412345678,01/10/26,450.00,,49550.00\n' +
      ',ICIC0000001-ORDER,,,,,\n' +
      'Statement Summary,,,,,,\n';
    const result = parseStatementTable(readTable(csv), { today: '2026-10-17' });
    if (!result.ok) throw new Error(result.reason);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.description).toBe('UPI-SWIGGY-SWIGGY@ICICI ICIC0000001-ORDER');
    expect(result.skipped).toBe(1);
  });

  it('reads a debit balance (Dr) as negative', () => {
    const csv =
      'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n' +
      '01/10/26,POS SHOP,,01/10/26,450.00,,100.00 Dr\n';
    const result = parseStatementTable(readTable(csv), { today: '2026-10-17' });
    if (!result.ok) throw new Error(result.reason);
    expect(result.rows[0]!.balance).toBe('-10000');
  });
});
