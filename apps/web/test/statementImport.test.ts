import { describe, expect, it } from 'vitest';

import { planStatementImport, previewStatement } from '@waves/core';

import {
  afterPreview,
  initialTicks,
  monthKey,
  previewsLeft,
  previewsUsed,
  readStatementFile,
  tableFromWorkbook,
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
  it('goes by the name before the type', async () => {
    expect(statementFileKind('a.csv', 'application/vnd.ms-excel')).toBe('csv');
    expect(statementFileKind('a.XLSX')).toBe('xlsx');
    expect(statementFileKind('a.pdf')).toBe('pdf');
    expect(statementFileKind('a.png', 'image/png')).toBe('other');
    expect(statementFileKind('download', 'text/csv')).toBe('csv');
  });
});

describe('reading a statement file in the browser', () => {
  it('reads a recognised bank layout into rows', async () => {
    const read = await readStatementFile('s.csv', 'text/csv', bytes(HDFC), '2026-10-17');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.bank).toBe('HDFC Bank');
    expect(read.rows).toHaveLength(3);
    expect(read.rows.filter((r) => r.direction === 'debit')).toHaveLength(2);
  });

  it('says so for a layout it does not know', async () => {
    const read = await readStatementFile('s.csv', '', bytes('a,b,c\n1,2,3\n'), '2026-10-17');
    expect(read).toEqual({ ok: false, failure: 'unknown_layout' });
  });

  it('refuses PDFs and other files without reading them', async () => {
    const body = bytes('x');
    expect(await readStatementFile('s.pdf', '', body, '2026-10-17')).toEqual({
      ok: false,
      failure: 'pdf_unsupported',
    });
    expect(await readStatementFile('s.png', 'image/png', body, '2026-10-17')).toEqual({
      ok: false,
      failure: 'unsupported',
    });
  });

  it('refuses a file over the size cap', async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    expect(await readStatementFile('s.csv', '', big, '2026-10-17')).toEqual({
      ok: false,
      failure: 'too_large',
    });
  });

  it('reports an empty file', async () => {
    expect(await readStatementFile('s.csv', '', bytes(''), '2026-10-17')).toEqual({
      ok: false,
      failure: 'empty',
    });
  });
});

describe('free previews per calendar month', () => {
  const sept = new Date(2026, 8, 20);
  const oct = new Date(2026, 9, 1);

  it('starts at zero and counts up', async () => {
    expect(previewsUsed(null, sept)).toBe(0);
    expect(previewsLeft(null, sept)).toBe(2);
    const one = afterPreview(null, sept);
    expect(previewsLeft(one, sept)).toBe(1);
    const two = afterPreview(one, sept);
    expect(previewsLeft(two, sept)).toBe(0);
    expect(previewsLeft(afterPreview(two, sept), sept)).toBe(0);
  });

  it('starts again in a new month', async () => {
    const two = afterPreview(afterPreview(null, sept), sept);
    expect(previewsLeft(two, oct)).toBe(2);
    expect(JSON.parse(afterPreview(two, oct))).toEqual({ month: monthKey(oct), count: 1 });
  });

  it('treats unreadable storage as nothing used', async () => {
    expect(previewsUsed('not json', sept)).toBe(0);
    expect(previewsUsed('{"month":3}', sept)).toBe(0);
    expect(previewsUsed('{"month":"2026-09","count":-4}', sept)).toBe(0);
  });
});

const read = await readStatementFile('s.csv', '', bytes(HDFC), '2026-10-17');

describe('the review list', () => {
  if (!read.ok) throw new Error('fixture must parse');

  it('ticks debits and leaves money in unticked', async () => {
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

  it('unticks and annotates a likely duplicate of an existing expense', async () => {
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

  it('notes a balance mismatch before low confidence', async () => {
    const [first] = read.rows;
    const plan = planStatementImport(
      [{ ...first, warnings: ['low_confidence', 'balance_mismatch'] }],
      { currency: 'INR' },
    );
    const [item] = reviewItems(plan);
    expect(statementNote(item)).toBe('balance_mismatch');
    expect(item.ticked).toBe(false);
  });

  it('previews the first three rows and the amount spent', async () => {
    const preview = previewStatement(read.rows);
    expect(preview.count).toBe(3);
    expect(preview.spentMinor).toBe(145050n);
    expect(preview.first).toHaveLength(3);
  });
});

describe('OFX on the web', () => {
  it('reads a .qfx by content, with its currency and FITID references', async () => {
    const qfx =
      '<OFX><CURDEF>USD<BANKTRANLIST><STMTTRN><DTPOSTED>20261001<TRNAMT>-4.50<FITID>20261001001A9<NAME>STARBUCKS</STMTTRN></BANKTRANLIST></OFX>';
    const read = await readStatementFile(
      'export.qfx',
      '',
      new TextEncoder().encode(qfx),
      '2026-10-17',
    );
    if (!read.ok) throw new Error(read.failure);
    expect(read.currency).toBe('USD');
    expect(read.rows[0]).toMatchObject({ amount: '450', direction: 'debit', ref: '20261001001A9' });
  });
});

describe('spreadsheets on the web', () => {
  it('reads an .xlsx of a known bank layout', async () => {
    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.aoa_to_sheet(HDFC.split('\n').map((line) => line.split(',')));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Statement');
    const out = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const read = await readStatementFile('s.xlsx', '', new Uint8Array(out), '2026-10-17');
    if (!read.ok) throw new Error(read.failure);
    expect(read.bank).toBe('HDFC Bank');
    expect(read.rows).toHaveLength(3);
  });

  it('reads dates from a 1904-system workbook', async () => {
    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.aoa_to_sheet([['Date'], [44834]]);
    sheet.A2 = { t: 'n', v: 44834, z: 'dd/mm/yyyy' };
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Statement');
    book.Workbook = { ...book.Workbook, WBProps: { date1904: true } };
    const out = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const table = await tableFromWorkbook(new Uint8Array(out));
    expect(table.rows[1]?.[0]).toBe('2026-10-01');
  });

  it('says so for a spreadsheet that is not one', async () => {
    expect(
      await readStatementFile('s.xlsx', '', bytes('not a workbook'), '2026-10-17'),
    ).toMatchObject({
      ok: false,
    });
  });

  it('hands an unknown layout over as redacted pages for the reader', async () => {
    const read = await readStatementFile(
      's.csv',
      '',
      bytes('Day,What,Paid\n01/09/2026,Coffee,3.50\n02/09/2026,Tea,2.00\n'),
      '2026-10-17',
    );
    if (read.ok) throw new Error('should not be a known layout');
    expect(read.pages?.length).toBeGreaterThan(0);
  });
});
