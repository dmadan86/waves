/**
 * The things a bank message does not say, and somebody has to decide.
 *
 * Three of them are genuinely undecidable from the text alone:
 *
 *   - `08/05/2026` is the 8th of May in Mumbai and the 5th of August in
 *     Chicago, and nothing in the message distinguishes them;
 *   - `EUR 1.234` is one thousand two hundred and thirty-four euros in Berlin
 *     and one euro twenty-three in Dublin;
 *   - `$` is seven different currencies.
 *
 * So this module holds the *hints* a caller can supply — the user's country,
 * their locale, the currency their group counts in — and, for each hint that is
 * missing, one explicit documented fallback. Every fallback is reported back to
 * the parser so the answer can say which parts of it were guessed. A parser
 * that guesses is fine. A parser that guesses silently puts an expense on the
 * wrong day of a trip, or off by a factor of a thousand, and looks certain
 * doing it.
 */

import { currencyForCountry } from '../money/region';
import { isCurrencyCode, type CurrencyCode } from '../money/currency';

/** Day-month-year, as most of the world writes it, or month-day-year. */
export type DateOrder = 'dmy' | 'mdy';

/**
 * What the caller knows that the message does not. Every field is optional and
 * the parser works with none of them — it just marks more of its answer as
 * inferred.
 */
export interface SmsParseContext {
  /** ISO-3166 alpha-2, e.g. `IN`, `DE`, `US`. The strongest single hint. */
  readonly region?: string | null;
  /** BCP-47, e.g. `de-DE` or `pt`. Its region subtag is used when `region` is absent. */
  readonly locale?: string | null;
  /** What to assume when the message names no currency at all. */
  readonly defaultCurrency?: CurrencyCode | null;
  /** Overrides the region's date order outright. */
  readonly dateOrder?: DateOrder | null;
  /** Overrides the region's decimal separator outright. */
  readonly decimalSeparator?: '.' | ',' | null;
  /** Sender id, e.g. `AD-HDFCBK` or `+441234…`. A hint, never a filter. */
  readonly sender?: string | null;
}

/** What the parser had to decide for itself. Surfaced so the UI can flag it. */
export type InferredField = 'currency' | 'decimalSeparator' | 'dateOrder';

/* ------------------------------------------------------------------ *
 * Region
 * ------------------------------------------------------------------ */

export function regionOf(context: SmsParseContext): string | null {
  const direct = (context.region ?? '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(direct)) return direct;
  const fromLocale = /^[A-Za-z]{2,3}[-_]([A-Za-z]{2})\b/.exec((context.locale ?? '').trim());
  return fromLocale?.[1] ? fromLocale[1].toUpperCase() : null;
}

function languageOf(context: SmsParseContext): string | null {
  const tag = (context.locale ?? '').trim().toLowerCase();
  const match = /^([a-z]{2,3})(?:[-_]|$)/.exec(tag);
  return match?.[1] ?? null;
}

/* ------------------------------------------------------------------ *
 * Date order
 * ------------------------------------------------------------------ */

/**
 * The handful of places that write the month first. Everywhere else — including
 * every market Waves ships in — writes the day first, which is why that is the
 * fallback rather than a coin flip.
 */
const MONTH_FIRST = new Set(['US', 'PH', 'FM', 'MH', 'PW']);

export function dateOrderFor(context: SmsParseContext): { order: DateOrder; explicit: boolean } {
  if (context.dateOrder) return { order: context.dateOrder, explicit: true };
  const region = regionOf(context);
  if (region) return { order: MONTH_FIRST.has(region) ? 'mdy' : 'dmy', explicit: true };
  return { order: 'dmy', explicit: false };
}

/* ------------------------------------------------------------------ *
 * Decimal separator
 * ------------------------------------------------------------------ */

/**
 * Where a comma is the decimal point. Switzerland is deliberately absent: it
 * writes `1'234.56`, dot-decimal with an apostrophe for grouping, and putting
 * it in this set would invert every Swiss amount.
 */
const COMMA_DECIMAL_REGIONS = new Set([
  'AL',
  'AO',
  'AR',
  'AT',
  'AZ',
  'BA',
  'BE',
  'BG',
  'BO',
  'BR',
  'BY',
  'CL',
  'CM',
  'CO',
  'CR',
  'CU',
  'CV',
  'CZ',
  'DE',
  'DK',
  'DO',
  'DZ',
  'EC',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'GL',
  'HR',
  'HU',
  'ID',
  'IS',
  'IT',
  'LT',
  'LU',
  'LV',
  'MA',
  'MD',
  'ME',
  'MK',
  'MZ',
  'NL',
  'NO',
  'PL',
  'PT',
  'PY',
  'RO',
  'RS',
  'RU',
  'SE',
  'SI',
  'SK',
  'SN',
  'TN',
  'TR',
  'UA',
  'UY',
  'VE',
  'VN',
]);

/** Languages that are comma-decimal wherever they are spoken, for a bare `de`/`fr` tag. */
const COMMA_DECIMAL_LANGUAGES = new Set([
  'de',
  'fr',
  'pt',
  'it',
  'nl',
  'id',
  'tr',
  'ru',
  'pl',
  'vi',
  'da',
  'sv',
  'nb',
  'no',
  'fi',
  'cs',
  'el',
  'ro',
  'hu',
  'hr',
  'sr',
  'sk',
  'sl',
  'bg',
  'uk',
  'lv',
  'lt',
  'et',
  'is',
  'af',
]);

/**
 * `null` means "nobody told us", which is different from "we know it is a dot".
 * The parser treats the two differently: a known separator settles `1,234`
 * outright, an unknown one falls through to a currency-aware guess that gets
 * reported as one.
 */
export function decimalSeparatorFor(context: SmsParseContext): '.' | ',' | null {
  if (context.decimalSeparator) return context.decimalSeparator;
  const region = regionOf(context);
  if (region) return COMMA_DECIMAL_REGIONS.has(region) ? ',' : '.';
  const language = languageOf(context);
  // Spanish is split down the middle — comma in Spain, dot in Mexico — so a
  // bare `es` says nothing and is left unanswered rather than halved.
  if (language && language !== 'es' && language !== 'en') {
    return COMMA_DECIMAL_LANGUAGES.has(language) ? ',' : '.';
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Currency
 * ------------------------------------------------------------------ */

/**
 * Currencies that share a marker. The symbol says the family; only the reader's
 * country says which member.
 */
const FAMILIES: Readonly<Record<string, { byRegion: Record<string, string>; fallback: string }>> =
  Object.freeze({
    dollar: {
      byRegion: {
        US: 'USD',
        CA: 'CAD',
        AU: 'AUD',
        NZ: 'NZD',
        SG: 'SGD',
        HK: 'HKD',
        TW: 'TWD',
        MX: 'MXN',
        AR: 'ARS',
        CL: 'CLP',
        CO: 'COP',
        BR: 'BRL',
        FJ: 'FJD',
        JM: 'JMD',
      },
      fallback: 'USD',
    },
    rupee: {
      byRegion: { IN: 'INR', LK: 'LKR', NP: 'NPR', PK: 'PKR', MU: 'MUR', SC: 'SCR' },
      fallback: 'INR',
    },
    pound: {
      byRegion: { GB: 'GBP', EG: 'EGP', LB: 'LBP', SD: 'SDG', SS: 'SSP', SY: 'SYP' },
      fallback: 'GBP',
    },
    yen: { byRegion: { JP: 'JPY', CN: 'CNY' }, fallback: 'JPY' },
    krone: { byRegion: { SE: 'SEK', NO: 'NOK', DK: 'DKK', IS: 'ISK', FO: 'DKK' }, fallback: 'SEK' },
    riyal: { byRegion: { SA: 'SAR', QA: 'QAR', OM: 'OMR', YE: 'YER', IR: 'IRR' }, fallback: 'SAR' },
    dirham: { byRegion: { AE: 'AED', MA: 'MAD' }, fallback: 'AED' },
    dinar: {
      byRegion: {
        KW: 'KWD',
        BH: 'BHD',
        JO: 'JOD',
        IQ: 'IQD',
        TN: 'TND',
        DZ: 'DZD',
        LY: 'LYD',
        RS: 'RSD',
      },
      fallback: 'KWD',
    },
  });

/**
 * Marker text to an ISO code, or to the name of a family that needs the region
 * to settle it. Keys are folded: uppercased, with dots and spaces removed.
 */
const MARKERS: Readonly<Record<string, string>> = Object.freeze({
  // Qualified dollars, which are not ambiguous at all.
  US$: 'USD',
  CA$: 'CAD',
  C$: 'CAD',
  A$: 'AUD',
  AU$: 'AUD',
  NZ$: 'NZD',
  S$: 'SGD',
  SG$: 'SGD',
  HK$: 'HKD',
  NT$: 'TWD',
  R$: 'BRL',
  MX$: 'MXN',
  // Families.
  $: 'dollar',
  '₹': 'INR',
  '₨': 'rupee',
  RS: 'rupee',
  '£': 'pound',
  '¥': 'yen',
  KR: 'krone',
  // Unambiguous symbols.
  '€': 'EUR',
  '₩': 'KRW',
  '₫': 'VND',
  '฿': 'THB',
  '₦': 'NGN',
  '₱': 'PHP',
  '₽': 'RUB',
  '₪': 'ILS',
  '₴': 'UAH',
  '₸': 'KZT',
  '₺': 'TRY',
  // Latin abbreviations.
  RP: 'IDR',
  RM: 'MYR',
  DH: 'dirham',
  DHS: 'dirham',
  TL: 'TRY',
  KC: 'CZK',
  ZL: 'PLN',
  РУБ: 'RUB',
  // Arabic abbreviations — the letter pairs Gulf banks actually print.
  'د.إ': 'AED',
  'ر.س': 'SAR',
  'ر.ق': 'QAR',
  'ر.ع': 'OMR',
  'د.ك': 'KWD',
  'د.ب': 'BHD',
  'د.أ': 'JOD',
  'د.ا': 'JOD',
  'د.ت': 'TND',
  'ج.م': 'EGP',
  ريال: 'riyal',
  درهم: 'dirham',
  دينار: 'dinar',
  جنيه: 'EGP',
  // The rupee, spelled out — Hindi and Tamil bank alerts write the word, not
  // the symbol, and a message in Devanagari digits usually carries one too.
  रुपये: 'rupee',
  रुपए: 'rupee',
  रु: 'rupee',
  ரூபாய்: 'rupee',
  ரூ: 'rupee',
  // CJK and South-East Asia.
  円: 'JPY',
  元: 'CNY',
  บาท: 'THB',
  Đ: 'VND',
  VNĐ: 'VND',
});

/**
 * The ISO codes the parser will read as a currency marker. Waves' own
 * `minorUnitExponent` table plus every market `currencyForCountry` names, so
 * "the currencies Waves supports" and "the currencies the SMS reader knows" are
 * the same list rather than two lists that drift.
 */
const ISO_CODES = [
  'AED',
  'ARS',
  'AUD',
  'BDT',
  'BGN',
  'BHD',
  'BRL',
  'CAD',
  'CHF',
  'CLP',
  'CNY',
  'COP',
  'CZK',
  'DKK',
  'DZD',
  'EGP',
  'EUR',
  'FJD',
  'GBP',
  'GHS',
  'HKD',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'IQD',
  'ISK',
  'JMD',
  'JOD',
  'JPY',
  'KES',
  'KRW',
  'KWD',
  'KZT',
  'LBP',
  'LKR',
  'LYD',
  'MAD',
  'MUR',
  'MXN',
  'MYR',
  'NGN',
  'NOK',
  'NPR',
  'NZD',
  'OMR',
  'PEN',
  'PHP',
  'PKR',
  'PLN',
  'PYG',
  'QAR',
  'RON',
  'RSD',
  'RUB',
  'SAR',
  'SCR',
  'SEK',
  'SGD',
  'THB',
  'TND',
  'TRY',
  'TWD',
  'TZS',
  'UAH',
  'UGX',
  'USD',
  'UYU',
  'VND',
  'ZAR',
] as const;

/** The alternation the amount patterns are built from. Longest forms first. */
export const CURRENCY_TOKEN_SOURCE = [
  '(?:US|CA|AU|NZ|SG|HK|NT|MX)\\$',
  '[RCAS]\\$',
  `\\b(?:${ISO_CODES.join('|')})\\b`,
  '\\bRs\\.?',
  '\\bRp\\.?',
  '\\bRM\\b',
  '\\bDhs?\\.?',
  '\\bTL\\b',
  // No trailing `\b` on any of these: JavaScript's word boundary is defined
  // against [A-Za-z0-9_], so there is no boundary after `č`, `ł` or a Cyrillic
  // letter, and asking for one would make the pattern match nothing at all.
  '\\bK[čc]\\.?',
  '\\bz[łl]',
  '\\bkr\\.?',
  'руб\\.?',
  '[₹€£¥₩₫฿₦₱₽₨₪₴₸₺$]',
  'د\\.[إكبأات]',
  'ر\\.[سقع]',
  'ج\\.م',
  '(?:ريال|درهم|دينار|جنيه)',
  '(?:रुपये|रुपए|रु|ரூபாய்|ரூ)',
  '(?:円|元|บาท)',
  'Đ',
].join('|');

const foldMarker = (raw: string): string =>
  raw
    .replace(/[\s]/g, '')
    .replace(/\.$/, '')
    .toUpperCase()
    // Czech and Polish fold through the same path the message body does.
    .replace(/Č/g, 'C')
    .replace(/Ł/g, 'L');

export interface CurrencyReading {
  readonly currency: CurrencyCode;
  /** True when nothing in the message or the context actually settled it. */
  readonly inferred: boolean;
}

/**
 * The currency for a marker found beside the amount, or — when the message
 * named none — the caller's default, the region's currency, and finally INR.
 *
 * INR last is not an accident and not neutrality: it is Waves' home market and
 * the documented last resort. It is always reported as inferred, so a message
 * from a bank that names no currency never claims to be rupees.
 */
export function resolveCurrency(marker: string | null, context: SmsParseContext): CurrencyReading {
  const region = regionOf(context);

  if (marker) {
    const folded = foldMarker(marker);
    const resolved = MARKERS[folded] ?? folded;
    const family = FAMILIES[resolved];
    if (family) {
      const fromRegion = region ? family.byRegion[region] : undefined;
      if (fromRegion) return { currency: fromRegion, inferred: false };
      return { currency: family.fallback, inferred: true };
    }
    // A marker that resolves to neither a family nor an ISO code is a pattern
    // that got ahead of this table; fall through rather than hand `money` a
    // string it will throw on.
    if (isCurrencyCode(resolved)) return { currency: resolved, inferred: false };
  }

  if (context.defaultCurrency) return { currency: context.defaultCurrency, inferred: false };
  const regional = currencyForCountry(region);
  if (regional) return { currency: regional, inferred: false };
  return { currency: 'INR', inferred: true };
}

/* ------------------------------------------------------------------ *
 * Sender
 * ------------------------------------------------------------------ */

/**
 * The registered header inside a sender id, with the carrier's prefix removed.
 *
 * India's DLT regime delivers the same bank as `AD-HDFCBK`, `VM-HDFCBK` or
 * `JD-HDFCBK` depending on the recipient's operator and circle, and since 2025
 * with a message-type suffix as well. Matching the whole string is a bug that
 * looks like "it works on my phone". Nothing here assumes the Indian shape
 * though: a sender with no prefix comes back unchanged, which is what a
 * European or Gulf short code looks like.
 */
export function senderHeader(sender: string | null | undefined): string | null {
  const raw = (sender ?? '').trim();
  if (!raw) return null;
  const withoutOperator = raw.replace(/^[A-Za-z]{2}\d?[-_]/, '');
  const header = withoutOperator.replace(/[-_][A-Za-z]$/, '').toUpperCase();
  return header || null;
}

/**
 * Whether the sender looks like a financial institution.
 *
 * Used only to *raise* confidence, never to drop a message: a bank not on this
 * list is a bank this list has not heard of yet, and a person who pasted a
 * message has already decided it is worth reading. The generic shapes at the
 * end matter more than the names — they are what make this work outside India.
 */
export function looksLikeBankSender(sender: string | null | undefined): boolean {
  const header = senderHeader(sender);
  if (!header) return false;
  if (/^\+?\d{6,}$/.test(header)) return false; // a person's phone number
  return /BANK|BNK|\bBK|CARD|UPI|PAY|CRED|FIN|UBI|SBI|HDFC|ICICI|AXIS|KOTAK|PNB|BOI|CANARA|YES|IDFC|RBL|INDUS|AMEX|CHASE|WELLS|BOFA|BARCL|HSBC|LLOYD|NATWST|SANTAN|REVOLUT|MONZO|WISE|DBS|OCBC|UOB|ENBD|ADCB|FAB|MASHREQ|MAYBANK|CIMB|BCA|MANDIRI|BBVA|CAIXA|ITAU|BRADESCO|NUBANK|SPARKASSE|GARANTI|AKBANK|ZIRAAT|SCB|KBANK|VIETCOM|TECHCOM/i.test(
    header,
  );
}
