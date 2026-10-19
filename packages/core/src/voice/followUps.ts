/**
 * Follow-up questions after the voice agent saves an expense (Pro).
 *
 * "Added ₹8,000 to Personal. Where was this?" — a short, optional chain of
 * questions that enriches the expense that was just saved. This file is the
 * whole policy and is pure: no storage, no location, no network, no model. A
 * deterministic relevance scorer picks the next question, so deciding whether
 * to ask costs nothing and behaves the same every time.
 *
 * The rules exist so the feature never irritates:
 *
 *  - Off, or a small spend (below the person's median for that currency, or
 *    below a floor when there is not enough history): ask nothing.
 *  - Never ask about something the expense already has.
 *  - At most {@link MAX_QUESTIONS} per expense, one at a time; stop the moment
 *    the person skips or dismisses {@link MAX_CONSECUTIVE_SKIPS} in a row, or
 *    taps Done.
 *  - A muted question type is never asked; {@link MUTE_AFTER_SKIPS} skips of one
 *    type mutes it by itself ({@link AUTO_MUTE_AFTER} overrides per type);
 *    earlier skips only lower its score.
 *  - Answers teach it, per category: always skipping "split" on groceries stops
 *    it being asked there ({@link learningFor}).
 *  - One question gets past the small-spend rule: a likely duplicate of what
 *    someone else just added. It is still capped, muted and switched off like
 *    the rest.
 */

import { guessCategory } from '../category/categories';

/** Order is the tie-break: earlier wins when scores are equal. */
export const FOLLOW_UP_KINDS = [
  'duplicate',
  'payer',
  'date',
  'lend',
  'currency',
  'trip',
  'wrapup',
  'recurring',
  'attendance',
  'place',
  'category',
  'receipt',
  'split',
  'payment',
  'work',
] as const;
export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number];

export const MAX_QUESTIONS = 2;
export const MAX_CONSECUTIVE_SKIPS = 2;
export const MUTE_AFTER_SKIPS = 3;
/** Types that mute sooner than {@link MUTE_AFTER_SKIPS}: "claim from work" asks once. */
export const AUTO_MUTE_AFTER: Readonly<Partial<Record<FollowUpKind, number>>> = { work: 1 };
/** A question scoring below this is not worth interrupting for. */
export const MIN_SCORE = 30;
/** Fewer samples than this and a currency has no median to trust. */
export const MIN_HISTORY = 5;
/** The kind allowed to ignore the small-spend rule. */
export const BYPASSES_SMALL_SPEND: readonly FollowUpKind[] = ['duplicate'];

const DAY_MS = 86_400_000;
const FLOOR_MAJOR: Readonly<Record<string, number>> = {
  INR: 200,
  USD: 5,
  EUR: 5,
  GBP: 4,
  AED: 20,
  AUD: 8,
  CAD: 7,
  SGD: 7,
};
export const DEFAULT_FLOOR_MAJOR = 5;

const RECEIPT_CATEGORIES: ReadonlySet<string> = new Set([
  'travel',
  'stay',
  'shopping',
  'health',
  'home',
  'business',
  'office',
  'fuel',
  'software',
]);
const OUTING_CATEGORIES: ReadonlySet<string> = new Set([
  'food',
  'groceries',
  'shopping',
  'entertainment',
  'travel',
  'stay',
]);
const SOCIAL_CATEGORIES: ReadonlySet<string> = new Set(['food', 'entertainment', 'travel', 'stay']);
const GATHERING_CATEGORIES: ReadonlySet<string> = new Set(['food', 'entertainment']);
const WORK_CATEGORIES: ReadonlySet<string> = new Set(['travel', 'food', 'stay']);
const DEFAULT_CATEGORY_CHOICES = ['food', 'shopping', 'travel', 'groceries', 'entertainment'];

export type FollowUpScope = 'personal' | 'group';

export interface GroupMemberFact {
  readonly id: string;
  readonly name: string;
  readonly isMe: boolean;
}

/** The expense that was just saved, as far as the scorer cares. */
export interface SavedExpenseFacts {
  readonly scope: FollowUpScope;
  readonly expenseId: string;
  /** Minor units. */
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly category: string | null;
  /** The category was stated (by the model or the person), not guessed. */
  readonly categoryStated: boolean;
  readonly description: string;
  /** The expense's date, YYYY-MM-DD. */
  readonly date: string;
  readonly hasPlace: boolean;
  readonly hasReceipt: boolean;
  readonly hasNotes: boolean;
  readonly hasPaymentMethod: boolean;
  /** Whether a receipt can be attached to this kind of expense at all. */
  readonly canAttachReceipt: boolean;
  /** Whether a payment method can be stored on this kind of expense. */
  readonly canSetPayment: boolean;
  /** Group expenses: where it went, who is in it, who paid and who shares it. */
  readonly groupId: string | null;
  readonly groupName: string | null;
  readonly members: readonly GroupMemberFact[];
  readonly splitParticipantCount: number;
  readonly payerIsMe: boolean;
}

export interface SplitPartner {
  readonly memberId: string;
  readonly groupId: string;
  readonly name: string;
  readonly count: number;
}

/** Someone else's expense in a group the person is in, for the duplicate guard. */
export interface RecentGroupExpense {
  readonly groupId: string;
  readonly expenseId: string;
  readonly byOther: boolean;
  readonly authorName: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly description: string;
  /** When it was added (epoch ms). */
  readonly createdMs: number;
}

/** A trip group: dates, and how long it was quiet before this add. */
export interface TripInfo {
  readonly groupId: string;
  readonly name: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  /** Whole days since the trip's previous activity, before this add; null if none. */
  readonly quietDays: number | null;
}

/** A past personal expense, for spotting a monthly habit. */
export interface PastEntry {
  readonly description: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly date: string;
}

/** What the person's own history says (see {@link buildHistoryStats}). */
export interface HistoryStats {
  readonly byCurrency: Readonly<
    Record<string, { readonly median: bigint; readonly count: number }>
  >;
  readonly partnersByCategory: Readonly<Record<string, readonly SplitPartner[]>>;
  readonly recentPlaces: readonly string[];
  /** Most used categories, most used first. */
  readonly topCategories: readonly string[];
  readonly pastPersonal: readonly PastEntry[];
  /** Normalised descriptions of recurring rules that already exist. */
  readonly recurringRules: readonly string[];
  readonly recentGroupExpenses: readonly RecentGroupExpense[];
  readonly trips: readonly TripInfo[];
}

export const EMPTY_HISTORY: HistoryStats = {
  byCurrency: {},
  partnersByCategory: {},
  recentPlaces: [],
  topCategories: [],
  pastPersonal: [],
  recurringRules: [],
  recentGroupExpenses: [],
  trips: [],
};

export interface Learned {
  readonly yes: number;
  readonly no: number;
}

/** Persisted preferences: the master switch, mutes, skip counts and what was learned. */
export interface FollowUpPrefs {
  readonly enabled: boolean;
  readonly muted: readonly FollowUpKind[];
  readonly skips: Readonly<Partial<Record<FollowUpKind, number>>>;
  /** Per `kind|category`: answered vs skipped. */
  readonly learned: Readonly<Record<string, Learned>>;
  /** Groups that already got the trip wrap-up question. */
  readonly wrapUpShown: readonly string[];
}

export const DEFAULT_PREFS: FollowUpPrefs = {
  enabled: true,
  muted: [],
  skips: {},
  learned: {},
  wrapUpShown: [],
};

export interface FollowUpSession {
  readonly asked: readonly FollowUpKind[];
  readonly consecutiveSkips: number;
  /** Done tapped, or the chain was stopped. */
  readonly stopped: boolean;
}

export const NEW_SESSION: FollowUpSession = { asked: [], consecutiveSkips: 0, stopped: false };

export interface FollowUpEnvironment {
  /** A place name from a reverse geocode, only when permission was already granted. */
  readonly currentPlace: string | null;
  /** The currency of the country the phone is in; only when location was already granted. */
  readonly deviceCurrency: string | null;
  /** Local hour of day, 0-23. */
  readonly hour: number;
  readonly nowMs: number;
  /** The caller's local date, YYYY-MM-DD. */
  readonly today: string;
}

export interface FollowUpQuestion {
  readonly kind: FollowUpKind;
  readonly score: number;
  /** place: offered names, the first is where the person is when `hereNow`. */
  readonly places: readonly string[];
  readonly hereNow: boolean;
  /** split: frequent partners. */
  readonly partners: readonly SplitPartner[];
  /** trip / wrapup: the trip. */
  readonly trip?: TripInfo;
  /** payer: who the description says paid. */
  readonly payer?: GroupMemberFact;
  /** duplicate: the earlier expense. */
  readonly duplicate?: RecentGroupExpense;
  /** currency: the device's currency. */
  readonly currency?: string;
  /** category: three likely categories. */
  readonly categories?: readonly string[];
  /** date: the day to move it to. */
  readonly suggestedDate?: string;
  /** lend: who the money went to. */
  readonly person?: string;
  /** recurring: the day of the month it falls on. */
  readonly dayOfMonth?: number;
}

// ── prefs ──────────────────────────────────────────────────────────────────

export function muteThreshold(kind: FollowUpKind): number {
  return AUTO_MUTE_AFTER[kind] ?? MUTE_AFTER_SKIPS;
}

export function isMuted(prefs: FollowUpPrefs, kind: FollowUpKind): boolean {
  return prefs.muted.includes(kind) || (prefs.skips[kind] ?? 0) >= muteThreshold(kind);
}

export function muteKind(prefs: FollowUpPrefs, kind: FollowUpKind): FollowUpPrefs {
  return prefs.muted.includes(kind) ? prefs : { ...prefs, muted: [...prefs.muted, kind] };
}

const LEARN_CAP = 40;
const learnKey = (kind: FollowUpKind, category: string | null): string =>
  `${kind}|${(category ?? '').toLowerCase() || '-'}`;

function learn(
  prefs: FollowUpPrefs,
  kind: FollowUpKind,
  category: string | null,
  field: 'yes' | 'no',
): FollowUpPrefs {
  const key = learnKey(kind, category);
  const seen = prefs.learned[key] ?? { yes: 0, no: 0 };
  const next = { ...seen, [field]: Math.min(LEARN_CAP, seen[field] + 1) };
  return { ...prefs, learned: { ...prefs.learned, [key]: next } };
}

/** A skipped (or dismissed) question: counts toward muting that type, and teaches. */
export function recordSkip(
  prefs: FollowUpPrefs,
  kind: FollowUpKind,
  category: string | null = null,
): FollowUpPrefs {
  const count = (prefs.skips[kind] ?? 0) + 1;
  const next = learn({ ...prefs, skips: { ...prefs.skips, [kind]: count } }, kind, category, 'no');
  return count >= muteThreshold(kind) ? muteKind(next, kind) : next;
}

/** An answered question: its skip count starts over, and the category learns a yes. */
export function recordAnswer(
  prefs: FollowUpPrefs,
  kind: FollowUpKind,
  category: string | null = null,
): FollowUpPrefs {
  const skips = { ...prefs.skips };
  delete skips[kind];
  return learn({ ...prefs, skips }, kind, category, 'yes');
}

/** The trip wrap-up is asked once per group. */
export function markWrapUpShown(prefs: FollowUpPrefs, groupId: string): FollowUpPrefs {
  return prefs.wrapUpShown.includes(groupId)
    ? prefs
    : { ...prefs, wrapUpShown: [...prefs.wrapUpShown, groupId].slice(-100) };
}

export function setEnabled(prefs: FollowUpPrefs, enabled: boolean): FollowUpPrefs {
  return { ...prefs, enabled };
}

/** "Reset muted": every type is asked again and what was learned is forgotten. */
export function resetMuted(prefs: FollowUpPrefs): FollowUpPrefs {
  return { ...DEFAULT_PREFS, enabled: prefs.enabled, wrapUpShown: prefs.wrapUpShown };
}

/**
 * What the answers so far say about asking this type for this category. Three
 * skips and no answer ever: block it. Otherwise each skip costs points and each
 * answer earns some back, within bounds so one habit never decides alone.
 */
export function learningFor(
  prefs: FollowUpPrefs,
  kind: FollowUpKind,
  category: string | null,
): { blocked: boolean; delta: number } {
  const seen = prefs.learned[learnKey(kind, category)];
  if (!seen) return { blocked: false, delta: 0 };
  if (seen.no >= 3 && seen.yes === 0) return { blocked: true, delta: -100 };
  return { blocked: false, delta: Math.max(-30, Math.min(12, seen.yes * 6 - seen.no * 8)) };
}

/** Total: anything unreadable becomes the defaults, a bad field is dropped. */
export function parsePrefs(raw: string | null | undefined): FollowUpPrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const value = JSON.parse(raw) as Partial<Record<string, unknown>> | null;
    if (!value || typeof value !== 'object') return DEFAULT_PREFS;
    const known = (k: unknown): k is FollowUpKind =>
      typeof k === 'string' && (FOLLOW_UP_KINDS as readonly string[]).includes(k);
    const muted = Array.isArray(value.muted) ? [...new Set(value.muted.filter(known))] : [];
    const skips: Partial<Record<FollowUpKind, number>> = {};
    if (value.skips && typeof value.skips === 'object') {
      for (const [k, n] of Object.entries(value.skips)) {
        if (known(k) && typeof n === 'number' && Number.isFinite(n) && n > 0) {
          skips[k] = Math.floor(n);
        }
      }
    }
    const learned: Record<string, Learned> = {};
    if (value.learned && typeof value.learned === 'object') {
      for (const [k, v] of Object.entries(value.learned)) {
        const l = v as Partial<Learned> | null;
        if (
          known(k.split('|')[0]) &&
          l &&
          typeof l.yes === 'number' &&
          typeof l.no === 'number' &&
          l.yes >= 0 &&
          l.no >= 0
        ) {
          learned[k] = {
            yes: Math.min(LEARN_CAP, Math.floor(l.yes)),
            no: Math.min(LEARN_CAP, Math.floor(l.no)),
          };
        }
      }
    }
    const wrapUpShown = Array.isArray(value.wrapUpShown)
      ? value.wrapUpShown.filter((g): g is string => typeof g === 'string').slice(-100)
      : [];
    return { enabled: value.enabled !== false, muted, skips, learned, wrapUpShown };
  } catch {
    return DEFAULT_PREFS;
  }
}

// ── session ────────────────────────────────────────────────────────────────

export type FollowUpOutcome = 'answered' | 'skipped' | 'dismissed' | 'done';

/** Advance a session after the person responded to `kind`. */
export function advanceSession(
  session: FollowUpSession,
  kind: FollowUpKind,
  outcome: FollowUpOutcome,
): FollowUpSession {
  const asked = session.asked.includes(kind) ? session.asked : [...session.asked, kind];
  if (outcome === 'done')
    return { asked, consecutiveSkips: session.consecutiveSkips, stopped: true };
  if (outcome === 'answered') return { asked, consecutiveSkips: 0, stopped: session.stopped };
  const consecutiveSkips = session.consecutiveSkips + 1;
  return {
    asked,
    consecutiveSkips,
    stopped: session.stopped || consecutiveSkips >= MAX_CONSECUTIVE_SKIPS,
  };
}

// ── text detectors (pure, and tested) ──────────────────────────────────────

const TRIP_WORDS =
  /\b(cab|taxi|uber|ola|rapido|lyft|hotel|hostel|resort|airbnb|flight|flights|airline|train|bus|ferry|toll|petrol|diesel|fuel|visa|luggage|sightseeing|tour|safari)\b/i;

/** A description that sounds like travel: a cab, a hotel, a flight. */
export function looksLikeTripSpend(description: string, category: string | null): boolean {
  const c = (category ?? '').toLowerCase();
  return c === 'travel' || c === 'stay' || TRIP_WORDS.test(description);
}

/** "Ravi paid", "paid by Ravi", "Ravi treated us": the member the words name as payer. */
export function detectOtherPayer(
  description: string,
  members: readonly GroupMemberFact[],
): GroupMemberFact | null {
  const text = description.toLowerCase();
  if (!/\b(paid|pays|covered|treat|treated|treats|bought|picked up)\b/.test(text)) return null;
  for (const member of members) {
    if (member.isMe) continue;
    const first = member.name.trim().split(/\s+/)[0]?.toLowerCase();
    if (!first || first.length < 2) continue;
    const named = new RegExp(`\\b${escapeRegExp(first)}\\b`).test(text);
    if (!named) continue;
    const byThem = new RegExp(
      `\\b${escapeRegExp(first)}\\s+(paid|pays|covered|treated|treats|bought|picked up)\\b|\\b(paid|covered|treat|bought)\\s+(for\\s+)?by\\s+${escapeRegExp(first)}\\b|\\bby\\s+${escapeRegExp(first)}\\b`,
    ).test(text);
    // "paid Ravi" / "paid for Ravi" name him as the one paid, not the payer.
    if (byThem) return member;
  }
  return null;
}

const NOT_A_PERSON = new Set([
  'the',
  'a',
  'an',
  'my',
  'our',
  'me',
  'us',
  'lunch',
  'dinner',
  'breakfast',
  'rent',
  'bill',
  'bills',
  'food',
  'fuel',
  'petrol',
  'gas',
  'groceries',
  'shopping',
  'tickets',
  'movie',
  'trip',
  'party',
  'gift',
  'recharge',
  'wifi',
  'cab',
  'taxi',
  'work',
  'office',
  'home',
  'to',
  'for',
]);

/** "gave 5000 to Ravi", "lent Ravi", "loan to Ravi", "for Ravi": who the money went to. */
export function detectLendTarget(description: string): string | null {
  const verb = /\b(gave|give|lent|lend|loaned|loan|advance|advanced|sent)\b/i.test(description);
  const to = /\b(?:to|for)\s+([A-Za-z][A-Za-z'.-]{1,24})\b/.exec(description);
  const direct =
    /\b(?:lent|lend|loaned|gave)\s+([A-Za-z][A-Za-z'.-]{1,24})\b(?!\s*(?:to|for))/i.exec(
      description,
    );
  const capitalFor = /\bfor\s+([A-Z][a-z'.-]{1,24})\b/.exec(description);
  const pick = (m: RegExpExecArray | null): string | null => {
    const name = m?.[1];
    if (!name || NOT_A_PERSON.has(name.toLowerCase())) return null;
    return name.charAt(0).toUpperCase() + name.slice(1);
  };
  if (verb) return pick(to) ?? pick(direct);
  return pick(capitalFor);
}

/** Description says it happened before today. */
export function saysYesterday(description: string): boolean {
  return /\b(yesterday|last night|yday|last evening)\b/i.test(description);
}

export function normaliseDescription(description: string): string {
  return description
    .toLowerCase()
    .replace(/[0-9]+/g, ' ')
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── date arithmetic on YYYY-MM-DD ──────────────────────────────────────────

function parseDay(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function addDaysIso(iso: string, days: number): string {
  const t = parseDay(iso);
  if (t === null) return iso;
  return new Date(t + days * DAY_MS).toISOString().slice(0, 10);
}

/** The same day next month; a day past the month's end lands on its last day. */
export function nextMonthlyDate(iso: string): string {
  const t = parseDay(iso);
  if (t === null) return iso;
  const d = new Date(t);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

// ── pattern finders ────────────────────────────────────────────────────────

const within = (a: bigint, b: bigint, percent: bigint): boolean => {
  if (b === 0n) return false;
  const diff = a > b ? a - b : b - a;
  return diff * 100n <= b * percent;
};

/**
 * The same bill, entered by someone else in this group in the last day: a
 * similar amount (within 5%), the same currency, not this expense.
 */
export function findDuplicate(
  expense: SavedExpenseFacts,
  recent: readonly RecentGroupExpense[],
  nowMs: number,
): RecentGroupExpense | null {
  if (expense.scope !== 'group' || !expense.groupId) return null;
  let best: RecentGroupExpense | null = null;
  for (const other of recent) {
    if (
      !other.byOther ||
      other.groupId !== expense.groupId ||
      other.expenseId === expense.expenseId ||
      other.currency.toUpperCase() !== expense.currency.toUpperCase()
    ) {
      continue;
    }
    const age = nowMs - other.createdMs;
    if (age < 0 || age > DAY_MS) continue;
    if (!within(expense.amountMinor, other.amountMinor, 5n)) continue;
    if (!best || other.createdMs > best.createdMs) best = other;
  }
  return best;
}

/**
 * A monthly habit: the same description at a similar amount (within 10%) near
 * the same day of the month, in at least two earlier months. `null` when a
 * recurring rule already covers it.
 */
export function findRecurring(
  expense: SavedExpenseFacts,
  past: readonly PastEntry[],
  existingRules: readonly string[],
): { dayOfMonth: number } | null {
  if (expense.scope !== 'personal') return null;
  const key = normaliseDescription(expense.description);
  if (!key || existingRules.includes(key)) return null;
  const today = parseDay(expense.date);
  if (today === null) return null;
  const day = new Date(today).getUTCDate();
  const thisMonth = expense.date.slice(0, 7);
  const months = new Set<string>();
  for (const entry of past) {
    if (normaliseDescription(entry.description) !== key) continue;
    if (entry.currency.toUpperCase() !== expense.currency.toUpperCase()) continue;
    if (!within(expense.amountMinor, entry.amountMinor, 10n)) continue;
    const t = parseDay(entry.date);
    if (t === null || entry.date.slice(0, 7) >= thisMonth) continue;
    const gap = Math.abs(new Date(t).getUTCDate() - day);
    if (Math.min(gap, 31 - gap) > 3) continue;
    months.add(entry.date.slice(0, 7));
  }
  return months.size >= 2 ? { dayOfMonth: day } : null;
}

/** A trip that covers this date, for an expense that went to Personal. */
export function activeTripOn(trips: readonly TripInfo[], date: string): TripInfo | null {
  for (const trip of trips) {
    if (!trip.startDate || trip.startDate > date) continue;
    if (trip.endDate && trip.endDate < date) continue;
    return trip;
  }
  return null;
}

/** Trip over, or quiet for five days before this add. */
export function tripWrapUpDue(trip: TripInfo | undefined, today: string): boolean {
  if (!trip) return false;
  if (trip.endDate && trip.endDate < today) return true;
  return trip.quietDays !== null && trip.quietDays >= 5;
}

/** Three categories worth offering: the person's own favourites first. */
export function suggestCategories(
  top: readonly string[],
  current: string | null,
): readonly string[] {
  const out: string[] = [];
  for (const id of [...top, ...DEFAULT_CATEGORY_CHOICES]) {
    const c = id.toLowerCase();
    if (c === 'other' || c === (current ?? '').toLowerCase() || out.includes(c)) continue;
    out.push(c);
    if (out.length === 3) break;
  }
  return out;
}

/** Whether the category is a guess that found nothing to go on. */
export function categoryUnsure(expense: SavedExpenseFacts): boolean {
  if (expense.categoryStated) return false;
  const guess = guessCategory(expense.description);
  return guess === null || guess === 'other';
}

// ── rules ──────────────────────────────────────────────────────────────────

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

/** The no-history floor in minor units; `exponent` is the currency's decimals. */
export function floorMinor(currency: string, exponent: number): bigint {
  return BigInt(FLOOR_MAJOR[currency.toUpperCase()] ?? DEFAULT_FLOOR_MAJOR) * pow10(exponent);
}

/**
 * Small spends get no follow-ups: below the median for the currency when there
 * is enough history, otherwise below the floor.
 */
export function isSmallSpend(
  amountMinor: bigint,
  currency: string,
  history: HistoryStats,
  exponent = 2,
): boolean {
  const stat = history.byCurrency[currency.toUpperCase()];
  if (stat && stat.count >= MIN_HISTORY) return amountMinor < stat.median;
  return amountMinor < floorMinor(currency, exponent);
}

type Scored = Omit<FollowUpQuestion, 'kind' | 'score'> & { score: number };
const base = (score: number): Scored => ({ score, places: [], hereNow: false, partners: [] });

function scoreOf(
  kind: FollowUpKind,
  e: SavedExpenseFacts,
  h: HistoryStats,
  env: FollowUpEnvironment,
  prefs: FollowUpPrefs,
  exponent: number,
): Scored | null {
  const category = (e.category ?? '').toLowerCase();
  const stat = h.byCurrency[e.currency.toUpperCase()];
  const median = stat && stat.count >= MIN_HISTORY ? stat.median : null;

  switch (kind) {
    case 'duplicate': {
      const dup = findDuplicate(e, h.recentGroupExpenses, env.nowMs);
      return dup ? { ...base(100), duplicate: dup } : null;
    }
    case 'payer': {
      if (e.scope !== 'group' || !e.payerIsMe) return null;
      const payer = detectOtherPayer(e.description, e.members);
      return payer ? { ...base(75), payer } : null;
    }
    case 'date': {
      if (e.date !== env.today) return null;
      if (saysYesterday(e.description)) {
        return { ...base(70), suggestedDate: addDaysIso(env.today, -1) };
      }
      if (env.hour >= 0 && env.hour < 4)
        return { ...base(45), suggestedDate: addDaysIso(env.today, -1) };
      return null;
    }
    case 'lend': {
      if (e.scope !== 'personal') return null;
      const person = detectLendTarget(e.description);
      return person ? { ...base(62), person } : null;
    }
    case 'currency': {
      if (e.scope !== 'personal' || !env.deviceCurrency) return null;
      const device = env.deviceCurrency.toUpperCase();
      return device !== e.currency.toUpperCase() ? { ...base(60), currency: device } : null;
    }
    case 'trip': {
      if (e.scope !== 'personal') return null;
      const trip = activeTripOn(h.trips, e.date);
      if (!trip) return null;
      return { ...base(55 + (looksLikeTripSpend(e.description, e.category) ? 20 : 0)), trip };
    }
    case 'wrapup': {
      if (e.scope !== 'group' || !e.groupId || prefs.wrapUpShown.includes(e.groupId)) return null;
      const trip = h.trips.find((t) => t.groupId === e.groupId);
      return trip && tripWrapUpDue(trip, env.today) ? { ...base(58), trip } : null;
    }
    case 'recurring': {
      const hit = findRecurring(e, h.pastPersonal, h.recurringRules);
      return hit ? { ...base(52), dayOfMonth: hit.dayOfMonth } : null;
    }
    case 'attendance': {
      if (e.scope !== 'group' || e.members.length <= 2) return null;
      if (!GATHERING_CATEGORIES.has(category)) return null;
      if (e.splitParticipantCount !== e.members.length) return null;
      return base(48);
    }
    case 'place': {
      if (e.hasPlace) return null;
      const here = env.currentPlace?.trim() || null;
      const recents = h.recentPlaces.filter((p) => p && p !== here).slice(0, 3);
      const places = here ? [here, ...recents.slice(0, 2)] : recents;
      if (places.length === 0) return null;
      const score = 45 + (here ? 25 : 0) + (OUTING_CATEGORIES.has(category) ? 10 : 0);
      const lunchOrEvening = (env.hour >= 12 && env.hour <= 14) || env.hour >= 19;
      return { ...base(score + (lunchOrEvening ? 5 : 0)), places, hereNow: here !== null };
    }
    case 'category': {
      if (!categoryUnsure(e)) return null;
      return { ...base(42), categories: suggestCategories(h.topCategories, e.category) };
    }
    case 'receipt': {
      if (e.hasReceipt || !e.canAttachReceipt) return null;
      let score = 15;
      if (RECEIPT_CATEGORIES.has(category)) score += 25;
      const ref = median ?? floorMinor(e.currency, exponent);
      if (ref > 0n) {
        if (e.amountMinor >= ref * 5n) score += 40;
        else if (e.amountMinor >= ref * 3n) score += 28;
        else if (e.amountMinor >= ref * 2n) score += 14;
      }
      return base(score);
    }
    case 'split': {
      if (e.scope !== 'personal') return null;
      const partners = (h.partnersByCategory[category] ?? [])
        .filter((p) => p.count >= 2)
        .slice(0, 3);
      if (partners.length === 0) return null;
      const score =
        25 + Math.min(partners[0]!.count, 5) * 8 + (SOCIAL_CATEGORIES.has(category) ? 10 : 0);
      return { ...base(score), partners };
    }
    case 'payment':
      return e.hasPaymentMethod || !e.canSetPayment ? null : base(31);
    case 'work': {
      if (e.hasNotes && e.scope === 'group') return null;
      if (!WORK_CATEGORIES.has(category) && !looksLikeTripSpend(e.description, e.category))
        return null;
      // "Above the median" needs a median: without history, never guess.
      return median !== null && e.amountMinor > median ? base(32) : null;
    }
  }
}

export interface NextFollowUpInput {
  readonly expense: SavedExpenseFacts;
  readonly history: HistoryStats;
  readonly prefs: FollowUpPrefs;
  readonly session: FollowUpSession;
  readonly env: FollowUpEnvironment;
  /** The currency's decimals; default 2. */
  readonly exponent?: number;
}

/** The next question to ask, or null: nothing more, now or for this expense. */
export function nextFollowUp(input: NextFollowUpInput): FollowUpQuestion | null {
  const { expense, history, prefs, session, env } = input;
  const exponent = input.exponent ?? 2;
  if (!prefs.enabled || session.stopped) return null;
  if (session.asked.length >= MAX_QUESTIONS) return null;
  if (session.consecutiveSkips >= MAX_CONSECUTIVE_SKIPS) return null;
  const small = isSmallSpend(expense.amountMinor, expense.currency, history, exponent);

  let best: FollowUpQuestion | null = null;
  for (const kind of FOLLOW_UP_KINDS) {
    if (session.asked.includes(kind) || isMuted(prefs, kind)) continue;
    if (small && !BYPASSES_SMALL_SPEND.includes(kind)) continue;
    const scored = scoreOf(kind, expense, history, env, prefs, exponent);
    if (!scored) continue;
    const learned = learningFor(prefs, kind, expense.category);
    if (learned.blocked) continue;
    const score = scored.score + learned.delta - 5 * (prefs.skips[kind] ?? 0);
    if (score < MIN_SCORE) continue;
    if (!best || score > best.score) best = { kind, ...scored, score };
  }
  return best;
}

// ── history ────────────────────────────────────────────────────────────────

/** One past expense, from either ledger, reduced to what the stats need. */
export interface HistoryRecord {
  readonly scope: FollowUpScope;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly category: string | null;
  readonly description: string;
  /** YYYY-MM-DD. */
  readonly date: string;
  readonly partners: readonly {
    readonly memberId: string;
    readonly groupId: string;
    readonly name: string;
  }[];
  readonly place: string | null;
  /** Sort key, newest largest (e.g. an ISO date). */
  readonly at: string;
}

export function medianOf(values: readonly bigint[]): bigint | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2n;
}

const MAX_RECENT_PLACES = 8;

export function buildHistoryStats(
  records: readonly HistoryRecord[],
  extras: Partial<Pick<HistoryStats, 'recurringRules' | 'recentGroupExpenses' | 'trips'>> = {},
): HistoryStats {
  const amounts = new Map<string, bigint[]>();
  const partners = new Map<string, Map<string, SplitPartner>>();
  const categoryCount = new Map<string, number>();
  for (const record of records) {
    const currency = record.currency.toUpperCase();
    amounts.set(currency, [...(amounts.get(currency) ?? []), record.amountMinor]);
    const category = (record.category ?? '').toLowerCase();
    if (!category) continue;
    categoryCount.set(category, (categoryCount.get(category) ?? 0) + 1);
    for (const partner of record.partners) {
      const byMember = partners.get(category) ?? new Map<string, SplitPartner>();
      const key = `${partner.groupId}:${partner.memberId}`;
      const seen = byMember.get(key);
      byMember.set(key, { ...partner, count: (seen?.count ?? 0) + 1 });
      partners.set(category, byMember);
    }
  }
  const byCurrency: Record<string, { median: bigint; count: number }> = {};
  for (const [currency, list] of amounts) {
    const median = medianOf(list);
    if (median !== null) byCurrency[currency] = { median, count: list.length };
  }
  const partnersByCategory: Record<string, SplitPartner[]> = {};
  for (const [category, byMember] of partners) {
    partnersByCategory[category] = [...byMember.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    );
  }
  const recentPlaces: string[] = [];
  for (const record of [...records].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))) {
    const place = record.place?.trim();
    if (place && !recentPlaces.includes(place)) recentPlaces.push(place);
    if (recentPlaces.length >= MAX_RECENT_PLACES) break;
  }
  const topCategories = [...categoryCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category]) => category);
  const pastPersonal: PastEntry[] = records
    .filter((r) => r.scope === 'personal')
    .map((r) => ({
      description: r.description,
      amountMinor: r.amountMinor,
      currency: r.currency,
      date: r.date,
    }));
  return {
    byCurrency,
    partnersByCategory,
    recentPlaces,
    topCategories,
    pastPersonal,
    recurringRules: extras.recurringRules ?? [],
    recentGroupExpenses: extras.recentGroupExpenses ?? [],
    trips: extras.trips ?? [],
  };
}

// ── wrap-up ────────────────────────────────────────────────────────────────

/** Which enrichments landed, in the order they were filled: for the closing line. */
export type FilledKind =
  | 'place'
  | 'receipt'
  | 'split'
  | 'payment'
  | 'category'
  | 'date'
  | 'payer'
  | 'currency'
  | 'recurring'
  | 'lend'
  | 'trip'
  | 'work'
  | 'attendance'
  | 'duplicate'
  | 'wrapup';

export function dedupeFilled(filled: readonly FilledKind[]): FilledKind[] {
  return [...new Set(filled)];
}
