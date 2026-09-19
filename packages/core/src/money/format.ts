/**
 * Display formatting. The ONLY place in this package where a Number is
 * produced from an amount, and it never feeds back into arithmetic.
 * TDR §11: all money/date formatting is locale-aware.
 */

import { minorUnitExponent, type CurrencyCode } from './currency';
import { toMajorString, type Money } from './money';

export type Locale = 'en-IN' | 'ta-IN' | 'hi-IN' | (string & {});

export interface FormatOptions {
  locale?: Locale;
  /** Render the sign explicitly (+₹420). Negatives always show their sign. */
  signDisplay?: 'auto' | 'always' | 'never';
}

const DEFAULT_LOCALE: Locale = 'en-IN';

export function format(amount: Money, options: FormatOptions = {}): string {
  return parts(amount, options)
    .map((part) => part.value)
    .join('');
}

/**
 * A formatted amount split at the decimal point.
 *
 * The paise are worth less than the rupees and should not shout as loudly, so
 * the display renders them fainter — but only the locale knows where the split
 * falls. `₹1,517.53`, `$1,517.53` and `1 517,53 €` disagree about the
 * separator and about which side the symbol sits on, and searching the string
 * for a '.' gets two of those three wrong.
 */
export interface MoneyParts {
  /** Sign, symbol and whole units — everything before the decimal separator. */
  readonly lead: string;
  /** The separator and the minor units (`.53`), or `''` when none are shown. */
  readonly fraction: string;
  /** Whatever the locale prints after them, such as a trailing `€`. */
  readonly trail: string;
  /** The three joined — identical to `format()` on the same arguments. */
  readonly text: string;
}

export function formatParts(amount: Money, options: FormatOptions = {}): MoneyParts {
  const lead: string[] = [];
  const fraction: string[] = [];
  const trail: string[] = [];

  // Everything from the decimal separator onwards is the fraction, until
  // something that is plainly not part of the number turns up again.
  let seen: 'lead' | 'fraction' | 'trail' = 'lead';
  for (const part of parts(amount, options)) {
    if (part.type === 'decimal') seen = 'fraction';
    else if (seen === 'fraction' && part.type !== 'fraction') seen = 'trail';

    (seen === 'lead' ? lead : seen === 'fraction' ? fraction : trail).push(part.value);
  }

  const joined = [lead.join(''), fraction.join(''), trail.join('')] as const;
  return { lead: joined[0], fraction: joined[1], trail: joined[2], text: joined.join('') };
}

function parts(amount: Money, options: FormatOptions): Intl.NumberFormatPart[] {
  const { locale = DEFAULT_LOCALE, signDisplay = 'auto' } = options;
  // Always the currency's own number of minor digits, whole amount or not.
  // There used to be an option to drop `.00`, and in a list it misreads: a
  // column of ₹24,182.42 and ₹80,100 invites the eye to line up 80,100 with
  // 24,182 and lose a digit, and the faint-fraction styling makes the short
  // one look truncated rather than round. A currency with no minor unit (JPY)
  // is unaffected — its exponent is already 0.
  const fractionDigits = minorUnitExponent(amount.currency);

  const magnitude = signDisplay === 'never' && amount.minor < 0n ? -amount.minor : amount.minor;

  // Number() is safe here: a value large enough to lose precision (>9e15 minor
  // units ≈ ₹90 trillion) is not a real split, and display is not arithmetic.
  const asNumber = Number(toMajorString({ minor: magnitude, currency: amount.currency }));

  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: amount.currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    signDisplay: signDisplay === 'never' ? 'auto' : signDisplay,
  });
  return numberParts(formatter, asNumber, fractionDigits);
}

/**
 * The digits a locale might print. Latin, plus the native digits of the
 * scripts Waves ships (Devanagari, Tamil) and the Arabic ones, in case a locale
 * defaults to them — a fraction is found by its digits, so all of them count.
 */
const DIGITS = '0-9\\u0660-\\u0669\\u06f0-\\u06f9\\u0966-\\u096f\\u0be6-\\u0bef';

/**
 * `formatToParts`, or the same parts rebuilt from `format` where the engine
 * has no `formatToParts`.
 *
 * Hermes on Apple platforms implements `Intl.NumberFormat` over Foundation and
 * gives it `format` but not `formatToParts` — only `DateTimeFormat` has one
 * there. Android's Hermes and Node both have it, so every test passed and the
 * Android app worked, while on iOS every amount on screen threw `undefined is
 * not a function` and the home screen was an error page. The first iOS build
 * that ever ran showed it.
 *
 * Everything the callers read is recoverable from the formatted string: the
 * fraction is the last run of digits, exactly `fractionDigits` long, and the
 * character before it is the decimal separator — whichever the locale uses, on
 * whichever side of the symbol. If the string does not have that shape the whole
 * of it is returned as one part, which renders the amount unfaded rather than
 * not at all.
 */
function numberParts(
  formatter: Intl.NumberFormat,
  value: number,
  fractionDigits: number,
): Intl.NumberFormatPart[] {
  if (typeof formatter.formatToParts === 'function') return formatter.formatToParts(value);

  const text = formatter.format(value);
  if (fractionDigits > 0) {
    const split = new RegExp(
      `^(.*)([^${DIGITS}])([${DIGITS}]{${fractionDigits}})([^${DIGITS}]*)$`,
    ).exec(text);
    if (split) {
      const [, lead = '', separator = '', fraction = '', trail = ''] = split;
      const rebuilt: Intl.NumberFormatPart[] = [
        { type: 'integer', value: lead },
        { type: 'decimal', value: separator },
        { type: 'fraction', value: fraction },
      ];
      if (trail) rebuilt.push({ type: 'literal', value: trail });
      return rebuilt;
    }
  }
  return [{ type: 'integer', value: text }];
}

/** Just the currency symbol for the locale ("₹", "$"). */
export function currencySymbol(currency: CurrencyCode, locale: Locale = DEFAULT_LOCALE): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  if (typeof formatter.formatToParts === 'function') {
    const parts = formatter.formatToParts(0);
    return parts.find((part) => part.type === 'currency')?.value ?? currency;
  }
  // No parts to ask (Hermes on iOS — see `numberParts`): zero with no decimals
  // is the symbol, the digit and some spacing, so what survives removing the
  // digit, the spacing and any direction marks is the symbol.
  const symbol = formatter
    .format(0)
    .replace(new RegExp(`[${DIGITS}\\s\\u00a0\\u202f\\u200e\\u200f\\u061c]`, 'g'), '');
  return symbol || currency;
}

export enum BalanceDirection {
  OwedToYou = 'owed_to_you',
  YouOwe = 'you_owe',
  Settled = 'settled',
}

export function balanceDirection(minor: bigint): BalanceDirection {
  if (minor > 0n) return BalanceDirection.OwedToYou;
  if (minor < 0n) return BalanceDirection.YouOwe;
  return BalanceDirection.Settled;
}

/**
 * TDR §11 accessibility: money values carry a spoken label, never a bare
 * number. Copy lives in notifications/copy.ts so it stays translatable.
 */
export function moneyAccessibilityLabel(
  amount: Money,
  direction: BalanceDirection,
  strings: { owedToYou: string; youOwe: string; settled: string },
  options: FormatOptions = {},
): string {
  const rendered = format(
    { minor: amount.minor < 0n ? -amount.minor : amount.minor, currency: amount.currency },
    options,
  );
  switch (direction) {
    case BalanceDirection.OwedToYou:
      return strings.owedToYou.replace('{amount}', rendered);
    case BalanceDirection.YouOwe:
      return strings.youOwe.replace('{amount}', rendered);
    case BalanceDirection.Settled:
      return strings.settled;
  }
}
