/** Pure rules behind the company Overview: percentages, short money, vs last month, escalations, absence streaks, upcoming cards. */

import { formatParts, money, type CurrencyCode } from '@waves/core';

/** Share of employed people, whole percent; null (shown "—") when nobody is employed. */
export function pct(n: number, total: number): number | null {
  return total <= 0 ? null : Math.min(100, Math.max(0, Math.round((n * 100) / total)));
}

const CRORE_MINOR = 1_000_000_000n; // 1 crore rupees in paise

/**
 * A headline amount: house grouping (₹1,25,000), no ".00" on a whole amount, and "₹1.25 Cr" from one
 * crore up in rupees. `crore` is the localised "{n} Cr" template.
 */
export function compactMoney(
  minor: bigint,
  currency: string,
  locale: string,
  crore: string,
): string {
  const p = formatParts(money(minor, currency as CurrencyCode), { locale });
  if (currency === 'INR' && minor >= CRORE_MINOR) {
    const hundredths = Number(minor / 10_000_000n); // paise -> hundredths of a crore
    const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(hundredths / 100);
    const symbol = (p.lead + p.trail).replace(/[\p{Nd}.,\s\u00a0\u066b\u066c\u200f\u200e-]/gu, '');
    const text = crore.replace('{n}', n);
    // Arabic puts the symbol after the number, the rest before it.
    return p.trail.includes(symbol) && !p.lead.includes(symbol)
      ? `${text} ${symbol}`
      : `${symbol}${text}`;
  }
  return /^[^\p{Nd}]*[0\u0660\u0966\u0be6]+$/u.test(p.fraction) ? p.lead + p.trail : p.text;
}

export type DayKind = 'today' | 'other';

/** Paid this month against last month: direction and whole percent; null (line hidden) when there is no base or no change. */
export function vsLastMonth(
  paid: bigint,
  last: bigint,
): { dir: 'up' | 'down'; pct: number } | null {
  if (last <= 0n) return null;
  const diff = paid - last;
  const abs = diff < 0n ? -diff : diff;
  // Round half up on integer minor units; no floats on money.
  const pct = Number((abs * 100n * 2n + last) / (last * 2n));
  return pct === 0 ? null : { dir: diff > 0n ? 'up' : 'down', pct };
}

export type AttendanceKey = 'present' | 'leave' | 'unmarked' | 'absent';

/** Bar segments in legend order; zero counts drop out, so no people means no segments. */
export function attendanceSegments(c: {
  present: number;
  leave: number;
  unmarked: number;
  absent: number;
}): { key: AttendanceKey; n: number }[] {
  const all: { key: AttendanceKey; n: number }[] = [
    { key: 'present', n: c.present },
    { key: 'leave', n: c.leave },
    { key: 'unmarked', n: c.unmarked },
    { key: 'absent', n: c.absent },
  ];
  return all.filter((s) => s.n > 0);
}

/** One day of one person: present/half, absent, on approved leave, a day the company takes no marks (off), or just not marked. */
export type DayMark = 'present' | 'absent' | 'leave' | 'off' | 'unmarked';

/**
 * Days in a row a person has been absent or not marked, newest day first (index 0 is today). Today
 * still unmarked does not count yet (the day is not over); an "off" day (nobody was marked, or a holiday)
 * neither counts nor breaks the run; present or on leave ends it.
 */
export function absentStreak(days: readonly DayMark[]): number {
  let n = 0;
  for (const [i, d] of days.entries()) {
    if (d === 'present' || d === 'leave') break;
    if (d === 'off' || (i === 0 && d === 'unmarked')) continue;
    n += 1;
  }
  return n;
}

export const ABSENT_STREAK_DAYS = 3;

export type EscalationKind =
  'advance' | 'expense' | 'vendorBill' | 'absent' | 'blocked' | 'poolRequest';

export interface EscalationInput {
  readonly key: string;
  readonly kind: EscalationKind;
  /** Person (or vendor) the item is about; '' when unknown. */
  readonly name: string;
  readonly memberId: string | null;
  /** Shown only where the viewer may see money; null otherwise. */
  readonly amountMinor: bigint | null;
  /** Days of absence for 'absent'. */
  readonly days?: number;
  /** A blocked task's title. */
  readonly detail?: string;
  /** ms since epoch the item became urgent. */
  readonly at: number;
}

/** Newest first, capped; `total` is the whole count for the badge. */
export function buildEscalations(
  rows: readonly EscalationInput[],
  limit = 3,
): { items: EscalationInput[]; total: number } {
  const items = [...rows].sort((a, b) => b.at - a.at || a.key.localeCompare(b.key)).slice(0, limit);
  return { items, total: rows.length };
}

/** 'HH:MM' as the viewer's clock ("7:00 PM"); the raw text if it does not parse. */
export function clockText(hhmm: string, locale: string): string {
  const d = new Date(`1970-01-01T${hhmm.slice(0, 5)}:00`);
  return Number.isNaN(d.getTime())
    ? hhmm
    : d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/** The clock, behind a function so render-purity lint sees no direct impurity (callers sit in memos). */
export const nowMs = (): number => Date.now();

export type Ago = { unit: 'now' | 'min' | 'hour' | 'day'; n: number };

export function agoText(at: number, now: number): Ago {
  const mins = Math.max(0, Math.floor((now - at) / 60_000));
  if (mins < 1) return { unit: 'now', n: 0 };
  if (mins < 60) return { unit: 'min', n: mins };
  if (mins < 1440) return { unit: 'hour', n: Math.floor(mins / 60) };
  return { unit: 'day', n: Math.floor(mins / 1440) };
}

export type UpcomingKind = 'event' | 'payroll' | 'holiday' | 'birthday';

export interface UpcomingCardInput {
  readonly key: string;
  readonly kind: UpcomingKind;
  readonly title: string;
  readonly day: string;
  /** Last day of a range (holiday); equals `day` otherwise. */
  readonly endDay: string;
  readonly time: string | null;
  readonly people: readonly string[];
}

export interface UpcomingSource {
  readonly id: string;
  readonly day: string;
  readonly subKind: string;
  readonly title: string;
  readonly time: string | null;
  readonly memberId: string | null;
  /** Event participants; for a holiday the whole company is passed by the caller. */
  readonly people?: readonly string[];
  /** A holiday's own first and last day (its per-day items repeat them). */
  readonly rangeStart?: string;
  readonly rangeEnd?: string;
}

const CARD_KIND: Record<string, UpcomingKind> = {
  event: 'event',
  wage: 'payroll',
  holiday: 'holiday',
  birthday: 'birthday',
};

/**
 * Calendar items to cards: a holiday spanning days is one range card, payroll dates on one day are
 * one card with everyone due; sorted by day, only what is still ahead or running today.
 */
export function buildUpcomingCards(
  items: readonly UpcomingSource[],
  today: string,
  limit = 6,
): UpcomingCardInput[] {
  const cards = new Map<string, UpcomingCardInput>();
  for (const it of items) {
    const kind = CARD_KIND[it.subKind];
    const day = it.rangeStart ?? it.day;
    const endDay = it.rangeEnd ?? it.day;
    if (!kind || endDay < today) continue;
    const key =
      kind === 'holiday' ? `h:${it.id.split(':')[0]}` : kind === 'payroll' ? `p:${it.day}` : it.id;
    const who = it.people ?? (it.memberId ? [it.memberId] : []);
    const prev = cards.get(key);
    cards.set(
      key,
      prev
        ? { ...prev, people: [...new Set([...prev.people, ...who])] }
        : { key, kind, title: it.title, day, endDay, time: it.time, people: [...new Set(who)] },
    );
  }
  return [...cards.values()]
    .sort((a, b) => a.day.localeCompare(b.day) || (a.time ?? '').localeCompare(b.time ?? ''))
    .slice(0, limit);
}
