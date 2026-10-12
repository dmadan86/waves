/**
 * A picked file becoming a table: the size and row caps, the encoding check, and
 * a real .xlsx going through SheetJS into the same shape a CSV does.
 */

import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { detectLayout, draftFromTable, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from '@waves/core';

import {
  GroupImportFileError,
  isSpreadsheet,
  tableFromBytes,
  tableFromRows,
  tableFromWorkbook,
} from '@/lib/groupImport/file';

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

function failureOf(run: () => unknown): string | null {
  try {
    run();
  } catch (caught) {
    return caught instanceof GroupImportFileError ? caught.failure : 'other';
  }
  return null;
}

/** An .xlsx as bytes, built the way Excel would write one. */
function workbookBytes(build: (sheet: XLSX.WorkSheet) => void, rows: unknown[][]): Uint8Array {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  build(sheet);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Expenses');
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

describe('reading a CSV', () => {
  it('decodes bytes and reads the table', () => {
    const { table, kind } = tableFromBytes(bytesOf('Date,Amount\n2026-10-01,50\n'), 'a.csv');
    expect(kind).toBe('csv');
    expect(table.rows).toEqual([
      ['Date', 'Amount'],
      ['2026-10-01', '50'],
    ]);
  });

  it('refuses a file over the byte cap before reading it', () => {
    const big = new Uint8Array(MAX_IMPORT_BYTES + 1).fill(97);
    expect(failureOf(() => tableFromBytes(big, 'a.csv'))).toBe('too_large');
  });

  it('refuses an empty file', () => {
    expect(failureOf(() => tableFromBytes(new Uint8Array(), 'a.csv'))).toBe('empty');
    expect(failureOf(() => tableFromBytes(bytesOf('\n\n'), 'a.csv'))).toBe('empty');
  });

  it('refuses more data rows than the cap, but allows exactly the cap', () => {
    const rows = (n: number) =>
      ['Date,Amount', ...Array.from({ length: n }, () => '2026-10-01,5')].join('\n');
    expect(tableFromBytes(bytesOf(rows(MAX_IMPORT_ROWS)), 'a.csv').table.rows).toHaveLength(
      MAX_IMPORT_ROWS + 1,
    );
    expect(failureOf(() => tableFromBytes(bytesOf(rows(MAX_IMPORT_ROWS + 1)), 'a.csv'))).toBe(
      'too_many_rows',
    );
  });

  it('reads an Excel-on-Windows file saved as Windows-1252', () => {
    // "Café" with é as the single byte 0xE9: not valid UTF-8, valid Windows-1252.
    const bytes = new Uint8Array([
      ...bytesOf('Date;Description;Amount\n2026-10-01;Caf'),
      0xe9,
      ...bytesOf(';5\n'),
    ]);
    const { table } = tableFromBytes(bytes, 'excel.csv');
    expect(table.rows[1]).toEqual(['2026-10-01', 'Café', '5']);
  });

  it('sends a file that did not decode cleanly back to be saved as UTF-8', () => {
    // 0x81 is one of the five bytes Windows-1252 leaves unmapped.
    const bytes = new Uint8Array([...bytesOf('Date,Description\n2026-10-01,Caf'), 0x81, 0x0a]);
    expect(failureOf(() => tableFromBytes(bytes, 'bad.csv'))).toBe('encoding');
  });
});

describe('reading a spreadsheet', () => {
  it('recognises one by name or by type, but not a CSV that Excel opens', () => {
    expect(isSpreadsheet('trip.XLSX')).toBe(true);
    expect(isSpreadsheet('trip.xls')).toBe(true);
    expect(isSpreadsheet('trip', 'application/vnd.ms-excel')).toBe(true);
    expect(isSpreadsheet('trip.csv', 'application/vnd.ms-excel')).toBe(false);
    expect(isSpreadsheet('trip.csv', 'text/csv')).toBe(false);
  });

  it('turns a workbook into a table of text and reads it like any other', () => {
    const bytes = workbookBytes(
      (sheet) => {
        // Dates come as Excel serials with a date format, amounts as numbers.
        sheet['A2'] = { t: 'n', v: 46296, z: 'dd/mm/yyyy' }; // 2026-10-01
        sheet['A3'] = { t: 'n', v: 46297, z: 'dd/mm/yyyy' };
      },
      [
        ['Date', 'Description', 'Amount', 'Paid by'],
        [0, 'Groceries', 1200, 'Asha'],
        [0, 'Cab', 640.5, 'Ravi'],
      ],
    );
    const loaded = tableFromBytes(bytes, 'trip.xlsx');
    expect(loaded.kind).toBe('xlsx');
    expect(loaded.table.rows).toEqual([
      ['Date', 'Description', 'Amount', 'Paid by'],
      ['2026-10-01', 'Groceries', '1200', 'Asha'],
      ['2026-10-02', 'Cab', '640.5', 'Ravi'],
    ]);

    const layout = detectLayout(loaded.table, {});
    const draft = draftFromTable(loaded.table, layout, { defaultCurrency: 'INR' });
    expect(draft.rows.map((row) => [row.date, row.amount])).toEqual([
      ['2026-10-01', 120000n],
      ['2026-10-02', 64050n],
    ]);
    expect(draft.people).toEqual(['Asha', 'Ravi']);
  });

  it('does not let float noise from a formula become a decimal error', () => {
    const bytes = workbookBytes(() => {}, [
      ['Date', 'Description', 'Amount'],
      ['2026-10-01', 'Sum', 0.1 + 0.2],
    ]);
    expect(tableFromWorkbook(bytes).rows[1]).toEqual(['2026-10-01', 'Sum', '0.3']);
  });

  it('skips blank rows but keeps the file’s own row numbers', () => {
    const bytes = workbookBytes(() => {}, [['Date', 'Amount'], [], ['2026-10-01', 5]]);
    const table = tableFromWorkbook(bytes);
    expect(table.rows).toEqual([
      ['Date', 'Amount'],
      ['2026-10-01', '5'],
    ]);
    expect(table.lines).toEqual([1, 3]);
  });

  it('takes the first sheet that has anything on it', () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), 'Empty');
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['Date', 'Amount'],
        ['2026-10-01', 9],
      ]),
      'Data',
    );
    const bytes = new Uint8Array(
      XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
    );
    expect(tableFromWorkbook(bytes).rows[1]).toEqual(['2026-10-01', '9']);
  });

  it('refuses a workbook that is empty or too long', () => {
    const empty = new Uint8Array(
      XLSX.write(
        (() => {
          const book = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), 'S');
          return book;
        })(),
        { type: 'array', bookType: 'xlsx' },
      ) as ArrayBuffer,
    );
    expect(failureOf(() => tableFromWorkbook(empty))).toBe('empty');

    const long = workbookBytes(() => {}, [
      ['Date', 'Amount'],
      ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ['2026-10-01', 1]),
    ]);
    expect(failureOf(() => tableFromBytes(long, 'long.xlsx'))).toBe('too_many_rows');
  });
});

describe('tableFromRows', () => {
  it('trims cells and drops fully blank rows', () => {
    expect(
      tableFromRows([
        [' a ', ''],
        ['', ' '],
        ['b', 'c'],
      ]),
    ).toEqual({
      rows: [
        ['a', ''],
        ['b', 'c'],
      ],
      lines: [1, 3],
      delimiter: ',',
    });
  });
});
