/**
 * The Vendors tab of an Event group (docs/event-organizer.md): every vendor
 * advance on the group, grouped by vendor, with what is still owed, when, and
 * what has been paid off.
 *
 * Pure and React-Native-free, so it is tested directly
 * (test/eventVendors.test.ts). `today` is a parameter, same reason as
 * `upcomingPayments`. A vendor is the expense description, folded for case and
 * whitespace so "DJ Rohan" and " dj  rohan " are one vendor.
 */

import { isBalanceOverdue } from './upcomingPayments';

/** One expense, trimmed to what the vendors view needs. */
export interface VendorCandidate {
  readonly expenseId: string;
  readonly description: string;
  readonly currency: string;
  /** The amount paid (the advance when `isDeposit`), in minor units. */
  readonly amountMinor: bigint;
  readonly isDeposit: boolean;
  readonly balanceDueMinor: bigint | null;
  readonly balanceDueDate: string | null;
  readonly subEventId: string | null;
  /** Member who put the money in (the first payer), or null. */
  readonly payerMemberId: string | null;
  /** ISO day of the expense, for ordering within a vendor. */
  readonly expenseDate: string;
}

export enum VendorStatus {
  Overdue = 'overdue',
  Due = 'due',
  PaidOff = 'paidOff',
}

export type VendorFilter = 'all' | 'due' | 'overdue' | 'paidOff';

/** One advance (a deposit expense) of a vendor. */
export interface VendorEntry {
  readonly expenseId: string;
  readonly currency: string;
  readonly advanceMinor: bigint;
  /** What is still owed; 0n once paid off. */
  readonly balanceMinor: bigint;
  readonly balanceDueDate: string | null;
  readonly status: VendorStatus;
  /** Due within {@link DUE_SOON_DAYS} days (and not yet overdue). */
  readonly dueSoon: boolean;
  readonly subEventId: string | null;
  readonly payerMemberId: string | null;
  readonly expenseDate: string;
}

export interface CurrencyTotals {
  readonly currency: string;
  readonly advancesMinor: bigint;
  readonly balanceMinor: bigint;
}

export interface VendorGroup {
  /** Normalised name, the merge key. */
  readonly key: string;
  /** The name as most recently typed (trimmed). */
  readonly name: string;
  readonly entries: readonly VendorEntry[];
  readonly totals: readonly CurrencyTotals[];
  readonly status: VendorStatus;
}

export interface VendorSummary {
  readonly totals: readonly CurrencyTotals[];
  readonly overdueCount: number;
  readonly dueCount: number;
  readonly paidOffCount: number;
}

export const DUE_SOON_DAYS = 7;

/** Fold a vendor name so letter case and spacing do not split one vendor. */
export function vendorKey(description: string): string {
  return description.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000;
}

function isDueSoon(date: string | null, today: string): boolean {
  if (date === null || date < today) return false;
  return dayNumber(date) - dayNumber(today) <= DUE_SOON_DAYS;
}

function totalsOf(entries: readonly VendorEntry[]): CurrencyTotals[] {
  const map = new Map<string, { advances: bigint; balance: bigint }>();
  for (const entry of entries) {
    const row = map.get(entry.currency) ?? { advances: 0n, balance: 0n };
    row.advances += entry.advanceMinor;
    row.balance += entry.balanceMinor;
    map.set(entry.currency, row);
  }
  return [...map]
    .map(([currency, v]) => ({ currency, advancesMinor: v.advances, balanceMinor: v.balance }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

const statusRank = (s: VendorStatus): number =>
  s === VendorStatus.Overdue ? 0 : s === VendorStatus.Due ? 1 : 2;

function worst(entries: readonly VendorEntry[]): VendorStatus {
  if (entries.some((e) => e.status === VendorStatus.Overdue)) return VendorStatus.Overdue;
  if (entries.some((e) => e.status === VendorStatus.Due)) return VendorStatus.Due;
  return VendorStatus.PaidOff;
}

interface Slot {
  name: string;
  entries: VendorEntry[];
  latest: string;
}

/** The vendor advances (deposit expenses) as entries, keyed by vendor. */
function collect(candidates: readonly VendorCandidate[], today: string): Map<string, Slot> {
  const byVendor = new Map<string, Slot>();
  for (const c of candidates) {
    if (!c.isDeposit) continue;
    const key = vendorKey(c.description);
    if (key === '') continue;
    const balance = c.balanceDueMinor != null && c.balanceDueMinor > 0n ? c.balanceDueMinor : 0n;
    const owing = balance > 0n;
    const entry: VendorEntry = {
      expenseId: c.expenseId,
      currency: c.currency.toUpperCase(),
      advanceMinor: c.amountMinor,
      balanceMinor: balance,
      balanceDueDate: owing ? c.balanceDueDate : null,
      status: !owing
        ? VendorStatus.PaidOff
        : isBalanceOverdue(c.balanceDueDate, today)
          ? VendorStatus.Overdue
          : VendorStatus.Due,
      dueSoon: owing && isDueSoon(c.balanceDueDate, today),
      subEventId: c.subEventId,
      payerMemberId: c.payerMemberId,
      expenseDate: c.expenseDate,
    };
    const slot = byVendor.get(key) ?? { name: '', entries: [], latest: '' };
    slot.entries.push(entry);
    if (slot.name === '' || c.expenseDate >= slot.latest) {
      slot.latest = c.expenseDate;
      slot.name = c.description.trim().replace(/\s+/g, ' ');
    }
    byVendor.set(key, slot);
  }
  return byVendor;
}

function entryOrder(a: VendorEntry, b: VendorEntry): number {
  if (a.status !== b.status) return statusRank(a.status) - statusRank(b.status);
  if (a.balanceDueDate !== b.balanceDueDate) {
    if (a.balanceDueDate === null) return 1;
    if (b.balanceDueDate === null) return -1;
    return a.balanceDueDate < b.balanceDueDate ? -1 : 1;
  }
  return a.expenseDate < b.expenseDate ? -1 : a.expenseDate > b.expenseDate ? 1 : 0;
}

/** Whether an entry passes the status filter and (optionally) a sub-event. */
export function entryMatches(
  entry: VendorEntry,
  filter: VendorFilter,
  subEventId: string | null,
): boolean {
  if (subEventId !== null && entry.subEventId !== subEventId) return false;
  switch (filter) {
    case 'due':
      return entry.status !== VendorStatus.PaidOff;
    case 'overdue':
      return entry.status === VendorStatus.Overdue;
    case 'paidOff':
      return entry.status === VendorStatus.PaidOff;
    default:
      return true;
  }
}

/**
 * Vendors, grouped and filtered. Vendors needing attention first (overdue,
 * then owing, then paid off), then by name. Entries that fail the filter are
 * dropped, and a vendor with none left is dropped.
 */
export function groupVendors(
  candidates: readonly VendorCandidate[],
  today: string,
  filter: VendorFilter = 'all',
  subEventId: string | null = null,
): readonly VendorGroup[] {
  const groups: VendorGroup[] = [];
  for (const [key, slot] of collect(candidates, today)) {
    const entries = slot.entries
      .filter((entry) => entryMatches(entry, filter, subEventId))
      .sort(entryOrder);
    if (entries.length === 0) continue;
    groups.push({
      key,
      name: slot.name,
      entries,
      totals: totalsOf(entries),
      status: worst(entries),
    });
  }
  return groups.sort(
    (a, b) => statusRank(a.status) - statusRank(b.status) || a.name.localeCompare(b.name),
  );
}

/** The header figures over every vendor: advances paid and balance still due
 *  (per currency), and how many advances are overdue / owing / paid off. */
export function vendorSummary(
  candidates: readonly VendorCandidate[],
  today: string,
  subEventId: string | null = null,
): VendorSummary {
  const all: VendorEntry[] = [];
  for (const slot of collect(candidates, today).values()) {
    all.push(...slot.entries.filter((e) => entryMatches(e, 'all', subEventId)));
  }
  return {
    totals: totalsOf(all),
    overdueCount: all.filter((e) => e.status === VendorStatus.Overdue).length,
    dueCount: all.filter((e) => e.status === VendorStatus.Due).length,
    paidOffCount: all.filter((e) => e.status === VendorStatus.PaidOff).length,
  };
}

/** One vendor balance still owed, for the Plan screen's "Upcoming payments". */
export interface UpcomingVendorPayment {
  readonly expenseId: string;
  readonly vendorName: string;
  readonly subEventId: string | null;
  readonly currency: string;
  readonly balanceMinor: bigint;
  readonly dueDate: string | null;
  readonly overdue: boolean;
  readonly dueSoon: boolean;
}

/**
 * What is still OWED, from the same data as the Vendors tab (one source of
 * truth): every advance with a balance above zero, soonest first (overdue ones
 * therefore first), undated last. An advance already paid off, or a plain
 * expense, never appears.
 */
export function upcomingVendorPayments(
  candidates: readonly VendorCandidate[],
  today: string,
): readonly UpcomingVendorPayment[] {
  const rows: UpcomingVendorPayment[] = [];
  for (const slot of collect(candidates, today).values()) {
    for (const entry of slot.entries) {
      if (entry.balanceMinor <= 0n) continue;
      rows.push({
        expenseId: entry.expenseId,
        vendorName: slot.name,
        subEventId: entry.subEventId,
        currency: entry.currency,
        balanceMinor: entry.balanceMinor,
        dueDate: entry.balanceDueDate,
        overdue: entry.status === VendorStatus.Overdue,
        dueSoon: entry.dueSoon,
      });
    }
  }
  return rows.sort((a, b) => {
    if (a.dueDate === b.dueDate) return a.vendorName.localeCompare(b.vendorName);
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  });
}

/** The distinct sub-event ids advances are tagged with, for the filter chips. */
export function vendorSubEventIds(candidates: readonly VendorCandidate[]): readonly string[] {
  return [
    ...new Set(
      candidates.filter((c) => c.isDeposit && c.subEventId).map((c) => c.subEventId as string),
    ),
  ];
}
