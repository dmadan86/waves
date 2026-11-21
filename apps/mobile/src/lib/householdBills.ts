/**
 * Shared bills that fall on the viewer, and the local reminders for them.
 *
 * `groupBillsForPayer` is also the feed the Personal "Upcoming" list can read
 * (this branch has no `personalUpcoming.ts` yet).
 */
import type { GroupRecurringRule } from '@waves/core';

export interface PayerBill {
  readonly ruleId: string;
  readonly groupId: string;
  readonly description: string;
  readonly amount: bigint;
  readonly currency: string;
  /** yyyy-mm-dd of the next payment. */
  readonly date: string;
}

/** Active rules whose payer is `myMemberId`, soonest first, optionally within `horizonDays` of `today`. */
export function groupBillsForPayer(
  rules: readonly GroupRecurringRule[],
  myMemberId: string | null,
  opts: { today?: string; horizonDays?: number } = {},
): PayerBill[] {
  if (!myMemberId) return [];
  const limit =
    opts.today && opts.horizonDays !== undefined ? addDays(opts.today, opts.horizonDays) : null;
  return rules
    .filter((r) => r.status === 'active' && (r.payers[myMemberId] ?? 0n) > 0n)
    .filter((r) => !limit || r.nextDate <= limit)
    .map((r) => ({
      ruleId: r.id,
      groupId: r.groupId,
      description: r.description,
      amount: r.payers[myMemberId] ?? 0n,
      currency: r.currency,
      date: r.nextDate,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function addDays(day: string, n: number): string {
  const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}

export const BILL_REMINDER_HOUR = 10;
export const BILL_LEAD_DAYS = 3;

export interface BillReminder {
  readonly key: string;
  readonly bill: PayerBill;
  readonly kind: 'ahead' | 'today';
  readonly at: Date;
}
export interface HeldBillReminder {
  readonly identifier: string;
  readonly key: string;
  readonly fireAt: number;
}

function at10(day: string): Date {
  return new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), BILL_REMINDER_HOUR);
}

/**
 * What to schedule: 3 days before and on the day, 10:00 local, never in the
 * past, and at most one reminder per calendar day (the day-of one wins; a later
 * bill's lead reminder gives way). Idempotent against what is already held.
 */
export function planBillReminders(
  bills: readonly PayerBill[],
  held: readonly HeldBillReminder[],
  now: Date,
): { add: BillReminder[]; cancel: string[] } {
  const candidates: BillReminder[] = [];
  for (const bill of bills) {
    candidates.push({
      key: `${bill.ruleId}:${bill.date}:today`,
      bill,
      kind: 'today',
      at: at10(bill.date),
    });
    candidates.push({
      key: `${bill.ruleId}:${bill.date}:ahead`,
      bill,
      kind: 'ahead',
      at: at10(addDays(bill.date, -BILL_LEAD_DAYS)),
    });
  }
  const perDay = new Map<string, BillReminder>();
  for (const c of candidates) {
    if (c.at.getTime() <= now.getTime()) continue;
    const day = `${c.at.getFullYear()}-${c.at.getMonth()}-${c.at.getDate()}`;
    const have = perDay.get(day);
    if (!have || (c.kind === 'today' && have.kind === 'ahead')) perDay.set(day, c);
  }
  const want = new Map([...perDay.values()].map((c) => [c.key, c]));
  const cancel: string[] = [];
  const kept = new Set<string>();
  for (const h of held) {
    const w = want.get(h.key);
    if (w && w.at.getTime() === h.fireAt && !kept.has(h.key)) kept.add(h.key);
    else cancel.push(h.identifier);
  }
  return { add: [...want.values()].filter((c) => !kept.has(c.key)), cancel };
}
