/**
 * A statement's PDF text layer, read into rows without a model.
 *
 * Text extracted from a bank's PDF flattens its table into lines like
 *
 *   01/10/26 UPI-SWIGGY-SWIGGY@ICICI-ICIC0000001-627412345678-ORDER 01/10/26 450.00 54,321.50
 *
 * The debit and credit columns are gone: there is one amount and the balance
 * after it. So the direction is not read, it is worked out: if the balance went
 * down by the amount it was a debit, up, a credit. That is the same arithmetic
 * the balance check runs, which is why a row whose direction could not be
 * confirmed this way starts low-confidence and unticked rather than guessed.
 *
 * This is the deterministic first pass for a text-layer PDF of any bank that
 * prints "date, narration, amount, balance" on a line (the five big ones do).
 * Scanned pages have no text layer and go to the model as images instead.
 */

import { parseLooseAmount } from '../import/amount';
import { resolveDates } from '../import/date';
import { applyBalanceCheck } from './balance';
import { referenceFor } from './narration';
import type { StatementRow } from './types';

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
const DATE_SRC =
  '(?:\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2,4}|\\d{1,2}[-/. ]' +
  MONTH +
  '[-/. ,]+\\d{2,4}|\\d{4}-\\d{2}-\\d{2})';
const LEADING_DATE = new RegExp(`^\\s*(${DATE_SRC})(?![\\d])`, 'i');
const TRAILING_DATE = new RegExp(`\\s(${DATE_SRC})\\s*$`, 'i');
const AMOUNT_SRC = '-?(?:\\d{1,3}(?:,\\d{2,3})+|\\d+)\\.\\d{2}(?:\\s?(?:cr|dr)\\.?)?';
const TRAILING_AMOUNT = new RegExp(`\\s(${AMOUNT_SRC})\\s*$`, 'i');

const FURNITURE =
  /\b(?:registered office|gstin|computer generated|page\s*\d+\s*(?:of|\/)\s*\d+|statement of account|statement summary|www\.|customer care|toll free|generated on|end of statement|closing balance|opening balance|total)\b/i;

const CREDIT_WORDS =
  /\b(?:cr|credit|deposit|salary|refund|reversal|interest paid|int\.?pd|cashback|received|neft cr|by transfer|by clg)\b/i;

export interface PdfTextOptions {
  /** `YYYY-MM-DD`, for two-digit years. */
  readonly today?: string;
  /** Overrides the "Opening Balance" the text itself may carry. Signed minor units. */
  readonly openingBalance?: string | null;
}

export interface PdfTextResult {
  readonly rows: StatementRow[];
  readonly openingBalance: string | null;
  readonly balanceChecked: number;
  readonly balanceFailed: number;
  /** Lines that started with a date but could not be read as a transaction. */
  readonly unreadable: number;
}

function toMinor(text: string): { value: bigint; credit: boolean | null } | null {
  const trimmed = text.trim();
  const mark = /(cr|dr)\.?$/i.exec(trimmed)?.[1]?.toLowerCase() ?? null;
  const parsed = parseLooseAmount(trimmed.replace(/\s?(?:cr|dr)\.?$/i, ''), 'INR', 'dot');
  if (!parsed.ok) return null;
  const value = parsed.minor < 0n ? -parsed.minor : parsed.minor;
  return { value, credit: mark === null ? null : mark === 'cr' };
}

interface Raw {
  dateText: string;
  narration: string;
  amount: bigint;
  /** Signed. */
  balance: bigint | null;
  /** Explicit "Cr"/"Dr" on the amount, if any. */
  marked: boolean | null;
}

/** Peel `[amount] [balance]` (and a value date before them) off the end of a line. */
function peelTail(rest: string): { text: string; amounts: string[] } | null {
  let text = rest.trimEnd();
  const amounts: string[] = [];
  for (let n = 0; n < 3; n += 1) {
    const match = TRAILING_AMOUNT.exec(` ${text}`);
    if (!match) break;
    amounts.unshift(match[1]!);
    text = text.slice(0, text.length - match[0].length + 1).trimEnd();
  }
  if (amounts.length === 0) return null;
  // The value date column sits between the narration and the amounts.
  const valueDate = TRAILING_DATE.exec(` ${text}`);
  if (valueDate) text = text.slice(0, text.length - valueDate[0].length + 1).trimEnd();
  // A lone "-" left where an empty debit or credit column was.
  text = text.replace(/\s-\s*$/, '');
  return { text, amounts };
}

export function parseStatementText(
  pages: readonly string[],
  options: PdfTextOptions = {},
): PdfTextResult {
  const lines = pages.flatMap((page) => page.split(/\r?\n/));
  const raws: Raw[] = [];
  let unreadable = 0;
  let openingText: string | null = null;

  for (const line of lines) {
    const opening = /opening balance\D{0,12}(-?[\d,]+\.\d{2})/i.exec(line);
    if (opening && openingText === null) openingText = opening[1]!;

    const lead = LEADING_DATE.exec(line);
    if (!lead) {
      // A wrapped narration: more words for the row above.
      const previous = raws[raws.length - 1];
      const text = line.trim();
      if (previous && text !== '' && !FURNITURE.test(text) && !TRAILING_AMOUNT.test(` ${text}`)) {
        previous.narration = `${previous.narration} ${text}`.replace(/\s+/g, ' ');
      }
      continue;
    }
    let rest = line.slice(lead[0].length);
    // SBI prints the value date straight after the transaction date.
    const second = LEADING_DATE.exec(rest);
    if (second) rest = rest.slice(second[0].length);

    const tail = peelTail(rest);
    if (!tail) {
      unreadable += 1;
      continue;
    }
    const nums = tail.amounts.map(toMinor);
    if (nums.some((n) => n === null)) {
      unreadable += 1;
      continue;
    }
    const read = nums as { value: bigint; credit: boolean | null }[];
    // [amount, balance] normally; with a lone amount there is no balance to check against.
    const amount = read.length >= 2 ? read[read.length - 2]! : read[0]!;
    const balanceCell = read.length >= 2 ? read[read.length - 1]! : null;
    let balance: bigint | null = null;
    if (balanceCell) {
      const overdrawn = balanceCell.credit === false;
      balance = overdrawn ? -balanceCell.value : balanceCell.value;
    }
    raws.push({
      dateText: lead[1]!,
      narration: tail.text.replace(/\s+/g, ' ').trim(),
      amount: amount.value,
      balance,
      marked: read.length >= 2 ? null : amount.credit,
    });
  }

  const resolved = resolveDates(
    raws.map((r) => r.dateText),
    { order: 'dmy', today: options.today },
  );

  const openingBalance =
    options.openingBalance !== undefined
      ? options.openingBalance
      : openingText !== null
        ? (() => {
            const parsed = parseLooseAmount(openingText, 'INR', 'dot');
            return parsed.ok ? parsed.minor.toString() : null;
          })()
        : null;

  // Which way the file runs, from its dates: statements are oldest first, except when they are not.
  const dated = resolved.cells.flatMap((c) => (c.iso ? [c.iso] : []));
  const newestFirst = dated.length >= 2 && dated[0]! > dated[dated.length - 1]!;

  const rows: StatementRow[] = raws.map((raw, i) => {
    const before = newestFirst ? raws[i + 1] : raws[i - 1];
    const startBalance: bigint | null = before
      ? before.balance
      : openingBalance !== null
        ? BigInt(openingBalance)
        : null;

    let direction: 'debit' | 'credit';
    let confidence = 0.9;
    if (raw.balance !== null && startBalance !== null) {
      const delta = raw.balance - startBalance;
      if (delta === raw.amount) direction = 'credit';
      else if (delta === -raw.amount) direction = 'debit';
      else {
        direction = CREDIT_WORDS.test(raw.narration) ? 'credit' : 'debit';
        confidence = 0.4;
      }
    } else if (raw.marked !== null) {
      direction = raw.marked ? 'credit' : 'debit';
      confidence = 0.8;
    } else {
      // Nothing to work the direction out from: the narration's wording is a guess.
      direction = CREDIT_WORDS.test(raw.narration) ? 'credit' : 'debit';
      confidence = 0.55;
    }

    return {
      index: i,
      date: resolved.cells[i]?.iso ?? null,
      description: raw.narration === '' ? 'Transaction' : raw.narration,
      amount: raw.amount.toString(),
      direction,
      ref: referenceFor(null, raw.narration),
      balance: raw.balance === null ? null : raw.balance.toString(),
      confidence,
      warnings: [
        ...(resolved.cells[i]?.iso ? [] : (['bad_date'] as const)),
        ...(confidence < 0.6 ? (['low_confidence'] as const) : []),
        ...(raw.amount === 0n ? (['zero_amount'] as const) : []),
      ],
    };
  });

  const checked = applyBalanceCheck(rows, { openingBalance });
  return {
    rows: checked.rows,
    openingBalance,
    balanceChecked: checked.checked,
    balanceFailed: checked.failed,
    unreadable,
  };
}
