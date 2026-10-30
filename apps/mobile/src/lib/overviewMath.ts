/** Pure rules behind the company Overview: percentages, short money, day labels, due text, urgent list, upcoming rows. */

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

export type DayKind = 'today' | 'yesterday' | 'other';

export function dayKind(iso: string, today: string): DayKind {
  if (iso === today) return 'today';
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10) === iso ? 'yesterday' : 'other';
}

export type DueText =
  | { kind: 'overdue' }
  | { kind: 'today' }
  | { kind: 'tomorrow' }
  | { kind: 'in'; n: number }
  | { kind: 'owedNow' };

/** Real due dates only: null date means we know of none, so it is "owed now". */
export function dueText(date: string | null, today: string): DueText {
  if (!date) return { kind: 'owedNow' };
  const days = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  if (days < 0) return { kind: 'overdue' };
  if (days === 0) return { kind: 'today' };
  if (days === 1) return { kind: 'tomorrow' };
  return { kind: 'in', n: days };
}

export interface UpcomingInput {
  readonly key: string;
  readonly kind: 'salary' | 'bill';
  readonly memberId: string | null;
  readonly title: string;
  readonly amountMinor: bigint;
  /** ISO due day when the app really knows one (a recurring bill); null for "owed now". */
  readonly date: string | null;
}

/** Owed-now first (biggest first), then by real due date; capped. */
export function sortUpcoming(rows: readonly UpcomingInput[], limit = 3): UpcomingInput[] {
  return [...rows]
    .sort((a, b) => {
      const ak = a.date ?? '0000-00-00';
      const bk = b.date ?? '0000-00-00';
      if (ak !== bk) return ak < bk ? -1 : 1;
      return a.amountMinor === b.amountMinor ? 0 : a.amountMinor > b.amountMinor ? -1 : 1;
    })
    .slice(0, limit);
}

export interface UrgentInput {
  readonly absent: number;
  readonly paymentsPending: number;
  readonly blockedTasks: number;
  readonly approvals: number;
  readonly vendorBills: number;
}

export type UrgentKey = keyof UrgentInput;

/** Non-zero reasons, in the mockup's order; the card lists the first three and counts them all. */
export function urgentItems(u: UrgentInput): { key: UrgentKey; n: number }[] {
  return (['absent', 'paymentsPending', 'blockedTasks', 'approvals', 'vendorBills'] as const)
    .filter((key) => u[key] > 0)
    .map((key) => ({ key, n: u[key] }));
}

/** Where the Urgent card goes: the screen of its first reason (Pending only knows approvals and bills). */
export function urgentRoute(items: readonly { key: UrgentKey }[]): string {
  const first = items[0]?.key;
  return first === 'absent'
    ? 'company-attendance'
    : first === 'paymentsPending'
      ? 'company-payments'
      : first === 'blockedTasks'
        ? 'company-work'
        : 'company-pending';
}
