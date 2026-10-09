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

import { type FxRate, type FxRecord, toFxRecord, usableFx } from '@waves/core';

import { isViewer, type ExpenseRow, type ExpenseVersionRow, type MemberRow } from '../data/types';
import { canEditInline } from './expenseEdit';

/**
 * Today as the person sees it: the LOCAL calendar day, as YYYY-MM-DD. The date
 * picker works in local days, so comparing it with a UTC "today" calls
 * yesterday's bill today's (or the reverse) for hours either side of midnight.
 */
export function localToday(now: Date = new Date()): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

/**
 * A bill needs a rate when it is paid in another currency and has none that
 * converts it into the group's: no `fx` at all, or one the balances would not
 * use (into some other currency, or malformed). The same test core's
 * `usableFx` applies when a group settles in its own currency, so a bill this
 * calls fine is a bill that converts.
 */
export function needsRate(input: {
  currency: string;
  groupCurrency: string;
  fx: FxRecord | null | undefined;
}): boolean {
  if (input.currency === input.groupCurrency) return false;
  return usableFx(input.fx ?? null, input.currency, input.groupCurrency) === null;
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
 * Whether saving a bill should pin the rate it carries for the trip.
 *
 * Decided at SAVE, never when a rate is merely fetched: opening the form and
 * picking a currency must not write to the group. Only an admin can write
 * `fx_rates`; only when the bill is saved with the very rate the form fetched
 * on its own (not one typed or derived since), only a rate for today (pinning
 * the rate of a bill dated three weeks ago would hand every later bill a stale
 * number), and only for a currency with no pin yet. The write itself is
 * "insert only if absent" on the server, so a stale view cannot overwrite an
 * admin's deliberate rate.
 */
export function shouldPinOnSave(input: {
  isAdmin: boolean;
  pinnedCurrencies: readonly string[];
  currency: string;
  groupCurrency: string;
  fx: FxRecord | null;
  fetched: { record: FxRecord; forDate: string | null } | null;
}): FxRecord | null {
  const { fx, fetched } = input;
  if (!input.isAdmin || !fx || !fetched || fetched.forDate !== null) return null;
  if (input.currency === input.groupCurrency || input.pinnedCurrencies.includes(input.currency)) {
    return null;
  }
  const r = fetched.record;
  const same =
    fx.from === r.from &&
    fx.to === r.to &&
    fx.num === r.num &&
    fx.den === r.den &&
    fx.ts === r.ts &&
    fx.source === r.source;
  return same && fx.from === input.currency && fx.to === input.groupCurrency ? fx : null;
}

/**
 * Whether this person may save a new version of a bill: its author or one of
 * its payers (the server's rule). `myMemberId` must already exclude a member
 * who has left; `activeMemberId` does that.
 */
export function canRewrite(
  version: Pick<ExpenseVersionRow, 'author_member_id' | 'payers'> | null | undefined,
  myMemberId: string | null,
): boolean {
  return Boolean(
    myMemberId &&
    version &&
    (version.author_member_id === myMemberId ||
      version.payers.some((payer) => payer.member_id === myMemberId)),
  );
}

/** The viewer's member id in the group, or null if they have left (or never were in it). */
export function activeMemberId(
  members: readonly Pick<MemberRow, 'id' | 'profile_id' | 'left_at'>[],
  viewerId: string | null | undefined,
): string | null {
  return members.find((m) => isViewer(m, viewerId) && m.left_at === null)?.id ?? null;
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
    return canRewrite(version, myMemberId);
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
