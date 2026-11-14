/**
 * The spending digest: what the "Ask about my spending" feature may know.
 *
 * Aggregates only, over the person's OWN personal ledger (the same entries the
 * Spending screen reads; a group bill's share is not part of `PersonalTxn`, so
 * it is not here either). Totals per category per month, top merchants, the
 * previous period for comparison, and recurring charges (subscriptions). The
 * model never receives a row, a note, a place or an account number: a merchant
 * is a short normalised name taken from the note with the statement narration
 * reader, and anything that looks like a reference is dropped.
 *
 * The answers that have a right value (the subscription list, this period
 * against the last) are computed here, deterministically. The model only
 * phrases them, and `answerAmountsAreGrounded` checks it invented no number.
 *
 * Money is a decimal string of minor units on the way out (ADR-003); bigint
 * inside. Nothing is converted between currencies: one digest is one currency.
 * Dates are 'YYYY-MM-DD' strings handled on the UTC calendar, never a local one.
 */

import { minorUnitExponent, type CurrencyCode } from '../money/currency';
import { parseNarration } from '../statement/narration';
import { dayDelta, monthKey } from './compute';
import type { PersonalTxn } from './types';

export type RecurringCadence = 'weekly' | 'monthly' | 'yearly';

export interface DigestCategoryMonth {
  readonly month: string;
  /** null = no category. */
  readonly category: string | null;
  readonly totalMinor: string;
}

export interface DigestMerchant {
  readonly merchant: string;
  readonly totalMinor: string;
  readonly count: number;
}

export interface DigestRecurring {
  readonly merchant: string;
  /** The most recent charge. */
  readonly amountMinor: string;
  readonly cadence: RecurringCadence;
  readonly lastDate: string;
  readonly occurrences: number;
}

export interface DigestCategoryChange {
  readonly category: string | null;
  readonly currentMinor: string;
  readonly previousMinor: string;
  /** current − previous, signed. */
  readonly deltaMinor: string;
}

export interface SpendingDigest {
  readonly currency: CurrencyCode;
  readonly from: string;
  readonly to: string;
  /** The window of the same length that ends the day before `from`. */
  readonly previous: { readonly from: string; readonly to: string };
  readonly spentMinor: string;
  readonly incomeMinor: string;
  readonly previousSpentMinor: string;
  /** current − previous, signed. */
  readonly deltaMinor: string;
  /** Whole percent of the previous spend, rounded toward zero; null when it was 0. */
  readonly deltaPercent: number | null;
  readonly byCategoryByMonth: readonly DigestCategoryMonth[];
  readonly categoryChanges: readonly DigestCategoryChange[];
  readonly topMerchants: readonly DigestMerchant[];
  readonly recurring: readonly DigestRecurring[];
}

export interface DigestOptions {
  readonly from: string;
  readonly to: string;
  readonly currency: CurrencyCode;
}

export const DIGEST_TOP_MERCHANTS = 10;
export const DIGEST_MAX_RECURRING = 20;
export const DIGEST_MAX_CATEGORY_ROWS = 120;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

function shiftDays(date: string, days: number): string {
  const m = YMD.exec(date);
  if (!m) return date;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days))
    .toISOString()
    .slice(0, 10);
}

/**
 * The merchant a note names, lower-cased and tidy, or null when it names none.
 * Reads the note as a bank narration first (UPI/NEFT/POS punctuation), else as
 * plain text ("Netflix", "NETFLIX.COM 4481"). Digits-only runs, emails and
 * long references are removed: they identify a payment or a person, not a shop.
 */
export function digestMerchant(note: string | null | undefined): string | null {
  if (!note) return null;
  const raw = note.replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const narrated = parseNarration(raw);
  const base = narrated.kind === 'other' ? (narrated.counterparty ?? raw) : narrated.counterparty;
  if (!base) return null;
  const cleaned = base
    .toLowerCase()
    .replace(/\S+@\S+/g, ' ')
    .replace(/\b\d{3,}\b/g, ' ')
    .replace(/[^\p{L}\p{N} .&'+-]/gu, ' ')
    .replace(/\.(com|in|co|net|org)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length < 2 || !/\p{L}/u.test(cleaned)) return null;
  return cleaned.slice(0, 40);
}

const CADENCES: readonly { cadence: RecurringCadence; min: number; max: number; stale: number }[] =
  [
    { cadence: 'weekly', min: 6, max: 8, stale: 21 },
    { cadence: 'monthly', min: 26, max: 35, stale: 70 },
    { cadence: 'yearly', min: 350, max: 380, stale: 400 },
  ];

/** Amounts within ±10% of `base`. Integer maths: |a − b| × 10 ≤ b. */
function similar(a: bigint, base: bigint): boolean {
  const diff = a > base ? a - base : base - a;
  return base > 0n && diff * 10n <= base;
}

interface Charge {
  readonly date: string;
  readonly amount: bigint;
}

/**
 * Recurring charges: the same merchant, a similar amount (±10% of the latest),
 * at a regular cadence. Needs 3 occurrences (2 for yearly), every gap inside the
 * cadence's band, and a latest charge recent enough that it is plausibly still
 * running at `to`.
 */
function detectRecurring(
  byMerchant: ReadonlyMap<string, readonly Charge[]>,
  to: string,
): DigestRecurring[] {
  const found: DigestRecurring[] = [];
  for (const [merchant, all] of byMerchant) {
    const sorted = [...all].sort((a, b) =>
      a.date === b.date ? (a.amount < b.amount ? -1 : 1) : a.date < b.date ? -1 : 1,
    );
    const latest = sorted[sorted.length - 1]!;
    // Several same-day charges of one amount are one charge (a double-tap), not a cadence.
    const run: Charge[] = [];
    for (const c of sorted) {
      if (!similar(c.amount, latest.amount)) continue;
      if (run.length > 0 && run[run.length - 1]!.date === c.date) continue;
      run.push(c);
    }
    if (run.length < 2) continue;
    const gaps = run.slice(1).map((c, i) => dayDelta(run[i]!.date, c.date));
    const match = CADENCES.find(
      (k) =>
        gaps.every((g) => g >= k.min && g <= k.max) && (run.length >= 3 || k.cadence === 'yearly'),
    );
    if (!match) continue;
    if (dayDelta(latest.date, to) > match.stale) continue;
    found.push({
      merchant,
      amountMinor: latest.amount.toString(),
      cadence: match.cadence,
      lastDate: latest.date,
      occurrences: run.length,
    });
  }
  return found
    .sort((a, b) => {
      const d = BigInt(b.amountMinor) - BigInt(a.amountMinor);
      return d === 0n ? a.merchant.localeCompare(b.merchant) : d > 0n ? 1 : -1;
    })
    .slice(0, DIGEST_MAX_RECURRING);
}

const bySpendThenName = (a: [string, bigint], b: [string, bigint]): number =>
  b[1] === a[1] ? a[0].localeCompare(b[0]) : b[1] > a[1] ? 1 : -1;

export function buildSpendingDigest(
  entries: readonly PersonalTxn[],
  options: DigestOptions,
): SpendingDigest {
  const { from, to, currency } = options;
  const span = Math.max(1, dayDelta(from, to) + 1);
  const prevTo = shiftDays(from, -1);
  const prevFrom = shiftDays(from, -span);

  let income = 0n;
  let spent = 0n;
  let previousSpent = 0n;
  const catMonth = new Map<string, bigint>();
  const catNow = new Map<string, bigint>();
  const catBefore = new Map<string, bigint>();
  const merchants = new Map<string, { total: bigint; count: number }>();
  const charges = new Map<string, Charge[]>();
  const KEY = '\u0000';

  for (const t of entries) {
    if (t.currency !== currency || !YMD.test(t.date)) continue;
    if (t.kind === 'income') {
      if (t.date >= from && t.date <= to) income += t.amount;
      continue;
    }
    const cat = t.category ?? '';
    const merchant = digestMerchant(t.note);
    if (merchant && t.date <= to) {
      // History before the window counts for cadence, never for the totals.
      const list = charges.get(merchant) ?? [];
      list.push({ date: t.date, amount: t.amount });
      charges.set(merchant, list);
    }
    if (t.date >= from && t.date <= to) {
      spent += t.amount;
      const mk = `${monthKey(t.date)}${KEY}${cat}`;
      catMonth.set(mk, (catMonth.get(mk) ?? 0n) + t.amount);
      catNow.set(cat, (catNow.get(cat) ?? 0n) + t.amount);
      if (merchant) {
        const m = merchants.get(merchant) ?? { total: 0n, count: 0 };
        merchants.set(merchant, { total: m.total + t.amount, count: m.count + 1 });
      }
    } else if (t.date >= prevFrom && t.date <= prevTo) {
      previousSpent += t.amount;
      catBefore.set(cat, (catBefore.get(cat) ?? 0n) + t.amount);
    }
  }

  const delta = spent - previousSpent;
  const categoryNames = new Set([...catNow.keys(), ...catBefore.keys()]);
  const categoryChanges = [...categoryNames]
    .map((c) => {
      const cur = catNow.get(c) ?? 0n;
      const prev = catBefore.get(c) ?? 0n;
      return { category: c === '' ? null : c, cur, prev, d: cur - prev };
    })
    .sort((a, b) => {
      const x = a.d < 0n ? -a.d : a.d;
      const y = b.d < 0n ? -b.d : b.d;
      return x === y ? (a.category ?? '').localeCompare(b.category ?? '') : y > x ? 1 : -1;
    })
    .slice(0, 20)
    .map((c) => ({
      category: c.category,
      currentMinor: c.cur.toString(),
      previousMinor: c.prev.toString(),
      deltaMinor: c.d.toString(),
    }));

  return {
    currency,
    from,
    to,
    previous: { from: prevFrom, to: prevTo },
    spentMinor: spent.toString(),
    incomeMinor: income.toString(),
    previousSpentMinor: previousSpent.toString(),
    deltaMinor: delta.toString(),
    deltaPercent: previousSpent > 0n ? Number((delta * 100n) / previousSpent) : null,
    byCategoryByMonth: [...catMonth]
      .map(([k, v]) => {
        const [month, c] = k.split(KEY) as [string, string];
        return { month, category: c === '' ? null : c, total: v };
      })
      .sort((a, b) =>
        a.month === b.month
          ? a.total === b.total
            ? (a.category ?? '').localeCompare(b.category ?? '')
            : b.total > a.total
              ? 1
              : -1
          : a.month < b.month
            ? -1
            : 1,
      )
      .slice(0, DIGEST_MAX_CATEGORY_ROWS)
      .map((r) => ({ month: r.month, category: r.category, totalMinor: r.total.toString() })),
    categoryChanges,
    topMerchants: [...merchants]
      .map(([name, m]) => [name, m.total, m.count] as [string, bigint, number])
      .sort((a, b) => bySpendThenName([a[0], a[1]], [b[0], b[1]]))
      .slice(0, DIGEST_TOP_MERCHANTS)
      .map(([merchant, total, count]) => ({ merchant, totalMinor: total.toString(), count })),
    recurring: detectRecurring(charges, to),
  };
}

// ───────────────────────────────────────────────── facts and checks ──

export interface AskFact {
  readonly label: string;
  readonly amountMinor: string;
  readonly currency: string;
}

/** The numbers an answer may quote, labelled. Every one comes straight from the digest. */
export function digestFacts(digest: SpendingDigest): AskFact[] {
  const c = digest.currency;
  const facts: AskFact[] = [
    { label: 'Spent this period', amountMinor: digest.spentMinor, currency: c },
    { label: 'Spent in the previous period', amountMinor: digest.previousSpentMinor, currency: c },
    { label: 'Change', amountMinor: digest.deltaMinor, currency: c },
  ];
  const top = digest.categoryChanges.find((x) => x.category !== null);
  if (top) {
    facts.push({ label: `${top.category}: change`, amountMinor: top.deltaMinor, currency: c });
  }
  const m = digest.topMerchants[0];
  if (m)
    facts.push({ label: `Top merchant: ${m.merchant}`, amountMinor: m.totalMinor, currency: c });
  return facts;
}

export function monthlyEquivalentMinor(r: DigestRecurring): bigint {
  const a = BigInt(r.amountMinor);
  return r.cadence === 'monthly' ? a : r.cadence === 'weekly' ? (a * 52n) / 12n : a / 12n;
}

const money = (minor: string, digest: SpendingDigest): string => {
  const exp = minorUnitExponent(digest.currency);
  const neg = minor.startsWith('-');
  const digits = (neg ? minor.slice(1) : minor).padStart(exp + 1, '0');
  const whole = digits.slice(0, digits.length - exp);
  const frac = digits.slice(digits.length - exp);
  return `${neg ? '-' : ''}${digest.currency} ${whole}${exp > 0 ? `.${frac}` : ''}`;
};

/**
 * A plain answer written from the digest alone, used when the model is off,
 * fails, or says a number the digest does not hold. English only; the app
 * shows the localised facts beside it.
 */
export function fallbackAnswer(digest: SpendingDigest): string {
  const parts = [
    `You spent ${money(digest.spentMinor, digest)} from ${digest.from} to ${digest.to}.`,
  ];
  const d = BigInt(digest.deltaMinor);
  if (digest.deltaPercent !== null) {
    const how =
      d === 0n
        ? 'the same as'
        : `${money((d < 0n ? -d : d).toString(), digest)} ${d > 0n ? 'more' : 'less'} than`;
    parts.push(`That is ${how} the previous period (${money(digest.previousSpentMinor, digest)}).`);
  }
  if (digest.recurring.length > 0) {
    parts.push(`${digest.recurring.length} recurring charges were found.`);
  }
  return parts.join(' ');
}

/** Every digit-run in a string, as written. */
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/** Minor units for a written amount like "1,234.50", or null when it has more decimals than the currency. */
function toMinor(written: string, exp: number): bigint | null {
  const plain = written.replace(/,/g, '');
  const [whole = '0', frac = ''] = plain.split('.');
  if (frac.length > exp) return null;
  return BigInt(whole + frac.padEnd(exp, '0'));
}

/**
 * True when every number in `answer` is one the digest holds: an amount (in
 * major units, any grouping), a count, a date part, or a percentage it computed.
 * Small bare integers (≤ 31, as in "3 charges", "the 5th") and plain years pass
 * as counts and dates; anything else must match a digest amount exactly. Used
 * to refuse a model that makes up a figure.
 */
export function answerAmountsAreGrounded(answer: string, digest: SpendingDigest): boolean {
  const exp = minorUnitExponent(digest.currency);
  const allowed = new Set<string>();
  const add = (minor: string): void => {
    allowed.add(minor.replace('-', ''));
  };
  [digest.spentMinor, digest.incomeMinor, digest.previousSpentMinor, digest.deltaMinor].forEach(
    add,
  );
  digest.byCategoryByMonth.forEach((r) => add(r.totalMinor));
  digest.categoryChanges.forEach((r) =>
    [r.currentMinor, r.previousMinor, r.deltaMinor].forEach(add),
  );
  digest.topMerchants.forEach((r) => add(r.totalMinor));
  digest.recurring.forEach((r) => {
    add(r.amountMinor);
    add(monthlyEquivalentMinor(r).toString());
    add((monthlyEquivalentMinor(r) * 12n).toString());
  });
  // A total of all subscriptions per month is a sum the model may state.
  add(digest.recurring.reduce((s, r) => s + monthlyEquivalentMinor(r), 0n).toString());
  const percents = new Set<string>();
  if (digest.deltaPercent !== null) percents.add(String(Math.abs(digest.deltaPercent)));

  // Dates and months in the text ("2026-10-03", "2026-10") are not amounts.
  const text = answer.replace(/\b\d{4}-\d{2}(?:-\d{2})?\b/g, ' ');
  for (const match of text.matchAll(NUMBER)) {
    const written = match[0].replace(/[,.]$/, '');
    const after = text.slice(
      (match.index ?? 0) + match[0].length,
      (match.index ?? 0) + match[0].length + 2,
    );
    if (after.trimStart().startsWith('%')) {
      if (!percents.has(written)) return false;
      continue;
    }
    const minor = toMinor(written, exp);
    if (minor !== null && allowed.has(minor.toString())) continue;
    const bare = /^\d+$/.test(written);
    if (bare && Number(written) <= 31) continue;
    if (bare && /^(19|20)\d{2}$/.test(written)) continue;
    return false;
  }
  return true;
}
