/**
 * Importing a bank statement in the browser: the parts that are not a screen.
 *
 * The browser reads CSV, OFX and .xlsx/.xls itself. A PDF needs pdf.js, which
 * the web app does not ship, so it is named "pdf_unsupported" rather than
 * half-handled (a password-protected one with it). The engine (layouts, balance check, merge plan) is @waves/core's; this file only
 * decides what to hand it and how many free previews are left.
 */

import {
  decodeBytes,
  excelSerialToIso,
  MAX_IMPORT_ROWS,
  tableToPages,
  type StatementPageInput,
  type TableRead,
  FREE_MONTHLY_STATEMENT_PREVIEWS,
  looksLikeOfx,
  parseOfx,
  parseStatementTable,
  readTable,
  STATEMENT_MAX_FILE_BYTES,
  STATEMENT_MAX_ROWS,
  type StatementItem,
  type StatementPlan,
  type StatementRow,
} from '@waves/core';

export type StatementFileKind = 'csv' | 'xlsx' | 'pdf' | 'other';

export type StatementReadFailure =
  | 'too_large'
  | 'too_many_rows'
  | 'empty'
  | 'unknown_layout'
  | 'no_transactions'
  | 'unreadable'
  | 'pdf_unsupported'
  | 'unsupported';

export type StatementRead =
  | {
      readonly ok: true;
      readonly bank: string | null;
      readonly currency: string;
      readonly rows: StatementRow[];
    }
  | {
      readonly ok: false;
      readonly failure: StatementReadFailure;
      /** Redacted text pages of a table whose layout is unknown: what a Pro person's reader takes. */
      readonly pages?: StatementPageInput[];
    };

/** Judged by name first: browsers label a .csv as ms-excel often enough. */
export function statementFileKind(name: string, mimeType = ''): StatementFileKind {
  if (/\.(csv|tsv|txt|ofx|qfx)$/i.test(name)) return 'csv';
  if (/\.xlsx?$/i.test(name)) return 'xlsx';
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/csv/i.test(mimeType)) return 'csv';
  if (/spreadsheetml|ms-excel/i.test(mimeType)) return 'xlsx';
  if (/pdf/i.test(mimeType)) return 'pdf';
  return 'other';
}

/** Read a picked file into statement rows, or say exactly why not. Nothing leaves the browser. */
export async function readStatementFile(
  name: string,
  mimeType: string,
  bytes: Uint8Array,
  today: string,
): Promise<StatementRead> {
  if (bytes.byteLength > STATEMENT_MAX_FILE_BYTES) return { ok: false, failure: 'too_large' };
  const kind = statementFileKind(name, mimeType);
  if (kind === 'pdf') return { ok: false, failure: 'pdf_unsupported' };
  if (kind === 'other') return { ok: false, failure: 'unsupported' };

  let table: TableRead;
  if (kind === 'xlsx') {
    try {
      table = await tableFromWorkbook(bytes);
    } catch (caught) {
      return {
        ok: false,
        failure:
          caught instanceof Error && caught.message === 'too_many_rows'
            ? 'too_many_rows'
            : 'unreadable',
      };
    }
    return readParsedTable(table, today);
  }
  const text = decodeBytes(bytes).text;
  if (looksLikeOfx(text)) {
    const ofx = parseOfx(text);
    if (!ofx.ok)
      return { ok: false, failure: ofx.reason === 'not_ofx' ? 'unsupported' : 'no_transactions' };
    if (ofx.rows.length > STATEMENT_MAX_ROWS) return { ok: false, failure: 'too_many_rows' };
    return { ok: true, bank: null, currency: ofx.currency, rows: ofx.rows };
  }
  return readParsedTable(readTable(text), today);
}

function readParsedTable(table: TableRead, today: string): StatementRead {
  if (table.rows.length === 0) return { ok: false, failure: 'empty' };
  const parsed = parseStatementTable(table, { today });
  if (!parsed.ok) {
    const pages = tableToPages(table.rows);
    return { ok: false, failure: parsed.reason, ...(pages.length > 0 ? { pages } : {}) };
  }
  if (parsed.rows.length > STATEMENT_MAX_ROWS) return { ok: false, failure: 'too_many_rows' };
  return { ok: true, bank: parsed.bank, currency: parsed.currency, rows: parsed.rows };
}

/** The first sheet with anything on it, as the table CSV would give. The reader loads on first use. */
export async function tableFromWorkbook(bytes: Uint8Array): Promise<TableRead> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(bytes, { type: 'array', cellNF: true, cellDates: false });
  // 1904-system workbooks (old Mac Excel) count days from 1904-01-01: 1462 days later.
  const serialShift = workbook.Workbook?.WBProps?.date1904 ? 1462 : 0;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet?.['!ref']) continue;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    // Refuse before walking a sheet of a million rows cell by cell.
    if (range.e.r - range.s.r > MAX_IMPORT_ROWS + 50) throw new Error('too_many_rows');
    const rows: string[][] = [];
    const lines: number[] = [];
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      const row: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })] as
          { t?: string; v?: unknown; z?: string | number } | undefined;
        row.push(cellText(cell, XLSX.SSF.is_date, serialShift));
      }
      if (row.every((cell) => cell.trim() === '')) continue;
      rows.push(row.map((cell) => cell.trim()));
      lines.push(r + 1);
    }
    if (rows.length > 0) return { rows, lines, delimiter: ',' };
  }
  return { rows: [], lines: [], delimiter: ',' };
}

function cellText(
  cell: { t?: string; v?: unknown; z?: string | number } | undefined,
  isDate: (format: string) => boolean,
  serialShift: number,
): string {
  if (!cell || cell.v === undefined || cell.v === null || cell.t === 'e') return '';
  if (cell.t === 'n' && typeof cell.v === 'number') {
    // A date is a number with a date format: read the day it is, not SheetJS's month-first display.
    if (typeof cell.z === 'string' && isDate(cell.z)) {
      const iso = excelSerialToIso(Math.floor(cell.v) + serialShift);
      if (iso) return iso;
    }
    return String(Number(cell.v.toPrecision(15)));
  }
  return String(cell.v);
}

// ---- free previews, counted per calendar month ----------------------------

export const PREVIEW_STORAGE_KEY = 'waves.statementPreviews';

/** `YYYY-MM` in the reader's own calendar. */
export function monthKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

interface PreviewCount {
  month: string;
  count: number;
}

function parseCount(raw: string | null): PreviewCount | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PreviewCount> | null;
    if (
      value &&
      typeof value.month === 'string' &&
      typeof value.count === 'number' &&
      Number.isFinite(value.count) &&
      value.count >= 0
    ) {
      return { month: value.month, count: Math.floor(value.count) };
    }
  } catch {
    // Unreadable storage counts as nothing used.
  }
  return null;
}

/** Previews used so far this month; a new month starts again at zero. */
export function previewsUsed(raw: string | null, now: Date): number {
  const stored = parseCount(raw);
  return stored && stored.month === monthKey(now) ? stored.count : 0;
}

export function previewsLeft(raw: string | null, now: Date): number {
  return Math.max(0, FREE_MONTHLY_STATEMENT_PREVIEWS - previewsUsed(raw, now));
}

/** The value to store after one more preview was shown. */
export function afterPreview(raw: string | null, now: Date): string {
  return JSON.stringify({ month: monthKey(now), count: previewsUsed(raw, now) + 1 });
}

// ---- the review list --------------------------------------------------------

export type StatementNote =
  | 'balance_mismatch'
  | 'low_confidence'
  | 'bad_date'
  | 'zero_amount'
  | 'likely_duplicate'
  | 'possible_duplicate';

/** The one short note a row carries, the most serious first; null when nothing doubts it. */
export function statementNote(item: StatementItem): StatementNote | null {
  if (item.status === 'likely_duplicate') return 'likely_duplicate';
  if (item.status === 'possible_duplicate') return 'possible_duplicate';
  for (const flag of ['balance_mismatch', 'bad_date', 'zero_amount', 'low_confidence'] as const) {
    if (item.flags.includes(flag)) return flag;
  }
  return null;
}

/** Rows shown for review: everything the plan kept (merged and in-file repeats are only counted). */
export function reviewItems(plan: StatementPlan): StatementItem[] {
  return plan.items.filter((i) => i.status !== 'merged_sms' && i.status !== 'duplicate_in_file');
}

/** The keys ticked to begin with: exactly what the plan says. */
export function initialTicks(plan: StatementPlan): Set<string> {
  return new Set(
    reviewItems(plan)
      .filter((i) => i.ticked)
      .map((i) => i.key),
  );
}
