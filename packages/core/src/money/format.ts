/**
 * Display formatting. The ONLY place in this package where a Number is
 * produced from an amount, and it never feeds back into arithmetic.
 * TDR §11: all money/date formatting is locale-aware.
 */

import { minorUnitExponent, type CurrencyCode } from './currency';
import { toMajorString, type Money } from './money';

export type Locale = 'en-US' | 'en-IN' | 'ta-IN' | 'hi-IN' | (string & {});

export interface FormatOptions {
  locale?: Locale;
  /** Render the sign explicitly (+₹420). Negatives always show their sign. */
  signDisplay?: 'auto' | 'always' | 'never';
  /** Round to whole units (₹2,09,256), for a single headline total — never a list column. */
  whole?: boolean;
  /**
   * Drop a bare ".00" (exactly zero minor units) from the DISPLAY of an amount:
   * ₹750, but ₹45,025.69 keeps its paise. Off by default so exports, receipts and
   * settlement confirmations stay exact; the display components turn it on.
   */
  trimZeros?: boolean;
}

// Neutral until the app injects the device locale once at startup; never India.
let defaultLocale: Locale | (() => Locale) = 'en-US';

/** A function is read on every use, so it follows the phone and loads lazily. */
export function setDefaultLocale(locale: Locale | (() => Locale)): void {
  defaultLocale = locale;
}

export function getDefaultLocale(): Locale {
  return typeof defaultLocale === 'function' ? defaultLocale() : defaultLocale;
}

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
  const { locale = getDefaultLocale(), signDisplay = 'auto', whole = false } = options;
  const exponent = minorUnitExponent(amount.currency);
  const fractionDigits =
    whole || (options.trimZeros && amount.minor % 10n ** BigInt(exponent) === 0n) ? 0 : exponent;

  const magnitude = signDisplay === 'never' && amount.minor < 0n ? -amount.minor : amount.minor;

  // Number() is safe here: a value large enough to lose precision (>9e15 minor
  // units ≈ ₹90 trillion) is not a real split, and display is not arithmetic.
  const asNumber = Number(toMajorString({ minor: magnitude, currency: amount.currency }));

  const formatter = currencyFormatter(
    locale,
    amount.currency,
    fractionDigits,
    signDisplay === 'never' ? 'auto' : signDisplay,
  );
  return numberParts(formatter, asNumber, fractionDigits);
}

/**
 * One `Intl.NumberFormat` per (locale, currency, digits, sign) — built once,
 * reused for every amount after.
 *
 * Constructing a formatter resolves the locale's data and is far dearer than
 * formatting with one; a balance list formats hundreds of amounts per render
 * and every one of them used to build its own. A formatter is immutable, so
 * sharing it is safe. The key set is small (the locales and currencies a user
 * actually meets), so the map needs no eviction. A construction that throws
 * (an unknown currency code) is not cached and throws again next time, as
 * before.
 */
const formatters = new Map<string, Intl.NumberFormat>();

/**
 * Rupees read in lakhs (₹2,09,256) whatever region the phone is set to: an
 * en-US or en-GB phone would otherwise print ₹209,256. The language stays the
 * reader's; only the region moves to IN. Arabic keeps its own locale, whose
 * digits an IN region could change.
 */
export function rupeeLocale(locale: Locale, currency: CurrencyCode): Locale {
  if (currency !== 'INR') return locale;
  const language = locale.split(/[-_]/)[0]?.toLowerCase() ?? '';
  return !language || language === 'ar' ? locale : `${language}-IN`;
}

function currencyFormatter(
  locale: Locale,
  currency: CurrencyCode,
  fractionDigits: number,
  signDisplay: 'auto' | 'always',
): Intl.NumberFormat {
  const key = `${locale}|${currency}|${fractionDigits}|${signDisplay}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(rupeeLocale(locale, currency), {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
      signDisplay,
    });
    formatters.set(key, formatter);
  }
  return formatter;
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

/**
 * A short headline figure for tight tiles: ₹3.2L and ₹1.5Cr for rupees (always
 * read in an Indian locale, see `rupeeLocale`), $3.2K and $1.5M elsewhere, from
 * CLDR compact notation. Under a thousand major units it is the plain amount, and
 * where the engine has no compact notation it falls back to `format`. Never for
 * lists or entry rows: it drops digits.
 */
export function compactMoney(amount: Money, options: FormatOptions = {}): string {
  const { locale = getDefaultLocale() } = options;
  const major = Number(toMajorString(amount));
  if (Math.abs(major) < 1000) return format(amount, options);
  const loc = rupeeLocale(locale, amount.currency);
  const signed = options.signDisplay === 'never' ? Math.abs(major) : major;
  const sign = options.signDisplay ?? 'auto';
  try {
    const compact = new Intl.NumberFormat(loc, {
      style: 'currency',
      currency: amount.currency,
      notation: 'compact',
      maximumFractionDigits: 1,
      signDisplay: sign,
    });
    // Some engines (Hermes) accept the option and silently ignore it.
    // Some engines report compact yet still print "1,872.0": a compact 10,000 has two digits.
    const ignored = (compact.format(10000).match(/[0-9]/g)?.length ?? 0) >= 5;
    if (compact.resolvedOptions().notation === 'compact' && !ignored) return compact.format(signed);
  } catch {
    // fall through to the explicit scale below
  }
  const indian = amount.currency === 'INR';
  const scale: readonly (readonly [number, string])[] = indian
    ? [
        [1e7, 'Cr'],
        [1e5, 'L'],
        [1e3, 'K'],
      ]
    : [
        [1e9, 'B'],
        [1e6, 'M'],
        [1e3, 'K'],
      ];
  const [unit, suffix] = scale.find(([size]) => Math.abs(signed) >= size) ?? [1, ''];
  const scaled = new Intl.NumberFormat(loc, {
    style: 'currency',
    currency: amount.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
    signDisplay: sign,
  });
  return scaled.formatToParts
    ? scaled
        .formatToParts(signed / unit)
        .map((p) => p.value)
        .join('') + suffix
    : scaled.format(signed / unit) + suffix;
}

/** Just the currency symbol for the locale ("₹", "$"). */
export function currencySymbol(
  currency: CurrencyCode,
  locale: Locale = getDefaultLocale(),
): string {
  const formatter = currencyFormatter(locale, currency, 0, 'auto');
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
