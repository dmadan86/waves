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
 * Real layouts stray from "date, narration, amount, balance" in a few ways,
 * each handled here from a sample of the bank's own output:
 *
 *   - ICICI leads with a serial number and prints the remarks after the amounts;
 *   - Axis prints a branch code after the balance;
 *   - SBI, ANZ and the US banks print dates without a year: the year sits on the
 *     next line, on a line of its own, or only in the statement period;
 *   - US statements write a withdrawal as `- 46.32` under a section heading and
 *     carry no running balance; a card payment is `(100.00)`;
 *   - a narration can wrap so that its amount lands on the line below;
 *   - section headings, daily-balance summaries and totals are not rows.
 *
 * Scanned pages have no text layer and go to the model as images instead.
 */

import { parseLooseAmount } from '../import/amount';
import { resolveDates, type ImportDateOrder } from '../import/date';
import { applyBalanceCheck } from './balance';
import { referenceFor } from './narration';
import type { StatementRow } from './types';

const MONTH_NAME =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
/** A date that names its year: `01/10/26`, `1 Oct 2026`, `October 1, 2026`, `2026-10-01`. */
const DATE_SRC =
  `(?:\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2,4}|\\d{1,2}[-/. ]${MONTH_NAME}[-/. ,]+\\d{2,4}(?!\\s*${MONTH_NAME})|` +
  `${MONTH_NAME}\\s+\\d{1,2},?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2})`;
/** A date without one: `12/31`, `05 AUG`. Read only when the statement says which year. */
const YEARLESS_SRC = `(?:\\d{1,2}[-/]\\d{1,2}|\\d{1,2}[-/. ]${MONTH_NAME}(?![a-z]))`;
const LEADING_DATE = new RegExp(`^\\s*(${DATE_SRC})(?![\\d])`, 'i');
const LEADING_YEARLESS = new RegExp(`^\\s*(${YEARLESS_SRC})(?![\\d/.-])`, 'i');
const TRAILING_DATE = new RegExp(`\\s(${DATE_SRC})\\s*$`, 'i');
const ANY_DATE = new RegExp(DATE_SRC, 'gi');
/** ICICI's `S No.` column: a short integer before the date. */
const SERIAL = /^\s*\d{1,5}\s+(?=\S)/;
/** `December 16, 2025 - January 15, 2026`: a period line, not a row dated December 16. */
const PERIOD_TAIL = new RegExp(`^\\s*(?:-|–|—|to|through|thru|till|until)\\s+${DATE_SRC}`, 'i');

/** `1,234.50`, `-46.32`, `(100.00)`, `$2,500.00`, `347.00 Dr`. The sign, if any, is attached. */
const AMOUNT_SRC =
  '[-+]?\\(?[$£€₹]?(?:\\d{1,3}(?:,\\d{2,3})+|\\d+)\\.\\d{2}\\)?(?:\\s?(?:cr|dr)\\.?)?';
const TRAILING_AMOUNT = new RegExp(`\\s(${AMOUNT_SRC})\\s*$`, 'i');
const LEADING_AMOUNT = new RegExp(`^\\s*(${AMOUNT_SRC})(?=\\s|$)`, 'i');
/** A lone dash: an empty column, or (before a sole amount) a spaced minus. */
const TRAILING_DASH = /\s([-–—])\s*$/;
/** Axis prints its branch code after the balance: `20000.00 29249.73 3693`. */
const TRAILING_CODE = /\s\d{1,6}\s*$/;
/** `07/01 1,500.00 07/09 3,768.68 07/20 3,593.68`: a daily balance summary, not transactions. */
const DATE_AMOUNT_PAIRS = new RegExp(
  `^\\s*(?:(?:${DATE_SRC}|${YEARLESS_SRC})\\s+${AMOUNT_SRC}\\s*){2,}$`,
  'i',
);
const YEAR_LINE = /^\s*((?:19|20)\d{2})\s*$/;
/** SBI prints the year of a row's two dates on the line below: `2021 2021 412345678901 UPI REF-`. */
const YEAR_PREFIX = /^\s*((?:19|20)\d{2})(?:\s+(?:19|20)\d{2})*(?:\s+([\s\S]*))?$/;

const FURNITURE =
  /\b(?:registered office|gstin|computer generated|page\s*(?:no[\s.:]{0,32})?\d+|statement of account|statement summary|account summary|transaction overview|www\.|https?:|customer care|toll free|generated on|end of statement|closing balance|opening balance|beginning balance|ending balance|brought forward|carried forward|totals?|sub\s?total|all dates are|please do not share|contents of this statement|does not require|legends? used)\b/i;
/** `Account No : 5010…`, `Page No .: 1`: a labelled field, never part of a narration. */
const LABEL = /^[^:\n]{1,48}:(?:\s|$)/;
/** The table's own header, repeated on every page. */
const HEADER_LINE =
  /^(?:date|txn date|tran date|transaction date|posting date|s\.? ?no\.?|sl\.? ?no\.?|sr\.? ?no\.?)\b/i;
/** A dated line that states a balance rather than a transaction. */
const BALANCE_ROW =
  /^\s*(?:#+\s*)?(?:(?:opening|beginning|closing|ending) bal(?:ance)?\b|(?:balance )?(?:b\/f|c\/f|brought forward|carried forward)\b)/i;
const OPENING =
  /(?:(?:opening|beginning) balance|balance (?:brought |b\/)forward|\bb\/f\b)(?:\s*(?:on|as of|as on|at|for)\s+\S+)?\D{0,12}(-?[\d,]+\.\d{2})/i;

/** US statements group rows under a heading that says which way they go. */
const CREDIT_SECTION =
  /^\s*(?:deposits(?: and other (?:additions|credits))?|deposits and additions|other credits|credits|additions)\s*$/i;
const DEBIT_SECTION =
  /^\s*(?:withdrawals(?: and other (?:subtractions|debits))?|checks(?: paid)?|service fees|fees|other debits|debits|subtractions|electronic (?:withdrawals|payments|debits)|atm (?:and|&) debit card (?:withdrawals|subtractions)|purchases and adjustments|card withdrawals|bank debits)\s*$/i;
const BALANCE_SECTION =
  /^\s*(?:daily (?:ledger )?balances?(?: summary)?|daily ending balances?|balance summary)\s*$/i;

const CREDIT_WORDS =
  /\b(?:cr|credit|deposit|salary|refund|reversal|interest paid|int\.?pd|cashback|received|neft cr|by transfer|by clg)\b|^by\b/i;

type Section = 'credit' | 'debit' | 'balances';

export interface PdfTextOptions {
  /** `YYYY-MM-DD`, for two-digit years. */
  readonly today?: string;
  /** Overrides the "Opening Balance" the text itself may carry. Signed minor units. */
  readonly openingBalance?: string | null;
  /** Day/month order of the statement's dates. Defaults to day-first; a US statement passes `mdy`. */
  readonly order?: 'dmy' | 'mdy';
}

export interface PdfTextResult {
  readonly rows: StatementRow[];
  readonly openingBalance: string | null;
  readonly balanceChecked: number;
  readonly balanceFailed: number;
  /** Lines that started with a date but could not be read as a transaction. */
  readonly unreadable: number;
}

interface Minor {
  /** Unsigned. */
  readonly value: bigint;
  /** An explicit `-` or parentheses. */
  readonly negative: boolean;
  /** An explicit `+`. */
  readonly positive: boolean;
  /** A `Cr` / `Dr` suffix. */
  readonly mark: 'cr' | 'dr' | null;
}

function toMinor(text: string): Minor | null {
  const trimmed = text.trim();
  const mark = /(cr|dr)\.?$/i.exec(trimmed)?.[1]?.toLowerCase() ?? null;
  const bare = trimmed.replace(/\s?(?:cr|dr)\.?$/i, '');
  const parsed = parseLooseAmount(bare, 'INR', 'dot');
  if (!parsed.ok) return null;
  const negative = parsed.minor < 0n;
  return {
    value: negative ? -parsed.minor : parsed.minor,
    negative,
    positive: !negative && /^\+/.test(bare),
    mark: mark === 'cr' || mark === 'dr' ? mark : null,
  };
}

interface Peeled {
  readonly text: string;
  readonly amounts: string[];
  /** The sole amount was written `- 46.32`: a minus, a space, the figure. */
  readonly spacedMinus: boolean;
}

/** Peel `[amount] [balance]` (and a value date before them) off the end of a line. */
function peelTail(rest: string): Peeled | null {
  let text = rest.trimEnd();
  // A bare integer after the balance is Axis's branch code, not a figure.
  const code = TRAILING_CODE.exec(text);
  if (code) {
    const before = text.slice(0, text.length - code[0].length);
    if (TRAILING_AMOUNT.test(` ${before}`)) text = before.trimEnd();
  }
  const tokens: string[] = [];
  let found = 0;
  while (tokens.length < 5 && found < 3) {
    const amount = TRAILING_AMOUNT.exec(` ${text}`);
    if (amount) {
      tokens.unshift(amount[1]!);
      found += 1;
      text = text.slice(0, text.length - amount[0].length + 1).trimEnd();
      continue;
    }
    const dash = found > 0 ? TRAILING_DASH.exec(` ${text}`) : null;
    if (dash) {
      tokens.unshift('-');
      text = text.slice(0, text.length - dash[0].length + 1).trimEnd();
      continue;
    }
    break;
  }
  if (found === 0) return null;
  const amounts = tokens.filter((t) => t !== '-');
  // One figure with a lone dash before it is a negative amount; dashes among
  // several figures are the empty debit or credit columns.
  const spacedMinus = amounts.length === 1 && tokens[tokens.indexOf(amounts[0]!) - 1] === '-';
  // The value date column sits between the narration and the amounts.
  const valueDate = TRAILING_DATE.exec(` ${text}`);
  if (valueDate) text = text.slice(0, text.length - valueDate[0].length + 1).trimEnd();
  // A lone "-" left where an empty debit or credit column was.
  text = text.replace(/\s[-–—]\s*$/, '');
  return { text, amounts, spacedMinus };
}

/** ICICI: `199.00 40718.24 BIL/NUCL/…`, the figures first and the remarks after. */
function peelHead(rest: string): Peeled | null {
  let text = rest.trimStart();
  const amounts: string[] = [];
  while (amounts.length < 3) {
    const match = LEADING_AMOUNT.exec(text);
    if (!match) break;
    amounts.push(match[1]!);
    text = text.slice(match[0].length).trimStart();
  }
  if (amounts.length === 0) return null;
  return { text, amounts, spacedMinus: false };
}

interface Dated {
  readonly dateText: string;
  readonly yearless: boolean;
  readonly serial: boolean;
  readonly rest: string;
}

function readDated(line: string, yearless: boolean): Dated | null {
  const at = (text: string, serial: boolean): Dated | null => {
    const full = LEADING_DATE.exec(text);
    if (full) {
      const rest = text.slice(full[0].length);
      if (PERIOD_TAIL.test(rest)) return null;
      return { dateText: full[1]!, yearless: false, serial, rest };
    }
    const bare = yearless ? LEADING_YEARLESS.exec(text) : null;
    if (bare)
      return { dateText: bare[1]!, yearless: true, serial, rest: text.slice(bare[0].length) };
    return null;
  };
  const direct = at(line, false);
  if (direct) return direct;
  const serial = SERIAL.exec(line);
  return serial ? at(line.slice(serial[0].length), true) : null;
}

const MONTH_INDEX: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** Month and day of a yearless date, read in the statement's order. */
function yearlessParts(
  text: string,
  order: ImportDateOrder,
): { month: number; day: number } | null {
  const numeric = /^(\d{1,2})[-/](\d{1,2})$/.exec(text);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    return order === 'mdy' ? { month: a, day: b } : { month: b, day: a };
  }
  const named = /^(\d{1,2})[-/. ]([a-z]{3})/i.exec(text);
  const month = named ? MONTH_INDEX[named[2]!.toLowerCase()] : undefined;
  return named && month ? { month, day: Number(named[1]) } : null;
}

interface Period {
  readonly from: { year: number; month: number; day: number };
  readonly to: { year: number; month: number; day: number };
}

const isoParts = (iso: string) => ({
  year: Number(iso.slice(0, 4)),
  month: Number(iso.slice(5, 7)),
  day: Number(iso.slice(8, 10)),
});

/** The statement period, from a "from … to …" line or a line that is two dates and nothing else. */
function findPeriod(
  lines: readonly string[],
  order: ImportDateOrder,
  today?: string,
): Period | null {
  let fallback: [string, string] | null = null;
  for (const line of lines) {
    const dates = line.match(ANY_DATE);
    if (!dates || dates.length < 2) continue;
    if (/\b(?:period|from|statement)\b/i.test(line)) {
      const parsed = resolveDates([dates[0]!, dates[1]!], { order, today });
      const [from, to] = [parsed.cells[0]?.iso, parsed.cells[1]?.iso];
      if (from && to && from <= to) return { from: isoParts(from), to: isoParts(to) };
    } else if (fallback === null && dates.length === 2) {
      const remainder = line.replace(ANY_DATE, ' ');
      if (/^(?:\s|-|–|—|to|through|thru|till|until|:)*$/i.test(remainder)) {
        fallback = [dates[0]!, dates[1]!];
      }
    }
  }
  if (!fallback) return null;
  const parsed = resolveDates(fallback, { order, today });
  const [from, to] = [parsed.cells[0]?.iso, parsed.cells[1]?.iso];
  return from && to && from <= to ? { from: isoParts(from), to: isoParts(to) } : null;
}

/** The year a yearless date falls in: the period's start year unless the date is before its start. */
function yearWithin(period: Period, month: number, day: number): number {
  const before =
    month < period.from.month || (month === period.from.month && day < period.from.day);
  return before ? period.to.year : period.from.year;
}

const isStopper = (text: string): boolean =>
  FURNITURE.test(text) ||
  LABEL.test(text) ||
  HEADER_LINE.test(text) ||
  CREDIT_SECTION.test(text) ||
  DEBIT_SECTION.test(text) ||
  BALANCE_SECTION.test(text) ||
  /^\*/.test(text) ||
  text.split(/\s+/).length >= 10;

interface Raw {
  /** The date as printed, or `YYYY-MM-DD` once a yearless date has its year. */
  dateText: string;
  yearless: { month: number; day: number; yearHint: number | null } | null;
  /** The year the next line gave this row (SBI). */
  year: number | null;
  narration: string;
  amount: bigint;
  /** An explicit sign on the amount. */
  sign: 'neg' | 'pos' | null;
  /** Explicit "Cr"/"Dr" on the amount, if any. */
  marked: boolean | null;
  /** Signed. */
  balance: bigint | null;
  /** The heading this row sat under, when there was one. */
  section: 'credit' | 'debit' | null;
}

interface Pending {
  readonly dated: Dated;
  narration: string;
  readonly yearHint: number | null;
}

export function parseStatementText(
  pages: readonly string[],
  options: PdfTextOptions = {},
): PdfTextResult {
  const order: ImportDateOrder = options.order ?? 'dmy';
  const lines = pages.flatMap((page) => page.split(/\r?\n/));

  // Which kind of statement is this: one that dates its rows in full, or one
  // whose rows carry no year? The latter is only read when the year is stated
  // somewhere: a period line, a year on a line of its own, or the next line.
  let fullDated = 0;
  let yearlessDated = 0;
  for (const line of lines) {
    if (
      LEADING_DATE.test(line) ||
      (SERIAL.test(line) && LEADING_DATE.test(line.replace(SERIAL, '')))
    ) {
      fullDated += 1;
    } else if (LEADING_YEARLESS.test(line) && TRAILING_AMOUNT.test(line)) yearlessDated += 1;
  }
  const period = findPeriod(lines, order, options.today);
  const hasYearLine = lines.some((line) => YEAR_LINE.test(line));
  const yearless =
    yearlessDated > 0 && yearlessDated >= fullDated && (period !== null || hasYearLine);

  const raws: Raw[] = [];
  let unreadable = 0;
  let openingText: string | null = null;
  let pending: Pending | null = null;
  let stopped = false;
  let section: Section | null = null;
  let currentYear: number | null = null;

  const complete = (
    dated: Dated,
    narration: string,
    peeled: Peeled,
    yearHint: number | null,
  ): boolean => {
    const nums = peeled.amounts.map(toMinor);
    if (nums.some((n) => n === null)) return false;
    const read = nums as Minor[];
    // [amount, balance] normally; with a lone amount there is no balance to check against.
    const amount = read.length >= 2 ? read[read.length - 2]! : read[0]!;
    const balanceCell = read.length >= 2 ? read[read.length - 1]! : null;
    const balance =
      balanceCell === null
        ? null
        : balanceCell.negative || balanceCell.mark === 'dr'
          ? -balanceCell.value
          : balanceCell.value;
    const parts = dated.yearless ? yearlessParts(dated.dateText, order) : null;
    if (dated.yearless && !parts) return false;
    raws.push({
      dateText: dated.dateText,
      yearless: parts ? { ...parts, yearHint } : null,
      year: null,
      narration: narration.replace(/\s+/g, ' ').trim(),
      amount: amount.value,
      sign: amount.negative || peeled.spacedMinus ? 'neg' : amount.positive ? 'pos' : null,
      marked: amount.mark === null ? null : amount.mark === 'cr',
      balance,
      section: section === 'balances' ? null : section,
    });
    return true;
  };

  for (const line of lines) {
    const text = line.trim();
    if (text === '') continue;

    const opening = OPENING.exec(text);
    if (opening && openingText === null) openingText = opening[1]!;

    const dated = readDated(line, yearless);
    if (!dated) {
      if (yearless) {
        const yearLine = YEAR_LINE.exec(text);
        if (yearLine) {
          currentYear = Number(yearLine[1]);
          continue;
        }
        const previous = raws[raws.length - 1];
        const prefix = YEAR_PREFIX.exec(text);
        if (prefix && previous && previous.yearless && previous.year === null && !pending) {
          previous.year = Number(prefix[1]);
          const more = (prefix[2] ?? '').trim();
          if (more !== '') previous.narration = `${previous.narration} ${more}`.trim();
          continue;
        }
      }
      if (CREDIT_SECTION.test(text)) section = 'credit';
      else if (DEBIT_SECTION.test(text)) section = 'debit';
      else if (BALANCE_SECTION.test(text)) section = 'balances';

      if (pending) {
        // The row above had no figures: they may be here, after the rest of its narration.
        if (isStopper(text)) {
          unreadable += 1;
          pending = null;
          stopped = true;
          continue;
        }
        const peeled = peelTail(text);
        if (peeled) {
          const narration = `${pending.narration} ${peeled.text}`;
          if (!complete(pending.dated, narration, peeled, pending.yearHint)) unreadable += 1;
          pending = null;
        } else {
          pending.narration = `${pending.narration} ${text}`;
        }
        continue;
      }
      if (isStopper(text)) {
        stopped = true;
        continue;
      }
      // A wrapped narration: more words for the row above.
      const previous = raws[raws.length - 1];
      if (previous && !stopped && !TRAILING_AMOUNT.test(` ${text}`)) {
        previous.narration = `${previous.narration} ${text}`.replace(/\s+/g, ' ');
      }
      continue;
    }

    if (pending) {
      unreadable += 1;
      pending = null;
    }
    stopped = false;
    // A daily balance summary, or a balance line: not a transaction.
    if (section === 'balances' || DATE_AMOUNT_PAIRS.test(line)) continue;
    if (BALANCE_ROW.test(dated.rest)) continue;

    let rest = dated.rest;
    // SBI prints the value date straight after the transaction date.
    const second = readDated(rest, yearless);
    if (second && !second.serial) rest = second.rest;

    const peeled = dated.serial ? (peelHead(rest) ?? peelTail(rest)) : peelTail(rest);
    const yearHint = currentYear;
    if (!peeled) {
      pending = { dated, narration: rest.trim(), yearHint };
      continue;
    }
    if (!complete(dated, peeled.text, peeled, yearHint)) unreadable += 1;
  }
  if (pending) unreadable += 1;

  // Yearless dates get their year: from the next line, a year line, or the period.
  for (const raw of raws) {
    if (!raw.yearless) continue;
    const year =
      raw.year ??
      raw.yearless.yearHint ??
      (period ? yearWithin(period, raw.yearless.month, raw.yearless.day) : null);
    raw.dateText =
      year === null
        ? ''
        : `${year}-${String(raw.yearless.month).padStart(2, '0')}-${String(raw.yearless.day).padStart(2, '0')}`;
  }

  const resolved = resolveDates(
    raws.map((r) => r.dateText),
    { order, today: options.today },
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

    // What the row itself says about its direction, when the balance cannot settle it.
    const hint: { direction: 'debit' | 'credit'; confidence: number } | null =
      raw.marked !== null
        ? { direction: raw.marked ? 'credit' : 'debit', confidence: 0.8 }
        : raw.sign !== null
          ? { direction: raw.sign === 'neg' ? 'debit' : 'credit', confidence: 0.8 }
          : raw.section !== null
            ? { direction: raw.section, confidence: 0.75 }
            : null;
    const guess: 'debit' | 'credit' = CREDIT_WORDS.test(raw.narration) ? 'credit' : 'debit';

    let direction: 'debit' | 'credit';
    let confidence = 0.9;
    if (raw.balance !== null && startBalance !== null) {
      const delta = raw.balance - startBalance;
      if (delta === raw.amount) direction = 'credit';
      else if (delta === -raw.amount) direction = 'debit';
      else {
        direction = hint?.direction ?? guess;
        confidence = 0.4;
      }
    } else if (hint) {
      direction = hint.direction;
      confidence = hint.confidence;
    } else {
      // Nothing to work the direction out from: the narration's wording is a guess.
      direction = guess;
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
