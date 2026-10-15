/**
 * A picked file, as the table the shared reader works on.
 *
 * A CSV is bytes to text to cells, all in `@waves/core` (encoding, delimiter,
 * quoted newlines). A spreadsheet is cells already, so it only has to be turned
 * into the same `TableRead`; from there both take the same road. The caps are
 * checked here, before anything is decoded or parsed, so a 40 MB file is refused
 * in a moment rather than after the phone has spent ten seconds on it.
 */

import * as XLSX from 'xlsx';

import {
  decodeBytes,
  excelSerialToIso,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  readTable,
  type TableRead,
} from '@waves/core';

export type FileFailure = 'too_large' | 'too_many_rows' | 'empty' | 'encoding' | 'unreadable';

/** Why a file could not be read; the screen turns `failure` into a sentence. */
export class GroupImportFileError extends Error {
  constructor(readonly failure: FileFailure) {
    super(`import file: ${failure}`);
    this.name = 'GroupImportFileError';
  }
}

export interface LoadedTable {
  readonly table: TableRead;
  readonly kind: 'csv' | 'xlsx';
}

/** `.xlsx` and the older `.xls`: judged by name or type, since pickers label them inconsistently. */
export function isSpreadsheet(name: string, mimeType?: string | null): boolean {
  if (/\.xlsx?$/i.test(name)) return true;
  // Android reports a .csv as application/vnd.ms-excel often enough that the name has to win.
  if (/\.(csv|tsv|txt)$/i.test(name)) return false;
  const mime = mimeType ?? '';
  return /spreadsheetml|ms-excel/i.test(mime) && !/csv/i.test(mime);
}

/** Rows kept as the file numbered them, so "row 14" in a message is row 14 in Excel. */
export function tableFromRows(rows: readonly (readonly string[])[]): TableRead {
  const kept: string[][] = [];
  const lines: number[] = [];
  rows.forEach((row, index) => {
    const cells = row.map((cell) => cell.trim());
    if (cells.every((cell) => cell === '')) return;
    kept.push(cells);
    lines.push(index + 1);
  });
  return { rows: kept, lines, delimiter: ',' };
}

/** Header row plus data, so the cap counts what the reader will count. */
function assertWithinRows(table: TableRead): TableRead {
  if (table.rows.length === 0) throw new GroupImportFileError('empty');
  if (table.rows.length - 1 > MAX_IMPORT_ROWS) throw new GroupImportFileError('too_many_rows');
  return table;
}

/** What a number cell reads as: its value, without the float noise a formula leaves behind. */
function numberText(value: number): string {
  return String(Number(value.toPrecision(15)));
}

interface Cell {
  t?: string;
  v?: unknown;
  z?: string | number;
}

function cellText(cell: Cell | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null) return '';
  if (cell.t === 'e') return '';
  if (cell.t === 'n' && typeof cell.v === 'number') {
    // A date is a number with a date format. Read it as the day it is, not as
    // the display string, which SheetJS renders month-first whatever the
    // spreadsheet's locale was.
    if (typeof cell.z === 'string' && XLSX.SSF.is_date(cell.z)) {
      const iso = excelSerialToIso(Math.floor(cell.v));
      if (iso) return iso;
    }
    return numberText(cell.v);
  }
  if (cell.t === 'd' && cell.v instanceof Date) return cell.v.toISOString().slice(0, 10);
  return String(cell.v);
}

/** The first sheet that has anything on it, as rows of text. */
export function tableFromWorkbook(bytes: Uint8Array): TableRead {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: 'array', cellNF: true, cellDates: false });
  } catch {
    throw new GroupImportFileError('unreadable');
  }
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet?.['!ref']) continue;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    // Refuse before walking a sheet of a million rows cell by cell.
    if (range.e.r - range.s.r > MAX_IMPORT_ROWS + 50) {
      throw new GroupImportFileError('too_many_rows');
    }
    const rows: string[][] = [];
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      const row: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        row.push(cellText(sheet[XLSX.utils.encode_cell({ r, c })] as Cell | undefined));
      }
      rows.push(row);
    }
    const table = tableFromRows(rows);
    if (table.rows.length > 0) return assertWithinRows(table);
  }
  throw new GroupImportFileError('empty');
}

/** Bytes of a picked file to a table. Throws {@link GroupImportFileError}. */
export function tableFromBytes(
  bytes: Uint8Array,
  name: string,
  mimeType?: string | null,
): LoadedTable {
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new GroupImportFileError('too_large');
  if (bytes.byteLength === 0) throw new GroupImportFileError('empty');

  if (isSpreadsheet(name, mimeType)) {
    return { table: tableFromWorkbook(bytes), kind: 'xlsx' };
  }
  const decoded = decodeBytes(bytes);
  // A guessed character in a name becomes a person who does not exist, so a
  // file that did not decode cleanly is sent back to be saved as UTF-8 instead.
  if (decoded.lossy) throw new GroupImportFileError('encoding');
  return { table: assertWithinRows(readTable(decoded.text)), kind: 'csv' };
}
