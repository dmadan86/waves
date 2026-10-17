/**
 * What the statement-reading model said, checked.
 *
 * Mirrors `validateScreenshotExtraction`: the model transcribes, this decides
 * what is fit to show. Bad rows are dropped and counted, a total or summary
 * line never becomes a row, and nothing here ever throws.
 */

import { applyBalanceCheck } from './balance';
import { STATEMENT_MAX_ROWS } from './limits';
import { normaliseRef } from './narration';
import type {
  StatementDirection,
  StatementExtraction,
  StatementRow,
  StatementRowWarning,
  StatementWarning,
} from './types';

/** Rows below this start unticked. */
export const STATEMENT_LOW_CONFIDENCE = 0.6;

const CURRENCY_RE = /^[A-Z]{3}$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MINOR_RE = /^\d{1,15}$/;
const SIGNED_MINOR_RE = /^-?\d{1,15}$/;
const MAX_DESCRIPTION = 240;

export interface StatementValidationOptions {
  /** Defaults to {@link STATEMENT_MAX_ROWS}. */
  readonly maxRows?: number;
}

export type StatementValidation =
  | { readonly ok: true; readonly extraction: StatementExtraction }
  | { readonly ok: false; readonly reason: 'malformed' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text === '' ? null : text.slice(0, max);
}

export function validIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = ISO_DATE_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate() ? value : null;
}

/** Digits only (and a leading '-' when signed), no leading zeros, or null. */
function minorString(value: unknown, signed: boolean): string | null {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return null;
    text = String(value);
  } else if (typeof value === 'string') {
    text = value.trim();
  } else return null;
  if (!(signed ? SIGNED_MINOR_RE : MINOR_RE).test(text)) return null;
  const negative = text.startsWith('-');
  const digits = (negative ? text.slice(1) : text).replace(/^0+(?=\d)/, '');
  return negative && digits !== '0' ? `-${digits}` : digits;
}

export function validateStatementExtraction(
  raw: unknown,
  options: StatementValidationOptions = {},
): StatementValidation {
  if (!isRecord(raw) || !Array.isArray(raw.rows)) return { ok: false, reason: 'malformed' };
  const cap = options.maxRows ?? STATEMENT_MAX_ROWS;

  const warnings: StatementWarning[] = [];
  const currency =
    typeof raw.currency === 'string' && CURRENCY_RE.test(raw.currency.trim().toUpperCase())
      ? raw.currency.trim().toUpperCase()
      : null;

  const rows: StatementRow[] = [];
  let invalid = 0;
  let summaries = 0;

  raw.rows.slice(0, cap).forEach((item, index) => {
    if (!isRecord(item)) {
      invalid += 1;
      return;
    }
    if (item.isTotalOrSummary === true) {
      summaries += 1;
      return;
    }
    const description = cleanText(item.description, MAX_DESCRIPTION);
    const amount = minorString(item.amount, false);
    const direction: StatementDirection | null =
      item.direction === 'debit' || item.direction === 'credit' ? item.direction : null;
    if (description === null || amount === null || direction === null) {
      invalid += 1;
      return;
    }

    const rowWarnings: StatementRowWarning[] = [];
    const date = validIsoDate(item.date);
    if (date === null) rowWarnings.push('bad_date');
    if (BigInt(amount) === 0n) rowWarnings.push('zero_amount');

    const confidence =
      typeof item.confidence === 'number' && Number.isFinite(item.confidence)
        ? Math.min(1, Math.max(0, item.confidence))
        : 0.8;
    if (confidence < STATEMENT_LOW_CONFIDENCE) rowWarnings.push('low_confidence');

    const refText = cleanText(item.ref, 40);
    rows.push({
      index,
      date,
      description,
      amount,
      direction,
      ref: refText ? normaliseRef(refText) : null,
      balance: minorString(item.balance, true),
      confidence,
      warnings: rowWarnings,
    });
  });

  invalid += Math.max(0, raw.rows.length - cap);
  if (raw.rows.length > cap)
    warnings.push({ code: 'rows_truncated', count: raw.rows.length - cap });
  if (invalid > 0) warnings.push({ code: 'rows_dropped_invalid', count: invalid });
  if (summaries > 0) warnings.push({ code: 'summary_rows_dropped', count: summaries });
  if (rows.length === 0) warnings.push({ code: 'no_rows', count: 0 });

  const openingBalance = minorString(raw.openingBalance, true);
  // The balance check applies to model output too: a failing row starts unticked.
  const checked = applyBalanceCheck(rows, { openingBalance });
  return {
    ok: true,
    extraction: { currency, rows: checked.rows, openingBalance, warnings },
  };
}
