/**
 * Making sure a foreign bill carries a rate (ADR-003).
 *
 * A foreign expense saved with `fx = null` hides its conversion on every screen,
 * and the rate used to be something a person had to go and ask for. These are
 * the decisions behind getting one without being asked — whether a bill needs
 * one, which source wins, whether the first rate captured should be pinned for
 * the trip, and which saved bills a backfill should touch.
 *
 * Pure and React-Native-free, so it is tested directly (test/fxAutoRate.test.ts).
 * Nothing here fetches or writes; the callers do, and these only decide.
 */

import { type FxRate, type FxRecord, toFxRecord } from '@waves/core';

import type { ExpenseRow, ExpenseVersionRow } from '../data/types';
import { canEditInline } from './expenseEdit';

/** A bill needs a rate when it is paid in another currency and has none. */
export function needsRate(input: {
  currency: string;
  groupCurrency: string;
  fx: FxRecord | null | undefined;
}): boolean {
  return input.currency !== input.groupCurrency && !input.fx;
}

/**
 * The day to ask the rate source for, or null for "the latest".
 *
 * Today and the future get the latest (there is no published rate for a day that
 * has not happened, and for today the latest *is* that day's); only a bill dated
 * in the past is converted at the rate of the day it was paid.
 */
export function rateDateFor(expenseDate: string | null | undefined, today: string): string | null {
  if (!expenseDate || !/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) return null;
  return expenseDate < today ? expenseDate : null;
}

/**
 * Whether the form should go and fetch a rate on its own: a foreign bill with
 * no rate and no pinned one to take instead. The pinned rate is the group's
 * deliberate choice and always beats a fetch.
 */
export function shouldAutoFetch(input: {
  currency: string;
  groupCurrency: string;
  fx: FxRecord | null | undefined;
  pinned: FxRate | null;
}): boolean {
  return needsRate(input) && input.pinned === null;
}

/**
 * Whether a rate just fetched should become the trip's pinned rate.
 *
 * Only an admin can write `fx_rates` (the RPC refuses anyone else), only the
 * first rate for a currency is pinned — an existing row is something somebody
 * chose and is never overwritten — and only a rate for today: pinning the rate
 * of a bill dated three weeks ago would hand every later bill a stale number.
 */
export function shouldPinFetched(input: {
  isAdmin: boolean;
  pinnedCurrencies: readonly string[];
  currency: string;
  groupCurrency: string;
  forDate: string | null;
}): boolean {
  return (
    input.isAdmin &&
    input.forDate === null &&
    input.currency !== input.groupCurrency &&
    !input.pinnedCurrencies.includes(input.currency)
  );
}

/**
 * Which saved bills a backfill may rewrite.
 *
 * Foreign to the group, no rate on the current version, not deleted, and
 * something this person is allowed and able to rewrite: their own or one they
 * paid (the server's rule), and a split the editor can round-trip — an
 * itemized or adjusted split reopens as equal, so rewriting one would quietly
 * re-split it. Those are left for the person to open by hand.
 */
export function selectBackfill(
  expenses: readonly ExpenseRow[],
  groupCurrency: string,
  myMemberId: string | null,
): ExpenseRow[] {
  if (!myMemberId) return [];
  return expenses.filter((row) => {
    const version = row.currentVersion;
    if (row.deleted_at || !version) return false;
    if (!needsRate({ currency: version.currency, groupCurrency, fx: version.fx })) return false;
    if (!canEditInline(version.split_type)) return false;
    return (
      version.author_member_id === myMemberId ||
      version.payers.some((payer) => payer.member_id === myMemberId)
    );
  });
}

/** How many foreign bills have no rate at all, whoever may fix them. */
export function countMissing(expenses: readonly ExpenseRow[], groupCurrency: string): number {
  return expenses.filter((row) => {
    const version = row.currentVersion;
    return (
      !row.deleted_at &&
      version &&
      needsRate({ currency: version.currency, groupCurrency, fx: version.fx })
    );
  }).length;
}

/** The distinct rates a backfill has to look up: one per currency and day. */
export function fetchKey(currency: string, date: string | null): string {
  return `${currency}|${date ?? 'latest'}`;
}

/**
 * The rate to put on one backfilled bill, or null to leave it alone this time.
 *
 * The trip's pinned rate wins, as it does on the form; failing that, the rate
 * for the bill's own day. A fetch that came back for a different pair than the
 * bill's is never used.
 */
export function backfillRateFor(
  version: Pick<ExpenseVersionRow, 'currency'>,
  groupCurrency: string,
  pinned: FxRate | null,
  fetched: FxRecord | null | undefined,
): FxRecord | null {
  if (pinned && pinned.from === version.currency && pinned.to === groupCurrency) {
    return toFxRecord(pinned);
  }
  if (fetched && fetched.from === version.currency && fetched.to === groupCurrency) return fetched;
  return null;
}
