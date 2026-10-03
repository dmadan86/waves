/**
 * Which parts of a bank message's own words are the amount, the date and the
 * merchant — found by matching, never by guessing a new span out of thin air.
 *
 * The detail screen prints the message exactly as the bank sent it (A48, and
 * the rule `lib/smsPlain.ts` states: this is the one place a bank's own words
 * are shown back). Underlining three pieces of it in colour is only honest
 * when each piece is *the same fact the parser already extracted* — the
 * amount it read, the day it read, the shop it read — found again inside the
 * text rather than invented as "whatever looks like a number". A highlight
 * that does not correspond to a real match is worse than no highlight: it
 * teaches a person to stop trusting the colour.
 *
 * ## Why this works across currencies without knowing every symbol
 *
 * The amount is never searched for with its currency symbol. `₹`, `Rs`, `AED`,
 * `د.إ`, `SAR`, `A$` and the rest are routing — the one thing that is always
 * true is the *number*, written with the decimal precision that currency
 * actually uses (`minorUnitExponent`, which already knows KWD/BHD/OMR count
 * three decimal places and most of the world counts two). So this builds the
 * handful of plain-number spellings a bank might have written — grouped or
 * not, with or without a trailing ".00" — and looks for those. A dirham
 * amount and a rupee amount are found by exactly the same code path.
 *
 * ## Why this works in Arabic
 *
 * Nothing here reads left-to-right. A span is a pair of UTF-16 offsets into
 * the string, and `String.prototype.indexOf`/regex matching work the same way
 * regardless of which direction the text is *drawn* — bidi is a rendering
 * concern (`writingDirection` on the `Text` that slices this body), not an
 * indexing one. The dates this looks for are the Gregorian, Western-numeral
 * ones every bank message in the sample set actually uses, Arabic-language
 * ones included — DD/MM/YYYY and the English month abbreviations travel
 * unchanged into an Arabic sentence far more often than Eastern Arabic
 * numerals (٠١٢٣…) do.
 */

import { minorUnitExponent } from '@waves/core';

export type HighlightKind = 'amount' | 'date' | 'merchant';

export interface HighlightSpan {
  readonly start: number;
  readonly end: number;
  readonly kind: HighlightKind;
}

/** The three facts the parser already extracted, as this module takes them —
 *  nothing here re-parses the message, it only re-finds what was already read. */
export interface ParsedSmsFacts {
  /** Minor units, as stored (`StoredSms.amount`). Non-numeric → no amount span. */
  readonly amount: string;
  readonly currency: string;
  readonly merchant: string | null;
  /** `YYYY-MM-DD`, the day the parser decided the money moved. */
  readonly occurredOn: string;
}

const MONTHS = [
  ['jan', 'january'],
  ['feb', 'february'],
  ['mar', 'march'],
  ['apr', 'april'],
  ['may', 'may'],
  ['jun', 'june'],
  ['jul', 'july'],
  ['aug', 'august'],
  ['sep', 'september', 'sept'],
  ['oct', 'october'],
  ['nov', 'november'],
  ['dec', 'december'],
] as const;

const MONTH_PATTERN = MONTHS.map(([short, long, alt]) =>
  alt ? `${long}|${alt}|${short}` : `${long}|${short}`,
).join('|');

function monthNumberFromToken(token: string): number | null {
  const low = token.toLowerCase();
  for (let i = 0; i < MONTHS.length; i += 1) {
    if ((MONTHS[i] as readonly string[]).includes(low)) return i + 1;
  }
  return null;
}

function fullYear(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (raw.length > 2) return n;
  // A two-digit year on a bank message is always "this century" — nobody's
  // statement is dated 1926.
  return n + 2000;
}

/**
 * Every "this is a date" match the body contains, each annotated with the
 * calendar day it spells — so the caller only has to ask which one, if any,
 * equals the day the parser already decided on.
 */
function dateCandidates(
  body: string,
): { start: number; end: number; day: number; month: number; year: number }[] {
  const out: { start: number; end: number; day: number; month: number; year: number }[] = [];

  // `02-Oct-26`, `2 Oct 2026`, `02 Oct` — day, then a month name.
  const dayThenMonth = new RegExp(
    `\\b(\\d{1,2})[\\s-]*(${MONTH_PATTERN})[a-z]*\\.?[\\s,-]*(\\d{2,4})?\\b`,
    'gi',
  );
  for (const m of body.matchAll(dayThenMonth)) {
    const month = monthNumberFromToken(m[2]!);
    if (month === null) continue;
    const day = Number.parseInt(m[1]!, 10);
    const year = m[3] ? fullYear(m[3]) : Number.NaN;
    out.push({ start: m.index!, end: m.index! + m[0].length, day, month, year });
  }

  // `Oct 2`, `Oct 2, 2026`, `October 02 2026` — month name, then day.
  const monthThenDay = new RegExp(
    `\\b(${MONTH_PATTERN})[a-z]*\\.?[\\s,-]*(\\d{1,2})(?:[a-z]{0,2})?(?:[\\s,-]+(\\d{2,4}))?\\b`,
    'gi',
  );
  for (const m of body.matchAll(monthThenDay)) {
    const month = monthNumberFromToken(m[1]!);
    if (month === null) continue;
    const day = Number.parseInt(m[2]!, 10);
    const year = m[3] ? fullYear(m[3]) : Number.NaN;
    out.push({ start: m.index!, end: m.index! + m[0].length, day, month, year });
  }

  // `02/10/2026`, `02-10-26` — all-numeric, either day-month or month-day.
  const numeric = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/g;
  for (const m of body.matchAll(numeric)) {
    const a = Number.parseInt(m[1]!, 10);
    const b = Number.parseInt(m[2]!, 10);
    const year = fullYear(m[3]!);
    const span = { start: m.index!, end: m.index! + m[0].length, year };
    // Both readings are offered as candidates; whichever equals the parsed
    // date (if either does) is the one the caller picks.
    out.push({ ...span, day: a, month: b });
    if (a !== b) out.push({ ...span, day: b, month: a });
  }

  // `2026-10-02` — ISO, unambiguous.
  const iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
  for (const m of body.matchAll(iso)) {
    out.push({
      start: m.index!,
      end: m.index! + m[0].length,
      year: Number.parseInt(m[1]!, 10),
      month: Number.parseInt(m[2]!, 10),
      day: Number.parseInt(m[3]!, 10),
    });
  }

  return out;
}

/** The date span that spells the same calendar day the parser read, if the
 *  body contains one — the earliest such match, when several do. */
function findDateSpan(body: string, occurredOn: string): HighlightSpan | null {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(occurredOn);
  if (!parsed) return null;
  const targetYear = Number.parseInt(parsed[1]!, 10);
  const targetMonth = Number.parseInt(parsed[2]!, 10);
  const targetDay = Number.parseInt(parsed[3]!, 10);

  let best: { start: number; end: number } | null = null;
  for (const candidate of dateCandidates(body)) {
    if (candidate.day !== targetDay || candidate.month !== targetMonth) continue;
    if (Number.isFinite(candidate.year) && candidate.year !== targetYear) continue;
    if (best === null || candidate.start < best.start) best = candidate;
  }
  return best ? { start: best.start, end: best.end, kind: 'date' } : null;
}

/**
 * Plain-number spellings of a minor-unit amount a bank might have printed —
 * grouped or not, with or without the trailing fraction — longest first so a
 * search for any of them prefers the most complete spelling actually present.
 */
function amountSpellings(amountMinor: string, currency: string): string[] {
  if (!/^\d+$/.test(amountMinor)) return [];
  const exponent = minorUnitExponent(currency);
  const scale = 10n ** BigInt(exponent);
  const minor = BigInt(amountMinor);
  const whole = (minor / scale).toString();
  const fraction = exponent > 0 ? (minor % scale).toString().padStart(exponent, '0') : '';

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // Indian digit grouping: the last three digits, then pairs — "1,00,000"
  // rather than "100,000". Only differs from the international grouping past
  // six digits, so it is cheap to always offer.
  const indianGrouped = (() => {
    if (whole.length <= 3) return whole;
    const last3 = whole.slice(-3);
    const rest = whole.slice(0, -3);
    const pairs = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    return `${pairs},${last3}`;
  })();

  const wholes = [...new Set([grouped, indianGrouped, whole])];
  const spellings: string[] = [];
  for (const w of wholes) {
    if (fraction) spellings.push(`${w}.${fraction}`);
    spellings.push(w);
  }
  // Longest first: a fraction-bearing spelling fully contains the bare whole,
  // so trying it first is the only way the bare search does not pre-empt it.
  return [...new Set(spellings)].sort((a, b) => b.length - a.length);
}

/** A digit, comma or dot — the characters that would make a match part of a
 *  longer number rather than the whole of it. Checked by hand rather than with
 *  a lookbehind: Hermes on older Android builds does not reliably support
 *  `(?<=…)`, and a feature this small is not worth a crash report to find. */
function isNumberGlyph(ch: string | undefined): boolean {
  return ch !== undefined && /[\d,.]/.test(ch);
}

function findAmountSpan(body: string, amountMinor: string, currency: string): HighlightSpan | null {
  for (const spelling of amountSpellings(amountMinor, currency)) {
    let from = 0;
    for (;;) {
      const index = body.indexOf(spelling, from);
      if (index === -1) break;
      const end = index + spelling.length;
      const before = index > 0 ? body[index - 1] : undefined;
      const after = end < body.length ? body[end] : undefined;
      // The leading edge tolerates a comma/dot before it (a thousands
      // separator the spelling did not itself start with cannot happen here,
      // since every spelling is whole-number-first), so only a digit before
      // it disqualifies the match; a trailing comma or dot would mean this
      // match is the prefix of a longer number.
      if (!/\d/.test(before ?? '') && !isNumberGlyph(after)) {
        return { start: index, end, kind: 'amount' };
      }
      from = index + 1;
    }
  }
  return null;
}

function findMerchantSpan(body: string, merchant: string | null): HighlightSpan | null {
  const name = merchant?.trim();
  if (!name || name.length < 2) return null;
  const index = body.toLowerCase().indexOf(name.toLowerCase());
  if (index === -1) return null;
  return { start: index, end: index + name.length, kind: 'merchant' };
}

function overlaps(
  a: { start: number; end: number },
  spans: readonly { start: number; end: number }[],
): boolean {
  return spans.some((b) => a.start < b.end && b.start < a.end);
}

/**
 * The spans to highlight, in reading order — merchant first (the body's own
 * words, searched for as-is), then the amount and the date, each skipped if it
 * would overlap a span already claimed. At most one of each kind: the first,
 * earliest match, never every occurrence of a number that happens to recur in
 * a reference id.
 */
export function findHighlightSpans(body: string, facts: ParsedSmsFacts): HighlightSpan[] {
  const spans: HighlightSpan[] = [];

  const merchant = findMerchantSpan(body, facts.merchant);
  if (merchant) spans.push(merchant);

  const amount = findAmountSpan(body, facts.amount, facts.currency);
  if (amount && !overlaps(amount, spans)) spans.push(amount);

  const date = findDateSpan(body, facts.occurredOn);
  if (date && !overlaps(date, spans)) spans.push(date);

  return spans.sort((a, b) => a.start - b.start);
}
