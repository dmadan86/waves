/**
 * What may not leave the phone. These tests are the contract: if a line here
 * starts failing, a statement is being sent with something it should not carry.
 */

import { describe, expect, it } from 'vitest';

import { redactCells, redactStatementText } from '../../src';
import { statementText } from './fixtures';

const sent = (name: string, secrets: string[] = []) =>
  redactStatementText([statementText(name)], { secrets }).pages.join('\n');

describe('the header block is not sent', () => {
  const out = sent('hdfc.pdf.txt', ['Sample Holder']);

  it.each([
    'SAMPLE HOLDER',
    'SAMPLE STREET',
    'CHENNAI',
    '600001',
    'sample.holder@example.com',
    '9876543210',
    'Cust ID',
    '50100123456789',
    'GSTIN',
    'computer generated',
  ])('drops %s', (needle) => {
    expect(out).not.toContain(needle);
  });

  it('keeps the table: dates, amounts, balances and references', () => {
    expect(out).toContain('Date Narration');
    expect(out).toContain('01/10/26');
    expect(out).toContain('450.00');
    expect(out).toContain('49,550.00');
    expect(out).toContain('627412345678');
    expect(out).toContain('HDFCN52026100212345');
  });

  it('drops the header of the other banks too', () => {
    expect(sent('sbi.pdf.txt')).not.toMatch(/SAMPLE HOLDER|00000012345678901/);
    expect(sent('axis.pdf.txt')).not.toMatch(/SAMPLE HOLDER|912010012345678/);
  });
});

describe('numbers inside the table are masked to their last four', () => {
  const run = (line: string) =>
    redactStatementText([`Date Narration Withdrawal Deposit Balance\n${line}`]).pages[0]!;

  it('masks a labelled account number', () => {
    const out = run('01/10/26 NEFT TO A/C No. 50100123456789 RENT 5,000.00 9,000.00');
    expect(out).toContain('XXXXXXXXXX6789');
    expect(out).not.toContain('50100123456789');
  });

  it('masks a bare 16-digit card number, grouped or not', () => {
    expect(run('01/10/26 CARD 4012 3456 7890 1234 REFUND 100.00 900.00')).not.toContain(
      '4012 3456',
    );
    expect(run('01/10/26 CARD 4012345678901234 REFUND 100.00 900.00')).toContain(
      'XXXXXXXXXXXX1234',
    );
  });

  it('masks a mobile number in a UPI handle but not the 12-digit RRN beside it', () => {
    const out = run('01/10/26 UPI-RAHUL-9876543210@ybl-YESB0000001-627412345678-PAY 100.00 900.00');
    expect(out).not.toContain('9876543210');
    expect(out).toContain('XXXXXX3210@ybl');
    expect(out).toContain('627412345678');
  });

  it('keeps an RRN that happens to start with 91', () => {
    expect(run('01/10/26 UPI-X-919876543210-PAY 100.00 900.00')).toContain('919876543210');
  });

  it('masks e-mail addresses, PANs and Aadhaar numbers', () => {
    const out = run(
      '01/10/26 MAIL asha.rao@example.com PAN ABCDE1234F UID 1234 5678 9012 100.00 900.00',
    );
    expect(out).not.toMatch(/asha\.rao|ABCDE1234F|1234 5678 9012/);
    expect(out).toContain('***@example.com');
  });

  it('masks a long account-like number but leaves amounts alone', () => {
    const out = run('01/10/26 TRF 123456789012345 SOMEONE 1,23,456.78 9,00,000.00');
    expect(out).toContain('XXXXXXXXXXX2345');
    expect(out).toContain('1,23,456.78');
    expect(out).toContain('9,00,000.00');
  });

  it('scrubs the holder name wherever it appears, whatever its case or spacing', () => {
    const out = run('01/10/26 NEFT FROM asha   rao SALARY 100.00 900.00');
    const scrubbed = redactStatementText(
      ['Date Narration Withdrawal Balance\n01/10/26 NEFT FROM asha   rao 100.00 900.00'],
      {
        secrets: ['Asha Rao'],
      },
    ).pages[0]!;
    expect(out).toContain('asha');
    expect(scrubbed).not.toMatch(/asha/i);
  });
});

describe('US, UK and Australian identifiers', () => {
  const run = (line: string) =>
    redactStatementText([`Date Description Debit Credit Balance\n${line}`]).pages[0]!;

  it('masks routing numbers, sort codes and BSBs when labelled, and the account beside them', () => {
    expect(run('10/01/2026 ACH Routing 021000021 Account 123456789 10.00 90.00')).not.toMatch(
      /021000021|123456789/,
    );
    expect(run('01/10/2026 FPO Sort code 20-00-00 Account 12345678 10.00 90.00')).not.toMatch(
      /20-00-00|12345678/,
    );
    expect(run('01/10/2026 BSB 032-000 Account 123456 10.00 90.00')).not.toMatch(/032-000|123456/);
  });

  it('masks a social security number and a UK IBAN', () => {
    expect(run('10/01/2026 IRS 123-45-6789 10.00 90.00')).toContain('XXX-XX-XXXX');
    expect(run('01/10/2026 PAY GB29 NWBK 6016 1331 9268 19 10.00 90.00')).not.toContain('6016');
  });

  it('keeps amounts, dates and the narration', () => {
    const out = run('10/01/2026 STARBUCKS #1234 $4.50 995.50');
    expect(out).toContain('STARBUCKS #1234 $4.50 995.50');
  });
});

describe('page furniture', () => {
  it('cuts a repeated page header and footer but keeps a wrapped narration', () => {
    const page = [
      'SAMPLE HOLDER Page 2 of 3',
      'Account No : 50100123456789',
      'Date Narration Withdrawal Deposit Balance',
      '04/10/26 UPI-A-627412345678-X 10.00 90.00',
      'CONTINUED WORDS',
      'Registered Office: HDFC House',
    ].join('\n');
    const out = redactStatementText([page]).pages[0]!;
    expect(out).toBe(
      [
        'Date Narration Withdrawal Deposit Balance',
        '04/10/26 UPI-A-627412345678-X 10.00 90.00',
        'CONTINUED WORDS',
      ].join('\n'),
    );
  });

  it('sends nothing for a page with no transactions on it', () => {
    const result = redactStatementText([
      'Dear Customer, your statement is attached.\nSAMPLE HOLDER',
    ]);
    expect(result.pages).toEqual(['']);
    expect(result.stats.linesDropped).toBe(2);
  });

  it('counts what it masked', () => {
    const result = redactStatementText([statementText('hdfc.pdf.txt')]);
    expect(result.stats.linesDropped).toBeGreaterThan(8);
    expect(result.stats.masked).toBeGreaterThan(0);
  });
});

describe('cells', () => {
  it('masks a spreadsheet the same way', () => {
    expect(redactCells([['01/10/26', 'TRF TO 9876543210', 'a@b.co']])[0]).toEqual([
      '01/10/26',
      'TRF TO XXXXXX3210',
      '***@b.co',
    ]);
  });
});
