/** Pure rules for rentals kept inside a couple/home group (no native imports, so tests can load it). */

import { isViewer } from '@/data/types';
import {
  decodeInvestment,
  decodeProperty,
  decodeTenancy,
  decodeTxn,
  recurringOccurrenceId,
  type PersonalInvestment,
  type PersonalProperty,
  type PersonalTenancy,
  type PersonalTxn,
  type RentLine,
} from '@waves/core';

/** One row of whichever store the screen is reading: Personal's records or a group's. */
export interface RentalRecord {
  readonly id: string;
  readonly record_kind: string;
  readonly data: Record<string, unknown>;
  readonly deleted_at?: string | null;
  /** Group member who wrote it; absent on Personal rows and on a change still in the queue. */
  readonly created_by?: string | null;
}

/** Personal rows unless a group space is open. */
export function selectRentalRecords<T>(
  groupId: string | undefined,
  personal: readonly T[],
  group: readonly T[],
): readonly T[] {
  return groupId ? group : personal;
}

/** The `space` query param a rentals screen carries; empty means Personal. */
export function spaceParams(groupId?: string): { space?: string } {
  return groupId ? { space: groupId } : {};
}

/**
 * Active properties this person added. Each partner's free cap counts their own,
 * so a Pro partner's properties never block a free one. A row still queued has no
 * author yet and is this phone's own.
 */
export function ownActiveProperties(
  records: readonly RentalRecord[],
  myMemberId: string | null,
): number {
  return records.filter(
    (r) =>
      r.record_kind === 'property' &&
      decodeProperty(r.id, r.data).status === 'active' &&
      (!r.created_by || r.created_by === myMemberId),
  ).length;
}

/**
 * The id a rent entry is written under. A full payment of an untouched due date
 * uses the deterministic occurrence id, so two partners tapping "paid in full" for
 * the same month update one record; anything else (a part payment) is a fresh id.
 */
export function rentEntryId(
  groupScoped: boolean,
  ruleId: string,
  fullDueDate: string | null,
  fresh: () => string,
): string {
  return groupScoped && fullDueDate ? recurringOccurrenceId(ruleId, fullDueDate) : fresh();
}

/** What is still owed on the oldest unpaid due: zero when everything is paid (never the full instalment). */
export const outstandingRent = (due: Pick<RentLine, 'amount' | 'paid'> | undefined): bigint =>
  due ? due.amount - due.paid : 0n;

/** A full payment of an untouched due, keyed by the rule that generated it (not today's rule). */
export function fullPaymentOf(
  due: Pick<RentLine, 'amount' | 'paid' | 'date' | 'ruleId'> | undefined,
  amount: bigint,
): { date: string; ruleId: string } | null {
  return due && due.paid === 0n && amount === due.amount
    ? { date: due.date, ruleId: due.ruleId }
    : null;
}

/** Saving in a group needs the viewer's member id, which loads after the records. */
export const writesReady = (groupId: string | undefined, memberId: string | null): boolean =>
  !groupId || !!memberId;

/** The privacy line: a couple is two people; anything else (or not yet known) says members of the group. */
export const e2eeNoteFor = (
  w: { e2eeNote: string; e2eeNoteHome: string },
  type: string | null | undefined,
): string => (type === 'couple' ? w.e2eeNote : w.e2eeNoteHome);

/** Rent received in `month` (YYYY-MM) in one currency: what the household Income figure adds. */
export function rentReceivedInMonth(
  txns: readonly PersonalTxn[],
  month: string,
  currency: string,
): bigint {
  let total = 0n;
  for (const t of txns)
    if (
      t.kind === 'income' &&
      t.category === 'inc.rent' &&
      t.currency === currency &&
      t.date.slice(0, 7) === month
    )
      total += t.amount;
  return total;
}

/** Owner ids (properties, vehicles, licences) from Personal plus every group the person is in: what the orphan sweep must keep. */
export function liveDocPropertyIds(
  ...stores: readonly (readonly RentalRecord[])[]
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const records of stores)
    for (const r of records)
      if (r.record_kind === 'property' || r.record_kind === 'vehicle' || r.record_kind === 'licence')
        ids.add(r.id);
  return ids;
}

export function txnsOf(records: readonly RentalRecord[]): PersonalTxn[] {
  return records.filter((r) => r.record_kind === 'txn').map((r) => decodeTxn(r.id, r.data));
}

/** Only these group types keep rentals; the server refuses the rest. */
export const hasGroupRentals = (type: string | null | undefined): boolean =>
  type === 'couple' || type === 'home';

/** The household home's Rentals row: active properties, and this month's rent received. */
export function groupRentalsSummary(
  records: readonly RentalRecord[],
  month: string,
  currency: string,
): { count: number; received: bigint } {
  return {
    count: records.filter(
      (r) => r.record_kind === 'property' && decodeProperty(r.id, r.data).status === 'active',
    ).length,
    received: rentReceivedInMonth(txnsOf(records), month, currency),
  };
}

export interface PersonalWealth {
  readonly investments: readonly PersonalInvestment[];
  readonly properties: readonly PersonalProperty[];
  readonly tenancies: readonly PersonalTenancy[];
}

/** Investments, properties and tenancies out of either store's rows (a group's hold no investments). */
export function decodeWealth(records: readonly RentalRecord[]): PersonalWealth {
  const investments: PersonalInvestment[] = [];
  const properties: PersonalProperty[] = [];
  const tenancies: PersonalTenancy[] = [];
  for (const r of records) {
    if (r.record_kind === 'investment') investments.push(decodeInvestment(r.id, r.data));
    else if (r.record_kind === 'property') properties.push(decodeProperty(r.id, r.data));
    else if (r.record_kind === 'tenancy') tenancies.push(decodeTenancy(r.id, r.data));
  }
  investments.sort((a, b) => a.name.localeCompare(b.name));
  properties.sort((a, b) => a.name.localeCompare(b.name));
  return { investments, properties, tenancies };
}

/** My member row in a group space. Member rows carry the profile id, never the sign-in account id. */
export function myMemberIdFrom(
  rows: readonly { id: string; profile_id: string | null }[] | undefined,
  profileId: string | null | undefined,
): string | null {
  if (!rows || !profileId) return null;
  return rows.find((m) => isViewer(m, profileId))?.id ?? null;
}
