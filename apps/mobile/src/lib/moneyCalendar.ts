/**
 * Coming up: what is due, when, and what the big, not-every-month bills add up to.
 * Pure, so Personal and couple/family homes share it; the data hook builds the sources.
 */

import { addPlanDays, stepOccurrence, type Cadence } from '@waves/core';

export type DueKind = 'bill' | 'loan' | 'renewal' | 'income' | 'rent';

/** One schedule, from a personal rule or a group rule. */
export interface DueSource {
  readonly id: string;
  readonly title: string;
  readonly sub: string;
  readonly kind: DueKind;
  readonly amount: bigint;
  readonly currency: string;
  readonly cadence: Cadence;
  readonly interval: number;
  readonly secondDay: number | null;
  readonly anchorDate: string;
  readonly nextDate: string;
  readonly endDate: string | null;
  readonly autoPay: boolean;
  readonly income: boolean;
  /** The "Set aside for big bills" rule itself: a fund, never a due item. */
  readonly reserved: boolean;
  /** Where tapping the item opens its rule. */
  readonly href: string;
}

export interface DueItem {
  readonly key: string;
  readonly sourceId: string;
  readonly kind: DueKind;
  readonly title: string;
  readonly sub: string;
  readonly date: string;
  readonly amount: bigint;
  readonly currency: string;
  readonly income: boolean;
  readonly autoPay: boolean;
  readonly inDays: number;
  readonly href: string;
  /** Paid for out of the big-bills fund. */
  readonly covered?: boolean;
}

export type DueTag = 'overdue' | 'auto' | 'setAside' | 'renew' | 'inDays';
export type DueFilter = 'all' | 'bills' | 'loans' | 'renewals' | 'income';

/** Category ids are free-form strings; this is the one place they become a kind. */
export function classifyKind(category: string | null, income: boolean, rent: boolean): DueKind {
  if (income) return rent ? 'rent' : 'income';
  const c = (category ?? '').toLowerCase();
  if (c.includes('loan') || c.includes('emi')) return 'loan';
  if (c.includes('insur') || c.includes('renew') || c.includes('vehicle')) return 'renewal';
  return 'bill';
}

const DAY = 864e5;
export const daysFrom = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

const CAP = 400;

/** Occurrences from `today` to `to`, plus the one overdue occurrence a rule is sitting on. */
export function expandDue(sources: readonly DueSource[], today: string, to: string): DueItem[] {
  const out: DueItem[] = [];
  for (const s of sources) {
    if (s.reserved || s.nextDate === '') continue;
    let d = s.nextDate;
    let first = true;
    for (let guard = 0; guard < CAP && d <= to; guard += 1) {
      if (s.endDate !== null && d > s.endDate) break;
      if (d >= today || first) {
        out.push({
          key: `${s.id}:${d}`,
          sourceId: s.id,
          kind: s.kind,
          title: s.title,
          sub: s.sub,
          date: d,
          amount: s.amount,
          currency: s.currency,
          income: s.income,
          autoPay: s.autoPay,
          inDays: daysFrom(today, d),
          href: s.href,
        });
      }
      first = false;
      const next = stepOccurrence(s, d);
      if (next <= d) break;
      d = next;
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

/** What is going out in the default currency, and which other currencies are left out. */
export function summarizeDue(items: readonly DueItem[], dc: string) {
  let total = 0n;
  let count = 0;
  const others = new Set<string>();
  for (const i of items) {
    if (i.income) continue;
    if (i.currency !== dc) others.add(i.currency);
    else {
      total += i.amount;
      count += 1;
    }
  }
  return { total, count, others: [...others].sort() };
}

export function dueTag(item: DueItem): DueTag {
  if (item.inDays < 0 && !item.autoPay) return 'overdue';
  if (item.autoPay) return 'auto';
  if (item.covered) return 'setAside';
  if (item.kind === 'renewal') return 'renew';
  return 'inDays';
}

/** The fund pays the soonest big bills first; a bill it cannot fully cover stays open. */
export function allocateFund(items: readonly DueItem[], fund: bigint): DueItem[] {
  let left = fund;
  return items.map((i) => {
    if (i.income || left < i.amount || i.amount <= 0n) return i;
    left -= i.amount;
    return { ...i, covered: true };
  });
}

const isBigSchedule = (s: DueSource): boolean =>
  s.cadence === 'yearly' || (s.cadence === 'monthly' && s.interval >= 3);

const isOneOff = (s: DueSource): boolean =>
  s.endDate !== null && stepOccurrence(s, s.nextDate) > s.endDate;

export interface BigBillItem {
  readonly sourceId: string;
  readonly title: string;
  readonly sub: string;
  readonly kind: DueKind;
  readonly total: bigint;
  readonly dates: readonly string[];
}

/** The next twelve months of costs that do not come every month, in the default currency. */
export function bigBills(
  sources: readonly DueSource[],
  today: string,
  dc: string,
  oneOffMin: bigint,
) {
  const end = addPlanDays(today, 365);
  const big = sources.filter(
    (s) =>
      !s.income &&
      s.currency === dc &&
      (isBigSchedule(s) || (isOneOff(s) && s.amount >= oneOffMin)),
  );
  const all = expandDue(big, today, end).filter((i) => i.inDays >= 0);
  const monthTotals: bigint[] = Array.from({ length: 12 }, () => 0n);
  const startMonth = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1;
  const bySource = new Map<string, { item: BigBillItem; total: bigint }>();
  let total = 0n;
  for (const i of all) {
    const idx = Number(i.date.slice(0, 4)) * 12 + Number(i.date.slice(5, 7)) - 1 - startMonth;
    if (idx >= 0 && idx < 12) monthTotals[idx] = monthTotals[idx]! + i.amount;
    total += i.amount;
    const prev = bySource.get(i.sourceId);
    bySource.set(i.sourceId, {
      total: (prev?.total ?? 0n) + i.amount,
      item: {
        sourceId: i.sourceId,
        title: i.title,
        sub: i.sub,
        kind: i.kind,
        total: 0n,
        dates: [...(prev?.item.dates ?? []), i.date],
      },
    });
  }
  const items = [...bySource.values()]
    .map((v) => ({ ...v.item, total: v.total }))
    .sort((a, b) => (a.total > b.total ? -1 : a.total < b.total ? 1 : 0));
  return {
    items,
    occurrences: all,
    total,
    perMonth: (total + 11n) / 12n,
    monthTotals,
  };
}

/** On track = what is due in the next 90 days is already covered by the fund. */
export function bigBillsStatus(
  occurrences: readonly DueItem[],
  fund: bigint,
): { onTrack: boolean; ratio: number } {
  const soon = occurrences.filter((i) => i.inDays <= 90).reduce((s, i) => s + i.amount, 0n);
  const total = occurrences.reduce((s, i) => s + i.amount, 0n);
  return {
    onTrack: fund >= soon,
    ratio: total > 0n ? Math.min(1, Number((fund * 1000n) / total) / 1000) : 0,
  };
}

// ─────────────────────────────────────────────────────────────── calendar ──

export interface DayCell {
  readonly day: number;
  readonly date: string;
  readonly kinds: readonly DueKind[];
}

/** A Monday-first month grid: null for the leading blanks, a cell per day. */
export function monthGrid(month: string, items: readonly DueItem[]): (DayCell | null)[] {
  const first = `${month}-01`;
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const days = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate();
  const cells: (DayCell | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= days; day += 1) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    const kinds = [...new Set(items.filter((i) => i.date === date).map((i) => i.kind))];
    cells.push({ day, date, kinds });
  }
  return cells;
}

export function filterItems(items: readonly DueItem[], filter: DueFilter): DueItem[] {
  switch (filter) {
    case 'bills':
      return items.filter((i) => i.kind === 'bill');
    case 'loans':
      return items.filter((i) => i.kind === 'loan');
    case 'renewals':
      return items.filter((i) => i.kind === 'renewal');
    case 'income':
      return items.filter((i) => i.kind === 'income' || i.kind === 'rent');
    default:
      return [...items];
  }
}

/** Money spent on the fund so far: posted entries of its rules, default currency. */
export function fundSoFar(
  txns: readonly { recurringId?: string | null; amount: bigint; currency: string }[],
  fundRuleIds: ReadonlySet<string>,
  dc: string,
): bigint {
  let sum = 0n;
  for (const t of txns)
    if (t.recurringId && fundRuleIds.has(t.recurringId) && t.currency === dc) sum += t.amount;
  return sum;
}

/** The fund rule's marker. An `inv.` category: money moved to your own fund, so Spent, Reports and Budgets skip it. */
export const FUND_CATEGORY = 'inv.bigbills';
