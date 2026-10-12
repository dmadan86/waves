/**
 * An amount somebody typed into a spreadsheet, as exact minor units.
 *
 * `₹1,23,456.78`, `1.234,56`, `(120.00)`, `Rs. 450`, `٣٥٠٫٥٠`. Read digit by
 * digit, never through a float (ADR-003): a file of somebody's whole history is
 * where a float quietly loses a paisa per row.
 */

import { isCurrencyCode, minorUnitExponent, type CurrencyCode } from '../money/currency';
import { normaliseForParsing } from '../text/digits';

/** Which character is the decimal point in this column. */
export type DecimalStyle = 'dot' | 'comma';

export type LooseAmountFailure = 'empty' | 'unreadable' | 'too_many_decimals';

export type LooseAmount =
  | {
      readonly ok: true;
      /** Signed minor units. */
      readonly minor: bigint;
      /** A currency named in the cell itself (`INR 450`, `₹450`), if unambiguous. */
      readonly currency: CurrencyCode | null;
    }
  | { readonly ok: false; readonly reason: LooseAmountFailure };

/**
 * Symbols that name one currency. `$` and `¥` are deliberately absent: they are
 * a dozen currencies each, and a wrong guess is worse than the group's default.
 */
const SYMBOL_CURRENCY: ReadonlyArray<readonly [RegExp, CurrencyCode | null]> = [
  [/₹/g, 'INR'],
  [/€/g, 'EUR'],
  [/£/g, 'GBP'],
  [/د\.\s*إ/g, 'AED'],
  [/﷼/g, null],
  [/[$¥]/g, null],
  [/\bRs\.?/gi, 'INR'],
];

const NEGATIVE_WORDS = /(?:^|\s)cr\.?$/i;
const POSITIVE_WORDS = /(?:^|\s)dr\.?$/i;

/**
 * Parse one amount cell.
 *
 * Negatives are a leading `-` or U+2212, parentheses, a trailing `-`, or a
 * trailing `CR`. A trailing `DR` (debit) is just the plain, positive amount.
 * A cell holding only a symbol or `-` is `empty`.
 *
 * Digits beyond the currency's minor unit are an error unless they are all
 * zeros (`10.500` is ten rupees fifty paise). Rounding would hide the fact that
 * the figure came from somewhere with a different idea of the currency.
 */
export function parseLooseAmount(
  text: string,
  currency: CurrencyCode,
  decimalStyle: DecimalStyle | 'auto' = 'auto',
): LooseAmount {
  let work = normaliseForParsing(text)
    .replace(/[\s  ']/g, ' ')
    .trim();
  if (work === '') return { ok: false, reason: 'empty' };
  work = work.replace(/[−–—]/g, '-');

  let negative = false;
  if (/^\(.*\)$/.test(work)) {
    negative = true;
    work = work.slice(1, -1).trim();
  }
  if (NEGATIVE_WORDS.test(work)) {
    negative = !negative;
    work = work.replace(NEGATIVE_WORDS, '').trim();
  } else if (POSITIVE_WORDS.test(work)) {
    work = work.replace(POSITIVE_WORDS, '').trim();
  }

  const seen: { code: CurrencyCode | null } = { code: null };
  for (const [pattern, code] of SYMBOL_CURRENCY) {
    work = work.replace(pattern, () => {
      if (code) seen.code ??= code;
      return ' ';
    });
  }
  const named = (whole: string, lead: string, code: string): string => {
    if (!isCurrencyCode(code)) return whole;
    seen.code ??= code;
    return lead;
  };
  work = work.replace(/(^|\s)([A-Z]{3})(?=\s|$|-|\d)/g, named);
  work = work.replace(/(\d)\s*([A-Z]{3})$/, (whole, digit: string, code: string) =>
    named(whole, digit, code),
  );
  work = work.replace(/\s+/g, '').trim();

  if (work.endsWith('-')) {
    negative = !negative;
    work = work.slice(0, -1);
  }
  if (work.startsWith('-')) {
    negative = !negative;
    work = work.slice(1);
  } else if (work.startsWith('+')) {
    work = work.slice(1);
  }
  if (work === '') return { ok: false, reason: 'empty' };
  if (!/^[\d.,]+$/.test(work) || !/\d/.test(work)) return { ok: false, reason: 'unreadable' };

  const split = splitDecimal(work, decimalStyle);
  if (!split) return { ok: false, reason: 'unreadable' };

  const exponent = minorUnitExponent(currency);
  let fraction = split.fraction;
  if (fraction.length > exponent) {
    if (/[1-9]/.test(fraction.slice(exponent))) return { ok: false, reason: 'too_many_decimals' };
    fraction = fraction.slice(0, exponent);
  }
  const minor = BigInt((split.whole || '0') + fraction.padEnd(exponent, '0'));
  return { ok: true, minor: negative ? -minor : minor, currency: seen.code };
}

/** Whole and fractional digits of a cleaned `[\d.,]+` string, or null if it makes no sense. */
function splitDecimal(
  work: string,
  style: DecimalStyle | 'auto',
): { whole: string; fraction: string } | null {
  const lastDot = work.lastIndexOf('.');
  const lastComma = work.lastIndexOf(',');
  let decimalAt = -1;

  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: whichever comes last is the point, the other groups.
    decimalAt = Math.max(lastDot, lastComma);
    const point = work[decimalAt];
    if (work.split(point!).length > 2) return null;
  } else if (lastDot >= 0 || lastComma >= 0) {
    const at = Math.max(lastDot, lastComma);
    const char = work[at]!;
    const count = work.split(char).length - 1;
    const after = work.length - at - 1;
    if (count === 1) {
      const wants = char === '.' ? 'dot' : 'comma';
      if (style === wants) decimalAt = at;
      else if (style === 'auto') {
        // A lone comma before exactly three digits is a thousands separator
        // (`1,234`); before one or two it is a decimal (`12,5`).
        decimalAt = char === ',' && after === 3 ? -1 : at;
      }
    }
  }

  const strip = (value: string): string => value.replace(/[.,]/g, '');
  if (decimalAt < 0) return { whole: strip(work), fraction: '' };
  const whole = strip(work.slice(0, decimalAt));
  const fraction = work.slice(decimalAt + 1);
  if (/[.,]/.test(fraction)) return null;
  return { whole, fraction };
}

/**
 * The decimal style of a whole column, judged from every value in it.
 *
 * Decided by the cells that can only be read one way (`1.234,56`, `12,5`,
 * `3.50`). When nothing settles it (every cell looks like `1,234`), the result
 * is `dot` with `ambiguous: true`, so a screen can ask.
 */
export function detectDecimalStyle(values: readonly string[]): {
  style: DecimalStyle;
  ambiguous: boolean;
} {
  let dot = 0;
  let comma = 0;
  for (const raw of values) {
    const cleaned = normaliseForParsing(raw).replace(/[^\d.,]/g, '');
    const lastDot = cleaned.lastIndexOf('.');
    const lastComma = cleaned.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      if (lastDot > lastComma) dot += 1;
      else comma += 1;
    } else if (lastComma >= 0) {
      const after = cleaned.length - lastComma - 1;
      if (cleaned.split(',').length === 2 && (after === 1 || after === 2)) comma += 1;
    } else if (lastDot >= 0) {
      const after = cleaned.length - lastDot - 1;
      if (cleaned.split('.').length === 2 && after !== 3) dot += 1;
      else if (cleaned.split('.').length > 2) comma += 1;
    }
  }
  if (dot === 0 && comma === 0)
    return { style: 'dot', ambiguous: values.some((v) => /[.,]\d{3}\b/.test(v)) };
  if (comma > dot) return { style: 'comma', ambiguous: dot > 0 };
  return { style: 'dot', ambiguous: comma > 0 };
}
