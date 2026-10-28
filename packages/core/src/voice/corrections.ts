/**
 * Corrections to an expense that was just saved ("no, make it 800", "it was
 * yesterday", "undo"). Pure and offline: most corrections are a number, a day
 * word or a group name, so they cost no LLM turn. Text this cannot read with
 * confidence returns null and falls through to the place matchers or the agent.
 *
 * Money stays exact: amounts come from decimal text through {@link decimalToMinor}
 * and an integer scale, never a float.
 */

import { KNOWN_MINOR_UNIT_EXPONENTS } from '../money/currency';
import { decimalToMinor, foldSpokenAmountWords, spokenNumberValue } from './amounts';
import {
  resolveSpokenGroup,
  resolveSpokenName,
  type VoiceGroupCandidate,
  type VoiceNameCandidate,
} from './names';

/** The saved expense a correction is read against. */
export interface CorrectionTarget {
  readonly kind: 'personal' | 'group';
  readonly groupId: string | null;
  readonly currency: string;
}

export interface CorrectionContext {
  /** The caller's local date, YYYY-MM-DD. */
  readonly today: string;
  /** UI locale; the readers are script- and language-tolerant, so it only breaks ties. */
  readonly locale?: string;
  /** Groups the caller can move an expense to. */
  readonly groups?: readonly VoiceGroupCandidate[];
  /** Members of the saved expense's group, for "paid by Ravi". */
  readonly members?: readonly VoiceNameCandidate[];
}

/** The fields a correction can change. Absent means untouched. */
export interface CorrectionFields {
  readonly amountMinor?: bigint;
  /** YYYY-MM-DD. */
  readonly date?: string;
  readonly description?: string;
  readonly currency?: string;
  /** Move to this group; null moves a group expense to the personal ledger. */
  readonly groupId?: string | null;
  readonly payerMemberId?: string;
}

export type CorrectionField = keyof CorrectionFields;

export type Correction =
  /** One or more fields to change; several can arrive in one sentence. */
  | { readonly kind: 'update'; readonly fields: CorrectionFields }
  /** Remove the expense just saved ("undo", "delete that", "hata do"). */
  | { readonly kind: 'undo' }
  /** Take back the last follow-up answer only ("undo the place"). */
  | { readonly kind: 'undoAnswer' };

/** The names of the fields a correction changes, for telemetry. */
export function correctionFieldNames(fields: CorrectionFields): CorrectionField[] {
  return (Object.keys(fields) as CorrectionField[]).filter((key) => fields[key] !== undefined);
}

/* ─────────────────────────────── helpers ─────────────────────────────── */

const MAX_DESCRIPTION = 120;

function normalise(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[“”"]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parts(date: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function iso(y: number, m: number, d: number): string | null {
  const stamp = new Date(Date.UTC(y, m - 1, d));
  if (stamp.getUTCFullYear() !== y || stamp.getUTCMonth() !== m - 1 || stamp.getUTCDate() !== d) {
    return null;
  }
  return stamp.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string | null {
  const p = parts(date);
  return p ? iso(p.y, p.m, p.d + days) : null;
}

function weekday(date: string): number {
  const p = parts(date);
  return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() : 0;
}

function cut(text: string, start: number, end: number): string {
  return `${text.slice(0, start)} ${text.slice(end)}`.replace(/\s+/g, ' ').trim();
}

/* ─────────────────────────────── undo ─────────────────────────────── */

const UNDO_LEAD = '(?:(?:no|nahi|nahin|please|pls|ok|okay|haan|yaar|arre|oh|oops)[\\s,]+)*';
const UNDO_VERB =
  '(?:undo|cancel|delete|remove|discard|revert|scrap|hata|hatao|hataiye|mita|mitao|wapas|vaapas|हटा|हटाओ|मिटा|वापस|रद्द)';
const UNDO_TAIL =
  '(?:\\s+(?:it|that|this|the expense|that expense|one|last one|kar|karo|kardo|do|de|dena|dijiye|dijiyega|please|pls|wapas|kar do))*';
const UNDO_RE = new RegExp(`^${UNDO_LEAD}${UNDO_VERB}${UNDO_TAIL}[.!]?$`, 'iu');

const UNDO_ANSWER_RE =
  /^(?:(?:no|please|ok|okay)[\s,]+)*(?:undo|revert|take back|remove)\s+(?:the\s+|that\s+|my\s+|last\s+)*(?:place|payment|category|note|answer|reply|split|change|location|currency|receipt|date|amount)(?:\s+(?:answer|please))?[.!]?$/iu;

/* ─────────────────────────────── dates ─────────────────────────────── */

const WEEKDAYS: Readonly<Record<string, number>> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};
const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};
const MONTH_RE = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');
const WEEKDAY_RE = Object.keys(WEEKDAYS)
  .sort((a, b) => b.length - a.length)
  .join('|');

/** Words that put the date in the future: a spent expense is not, so ask instead. */
const FUTURE_RE =
  /(?<![\p{L}])(?:tomorrow|next\s+(?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|aaj\s+raat\s+ko|parso\s+hoga|kal\s+hoga|kal\s+karenge|will\s+be)(?![\p{L}])/iu;

interface DateRead {
  readonly date: string;
  readonly rest: string;
}

function readDate(text: string, today: string): DateRead | null {
  const t = parts(today);
  if (!t) return null;
  let m: RegExpExecArray | null;

  m =
    /(?<![\p{L}])(?:the\s+)?day\s+before\s+yesterday(?![\p{L}])|(?<![\p{L}])parso(?![\p{L}])|परसों/iu.exec(
      text,
    );
  if (m) {
    const date = addDays(today, -2);
    return date ? { date, rest: cut(text, m.index, m.index + m[0].length) } : null;
  }
  // "kal" is yesterday or tomorrow in Hindi; only the past tense settles it.
  m = /(?<![\p{L}])(?:yesterday|yday|last\s+night|कल)(?![\p{L}])/iu.exec(text);
  if (!m) {
    m =
      /(?<![\p{L}])kal(?=\s+(?:tha|thi|the|ko|ki\s+baat|hua|kiya|gaya|gayi|liya)(?![\p{L}]))/iu.exec(
        text,
      );
  }
  if (m) {
    const date = addDays(today, -1);
    return date ? { date, rest: cut(text, m.index, m.index + m[0].length) } : null;
  }
  m = /(?<![\p{L}])(?:today|aaj|आज)(?![\p{L}])/iu.exec(text);
  if (m) return { date: today, rest: cut(text, m.index, m.index + m[0].length) };

  m = /(?<![\p{L}])(\d{1,3})\s+days?\s+(?:ago|back|pehle)(?![\p{L}])/iu.exec(text);
  if (m) {
    const date = addDays(today, -Number(m[1]));
    return date ? { date, rest: cut(text, m.index, m.index + m[0].length) } : null;
  }

  // "last friday", "on friday", "friday": the most recent one before today.
  m = new RegExp(
    `(?<![\\p{L}])(?:(?:on|last|this\\s+past|pichle|pichhle)\\s+)*(${WEEKDAY_RE})(?![\\p{L}])`,
    'iu',
  ).exec(text);
  if (m?.[1]) {
    const target = WEEKDAYS[m[1].toLowerCase()];
    if (target !== undefined) {
      let back = (weekday(today) - target + 7) % 7;
      if (back === 0) back = 7;
      const date = addDays(today, -back);
      if (date) return { date, rest: cut(text, m.index, m.index + m[0].length) };
    }
  }

  // "3 oct", "3rd of october", "october 3rd"
  m = new RegExp(
    `(?<![\\p{L}\\d])(?:on\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})(?![\\p{L}])`,
    'iu',
  ).exec(text);
  let day: number | null = null;
  let month: number | null = null;
  if (m?.[1] && m[2]) {
    day = Number(m[1]);
    month = MONTHS[m[2].toLowerCase()] ?? null;
  } else {
    m = new RegExp(
      `(?<![\\p{L}])(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\p{L}\\d])`,
      'iu',
    ).exec(text);
    if (m?.[1] && m[2]) {
      month = MONTHS[m[1].toLowerCase()] ?? null;
      day = Number(m[2]);
    }
  }
  if (m && day !== null && month !== null) {
    let date = iso(t.y, month, day);
    if (date && date > today) date = iso(t.y - 1, month, day);
    if (date) return { date, rest: cut(text, m.index, m.index + m[0].length) };
  }

  // "on the 3rd": that day of this month, or of last month when it is still ahead.
  m = /(?<![\p{L}\d])(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)(?![\p{L}\d])/iu.exec(text);
  if (m?.[1]) {
    const dayOfMonth = Number(m[1]);
    let date = iso(t.y, t.m, dayOfMonth);
    if (date && date > today)
      date = t.m === 1 ? iso(t.y - 1, 12, dayOfMonth) : iso(t.y, t.m - 1, dayOfMonth);
    if (date) return { date, rest: cut(text, m.index, m.index + m[0].length) };
  }
  return null;
}

/* ─────────────────────────────── currency ─────────────────────────────── */

function readCurrency(text: string): { currency: string; rest: string } | null {
  const m =
    /(?<![\p{L}])(?:in|into|as|currency\s+(?:was|is)?)\s+([A-Za-z]{3})(?![\p{L}])|(?<![\p{L}])([A-Za-z]{3})\s+(?:mein|me)(?![\p{L}])/iu.exec(
      text,
    );
  const code = (m?.[1] ?? m?.[2])?.toUpperCase();
  if (!m || !code || !(code in KNOWN_MINOR_UNIT_EXPONENTS)) return null;
  return { currency: code, rest: cut(text, m.index, m.index + m[0].length) };
}

/** A code stated beside the number ("800 AED", "AED 800"), left in the text. */
function adjacentCurrency(text: string): string | null {
  const m = /(?<![\p{L}])([A-Za-z]{3})\s*\d|\d\s*([A-Za-z]{3})(?![\p{L}])/u.exec(text);
  const code = (m?.[1] ?? m?.[2])?.toUpperCase();
  return code && code in KNOWN_MINOR_UNIT_EXPONENTS ? code : null;
}

/* ─────────────────────────────── amount ─────────────────────────────── */

const SCALE: Readonly<Record<string, bigint>> = {
  k: 1000n,
  thousand: 1000n,
  hazaar: 1000n,
  hazar: 1000n,
  lakh: 100000n,
  lac: 100000n,
  lakhs: 100000n,
  lacs: 100000n,
  crore: 10000000n,
  crores: 10000000n,
  cr: 10000000n,
  m: 1000000n,
  million: 1000000n,
};

const WORD_NUMBER_RE =
  /(?<![\p{L}])(?:(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakh|lac|crore|million|point)(?:[\s-]+(?:and\s+)?|(?![\p{L}])))+/giu;

interface Num {
  readonly start: number;
  readonly end: number;
  /** Exact decimal string with any scale word applied ("8" + "k" -> factor). */
  readonly value: string;
  readonly factor: bigint;
}

function numbersIn(text: string): Num[] {
  // Spoken number words become digits first, so "eight hundred" reads as 800.
  const found: Num[] = [];
  const digit =
    /(?<![\p{L}\d.,])(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s?(k|thousand|hazaar|hazar|lakhs?|lacs?|crores?|cr|million|m)(?![\p{L}\d]))?/giu;
  for (const m of text.matchAll(digit)) {
    const after = text.slice((m.index ?? 0) + m[0].length);
    // 3rd, 2nd: a day, not money.
    if (/^(?:st|nd|rd|th)(?![\p{L}])/iu.test(after)) continue;
    const factor = m[2] ? (SCALE[m[2].toLowerCase()] ?? 1n) : 1n;
    found.push({
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      value: (m[1] ?? '').replace(/,/g, ''),
      factor,
    });
  }
  for (const m of text.matchAll(WORD_NUMBER_RE)) {
    const run = m[0].trim().replace(/\s+and$/i, '');
    const value = spokenNumberValue(run);
    if (value === null) continue;
    const start = m.index ?? 0;
    const end = start + m[0].length;
    // "1.5 lakh" is one number; its scale word is not a second.
    if (found.some((n) => n.start < end && start < n.end)) continue;
    if (found.some((n) => n.end <= start && /^\s*$/.test(text.slice(n.end, start)))) continue;
    found.push({ start, end, value, factor: 1n });
  }
  return found.sort((a, b) => a.start - b.start);
}

/** Which of several numbers is the corrected amount ("800 not 8000", "800 nahi, 8000"). */
function chooseNumber(text: string, nums: readonly Num[]): Num | null {
  if (nums.length === 1) return nums[0] ?? null;
  if (nums.length === 2) {
    const [a, b] = nums as [Num, Num];
    const between = text.slice(a.end, b.start).toLowerCase();
    // "800 not 8000" / "800 instead of 8000" / "800 rather than 8000": the first stands.
    if (/(?<![\p{L}])(?:not|instead\s+of|rather\s+than)(?![\p{L}])/u.test(between)) return a;
    // "800 nahi, 8000": the word rejects what came before it.
    if (/(?<![\p{L}])(?:nahi|nahin|nhi|नहीं)(?![\p{L}])/u.test(between)) return b;
    // "not 8000, 800": the first was the rejected one.
    if (/(?<![\p{L}])(?:not|nahi|nahin)\s*$/u.test(text.slice(0, a.start).toLowerCase())) return b;
  }
  return null;
}

const AMOUNT_CUE =
  /(?<![\p{L}])(?:make|made|change|changed|set|update|amount|price|cost|costs|it'?s|its|it\s+was|that\s+was|was|should\s+be|actually|sorry|rather|instead|nahi|nahin|nhi|not|no|bana|banao|kar\s+do|karo|tha|thi|hai|only|total|came\s+to|rs|inr|rupees?|₹)(?![\p{L}])|₹|नहीं/iu;

function readAmount(text: string, currency: string): { minor: bigint; rest: string } | null {
  const folded = foldSpokenAmountWords(text);
  const nums = numbersIn(folded);
  if (nums.length === 0) return null;
  const only = folded.replace(/[^\p{L}\p{N}₹.,]/gu, ' ').trim();
  const bare =
    nums.length === 1 &&
    only.replace(/₹|rs\.?|rupees?|inr/giu, '').replace(/\s/g, '') ===
      folded.slice(nums[0]?.start ?? 0, nums[0]?.end ?? 0).replace(/\s/g, '');
  if (!bare && !AMOUNT_CUE.test(folded)) return null;
  const chosen = chooseNumber(folded, nums);
  if (!chosen) return null;
  const base = decimalToMinor(chosen.value, currency);
  if (base === null) return null;
  const minor = base * chosen.factor;
  if (minor <= 0n) return null;
  return { minor, rest: folded };
}

/* ─────────────────────────────── description ─────────────────────────────── */

function titleCase(text: string): string {
  const trimmed = text.trim().slice(0, MAX_DESCRIPTION);
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : '';
}

function readDescription(text: string): string | null {
  const clean = text.replace(/[.!?]+$/, '');
  // "it was dinner not lunch": the word before "not" is the right one.
  let m =
    /^(?:(?:no|nahi|actually|sorry|oops)[\s,]+)*(?:it\s+was|that\s+was|it'?s|its|this\s+was)\s+(?:for\s+)?(.{1,80}?)\s+(?:not|nahi|nahin)\s+(.{1,80})$/iu.exec(
      clean,
    );
  if (m?.[1]) return titleCase(m[1]);
  // "call it Team dinner", "rename to Team dinner", "name it Team dinner"
  m =
    /^(?:(?:no|actually|sorry)[\s,]+)*(?:please\s+)?(?:call\s+it|name\s+it|rename(?:\s+it)?(?:\s+to|\s+as)?|change\s+(?:the\s+)?(?:name|title|description)\s+to|make\s+the\s+(?:name|description)|description\s+(?:is|should\s+be))\s+(.{1,200})$/iu.exec(
      clean,
    );
  if (m?.[1]) return titleCase(m[1]);
  return null;
}

/* ─────────────────────────────── group / payer ─────────────────────────────── */

const PERSONAL_RE =
  /^(?:(?:my\s+)?personal|just\s+me|only\s+me|mine|my\s+own|apna|apne\s+liye|personal\s+ledger|spending)$/iu;

const MOVE_RE =
  /^(?:(?:no|actually|sorry|oops)[\s,]+)*(?:please\s+)?(?:(?:move|put|shift|add|file|record|log|save)(?:\s+(?:it|that|this))?\s+(?:to|in|into|under|on)|(?:it|that|this)\s+was\s+(?:in|for|under)|(?:it|that|this)'?s\s+(?:in|for|under)|(?:it|that|this)\s+goes\s+(?:in|to|under)|belongs?\s+(?:in|to))\s+(?:the\s+)?(.{1,60}?)(?:\s+group)?(?:\s+(?:not|instead|nahi).*)?$/iu;

function readGroup(
  text: string,
  target: CorrectionTarget,
  ctx: CorrectionContext,
): { groupId: string | null } | 'unresolved' | null {
  const m = MOVE_RE.exec(text.replace(/[.!?]+$/, ''));
  const name = m?.[1]?.trim();
  if (!m || !name) return null;
  if (PERSONAL_RE.test(name)) return target.kind === 'group' ? { groupId: null } : null;
  const resolved = resolveSpokenGroup(name, ctx.groups ?? [], false);
  if (resolved.status !== 'resolved') return 'unresolved';
  if (resolved.id === target.groupId) return null;
  return { groupId: resolved.id };
}

function readPayer(text: string, ctx: CorrectionContext): string | null {
  const m =
    /(?<![\p{L}])(?:paid\s+by|payer\s+(?:was|is)|(?:it\s+was\s+)?([\p{L}][\p{L}' -]{0,30}?)\s+(?:paid|ne\s+diya|ne\s+pay\s+kiya))(?:\s+([\p{L}][\p{L}' -]{0,30}))?[.!]?\s*$/iu.exec(
      text,
    );
  const heard = (m?.[2] ?? m?.[1])?.trim();
  if (!heard || !ctx.members?.length) return null;
  const resolved = resolveSpokenName(heard, ctx.members);
  if (resolved.status === 'me') return ctx.members.find((x) => x.isMe)?.id ?? null;
  return resolved.status === 'resolved' ? resolved.id : null;
}

/* ─────────────────────────────── entry ─────────────────────────────── */

/**
 * Reads one spoken or typed message as a correction to the expense just saved.
 * Null when it is not one (or is too unsure), so another reader can try it.
 */
export function parseCorrection(
  rawText: string,
  target: CorrectionTarget,
  ctx: CorrectionContext,
): Correction | null {
  const text = normalise(rawText);
  if (!text || text.length > 200) return null;

  if (UNDO_ANSWER_RE.test(text)) return { kind: 'undoAnswer' };
  if (UNDO_RE.test(text)) return { kind: 'undo' };
  // A date in the future is suspicious for an expense: ask rather than guess.
  if (FUTURE_RE.test(text)) return null;

  const fields: { -readonly [K in keyof CorrectionFields]: CorrectionFields[K] } = {};
  let rest = text;

  const description = readDescription(rest);
  if (description) {
    fields.description = description;
    return { kind: 'update', fields };
  }

  const group = readGroup(rest, target, ctx);
  if (group && group !== 'unresolved') {
    fields.groupId = group.groupId;
    return { kind: 'update', fields };
  }

  const payer = target.kind === 'group' ? readPayer(rest, ctx) : null;
  if (payer) {
    fields.payerMemberId = payer;
    return { kind: 'update', fields };
  }

  const currency = readCurrency(rest);
  if (currency) {
    fields.currency = currency.currency;
    rest = currency.rest;
  }

  const date = readDate(rest, ctx.today);
  if (date) {
    fields.date = date.date;
    rest = date.rest;
  }

  const stated = adjacentCurrency(rest);
  const amount = readAmount(rest, fields.currency ?? stated ?? target.currency);
  if (amount) {
    fields.amountMinor = amount.minor;
    if (!fields.currency && stated && stated !== target.currency) fields.currency = stated;
  } else if (fields.date === undefined && fields.currency === undefined) {
    return null;
  }
  // A bare date word inside a longer sentence is not a correction.
  if (
    fields.date !== undefined &&
    fields.amountMinor === undefined &&
    rest.split(/\s+/).length > 6
  ) {
    return null;
  }
  return Object.keys(fields).length > 0 ? { kind: 'update', fields } : null;
}
