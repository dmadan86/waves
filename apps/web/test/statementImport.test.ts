import { describe, expect, it } from 'vitest';

import { planStatementImport, previewStatement } from '@waves/core';

import {
  afterPreview,
  initialTicks,
  monthKey,
  previewsLeft,
  previewsUsed,
  readStatementFile,
  reviewItems,
  statementFileKind,
  statementNote,
} from '../src/lib/statementImport';

const bytes = (text: string) => new TextEncoder().encode(text);

const HDFC = [
  'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
  '01/09/26,UPI-SWIGGY-SWIGGY@ICICI-ICIC0000001-624512345678-FOOD,0000624512345678,01/09/26,250.00,,9750.00',
  '02/09/26,SALARY SEP,0000000000000001,02/09/26,,50000.00,59750.00',
  '03/09/26,POS 4512XXXXXXXX1234 BIGBASKET,0000000000000002,03/09/26,1200.50,,58549.50',
].join('\n');

describe('what kind of file was picked', () => {
  it('goes by the name before the type', () => {
    expect(statementFileKind('a.csv', 'application/vnd.ms-excel')).toBe('csv');
    expect(statementFileKind('a.XLSX')).toBe('xlsx');
    expect(statementFileKind('a.pdf')).toBe('pdf');
    expect(statementFileKind('a.png', 'image/png')).toBe('other');
    expect(statementFileKind('download', 'text/csv')).toBe('csv');
  });
});

describe('reading a statement file in the browser', () => {
  it('reads a recognised bank layout into rows', () => {
    const read = readStatementFile('s.csv', 'text/csv', bytes(HDFC), '2026-10-17');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.bank).toBe('HDFC Bank');
    expect(read.rows).toHaveLength(3);
    expect(read.rows.filter((r) => r.direction === 'debit')).toHaveLength(2);
  });

  it('says so for a layout it does not know', () => {
    const read = readStatementFile('s.csv', '', bytes('a,b,c\n1,2,3\n'), '2026-10-17');
    expect(read).toEqual({ ok: false, failure: 'unknown_layout' });
  });

  it('refuses spreadsheets, PDFs and other files without reading them', () => {
    const body = bytes('x');
    expect(readStatementFile('s.xlsx', '', body, '2026-10-17')).toEqual({
      ok: false,
      failure: 'xlsx_unsupported',
    });
    expect(readStatementFile('s.pdf', '', body, '2026-10-17')).toEqual({
      ok: false,
      failure: 'pdf_unsupported',
    });
    expect(readStatementFile('s.png', 'image/png', body, '2026-10-17')).toEqual({
      ok: false,
      failure: 'unsupported',
    });
  });

  it('refuses a file over the size cap', () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    expect(readStatementFile('s.csv', '', big, '2026-10-17')).toEqual({
      ok: false,
      failure: 'too_large',
    });
  });

  it('reports an empty file', () => {
    expect(readStatementFile('s.csv', '', bytes(''), '2026-10-17')).toEqual({
      ok: false,
      failure: 'empty',
    });
  });
});

describe('free previews per calendar month', () => {
  const sept = new Date(2026, 8, 20);
  const oct = new Date(2026, 9, 1);

  it('starts at zero and counts up', () => {
    expect(previewsUsed(null, sept)).toBe(0);
    expect(previewsLeft(null, sept)).toBe(2);
    const one = afterPreview(null, sept);
    expect(previewsLeft(one, sept)).toBe(1);
    const two = afterPreview(one, sept);
    expect(previewsLeft(two, sept)).toBe(0);
    expect(previewsLeft(afterPreview(two, sept), sept)).toBe(0);
  });

  it('starts again in a new month', () => {
    const two = afterPreview(afterPreview(null, sept), sept);
    expect(previewsLeft(two, oct)).toBe(2);
    expect(JSON.parse(afterPreview(two, oct))).toEqual({ month: monthKey(oct), count: 1 });
  });

  it('treats unreadable storage as nothing used', () => {
    expect(previewsUsed('not json', sept)).toBe(0);
    expect(previewsUsed('{"month":3}', sept)).toBe(0);
    expect(previewsUsed('{"month":"2026-09","count":-4}', sept)).toBe(0);
  });
});

describe('the review list', () => {
  const read = readStatementFile('s.csv', '', bytes(HDFC), '2026-10-17');
  if (!read.ok) throw new Error('fixture must parse');

  it('ticks debits and leaves money in unticked', () => {
    const plan = planStatementImport(read.rows, { currency: 'INR', existing: [] });
    const items = reviewItems(plan);
    expect(items).toHaveLength(3);
    const ticks = initialTicks(plan);
    expect(ticks.size).toBe(2);
    const credit = items.find((i) => i.section === 'in');
    expect(credit && ticks.has(credit.key)).toBe(false);
    expect(plan.summary.added).toBe(3);
    expect(plan.summary.duplicatesSkipped).toBe(0);
  });

  it('unticks and annotates a likely duplicate of an existing expense', () => {
    const plan = planStatementImport(read.rows, {
      currency: 'INR',
      existing: [
        {
          id: 'e1',
          date: '2026-09-01',
          currency: 'INR',
          amount: 25000n,
          description: read.rows[0].description,
        },
      ],
    });
    const swiggy = reviewItems(plan).find((i) => i.row.description.includes('SWIGGY'));
    expect(swiggy).toBeDefined();
    if (!swiggy) return;
    expect(swiggy.ticked).toBe(false);
    expect(statementNote(swiggy)).toMatch(/duplicate/);
  });

  it('notes a balance mismatch before low confidence', () => {
    const [first] = read.rows;
    const plan = planStatementImport(
      [{ ...first, warnings: ['low_confidence', 'balance_mismatch'] }],
      { currency: 'INR' },
    );
    const [item] = reviewItems(plan);
    expect(statementNote(item)).toBe('balance_mismatch');
    expect(item.ticked).toBe(false);
  });

  it('previews the first three rows and the amount spent', () => {
    const preview = previewStatement(read.rows);
    expect(preview.count).toBe(3);
    expect(preview.spentMinor).toBe(145050n);
    expect(preview.first).toHaveLength(3);
  });
});

describe('OFX on the web', () => {
  it('reads a .qfx by content, with its currency and FITID references', () => {
    const qfx =
      '<OFX><CURDEF>USD<BANKTRANLIST><STMTTRN><DTPOSTED>20261001<TRNAMT>-4.50<FITID>20261001001A9<NAME>STARBUCKS</STMTTRN></BANKTRANLIST></OFX>';
    const read = readStatementFile('export.qfx', '', new TextEncoder().encode(qfx), '2026-10-17');
    if (!read.ok) throw new Error(read.failure);
    expect(read.currency).toBe('USD');
    expect(read.rows[0]).toMatchObject({ amount: '450', direction: 'debit', ref: '20261001001A9' });
  });
});
