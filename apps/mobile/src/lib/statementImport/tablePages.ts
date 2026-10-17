/**
 * A spreadsheet the app does not recognise, as text pages for the reader.
 *
 * Only used for a Pro person's file whose layout matched none of the five banks
 * and could not be read from its headers either. The rows go through the same
 * masking as a PDF's text, and everything above the column header (account
 * holder, address, account number) is dropped: it has nothing to do with the
 * transactions.
 */

import { redactCells } from '@waves/core';

import type { StatementPageInput } from './run';

const DATE_LIKE =
  /(?:\d{1,2}[-/. ]\d{1,2}[-/. ]\d{2,4}|\d{1,2}[-/. ](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-/. ,]+\d{2,4}|\d{4}-\d{2}-\d{2})/i;

const ROWS_PER_PAGE = 120;

/** Header plus the transaction rows, with the preamble cut. Empty when no row has a date. */
export function transactionRows(
  rows: readonly (readonly string[])[],
): readonly (readonly string[])[] {
  const first = rows.findIndex((row) => row.some((cell) => DATE_LIKE.test(cell)));
  if (first < 0) return [];
  // The header is the closest row above the first dated row with several cells filled.
  let header = -1;
  for (let i = first - 1; i >= 0; i -= 1) {
    if (rows[i]!.filter((cell) => cell.trim() !== '').length >= 3) {
      header = i;
      break;
    }
  }
  return header >= 0 ? [rows[header]!, ...rows.slice(first)] : rows.slice(first);
}

/** Pages of masked text, a header line repeated at the top of each. */
export function tableToPages(
  rows: readonly (readonly string[])[],
  secrets: readonly string[] = [],
): StatementPageInput[] {
  const kept = transactionRows(rows);
  if (kept.length === 0) return [];
  const [header, ...body] = redactCells(kept, { secrets });
  const line = (row: readonly string[]): string => row.join(' | ');
  const pages: StatementPageInput[] = [];
  for (let at = 0; at < body.length; at += ROWS_PER_PAGE) {
    const slice = body.slice(at, at + ROWS_PER_PAGE);
    pages.push({
      kind: 'text',
      page: pages.length + 1,
      text: [line(header!), ...slice.map(line)].join('\n'),
    });
  }
  return pages;
}
