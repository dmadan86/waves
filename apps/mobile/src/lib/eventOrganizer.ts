/**
 * The one rule for the event-organizer feature (docs/event-organizer.md):
 * vendor tools (Vendor deposit, balance due, the Vendors tab, upcoming vendor
 * payments, sub-event budgets and tags) belong to Event groups and nowhere
 * else. Every screen asks these helpers instead of comparing the type itself,
 * so a new surface cannot quietly leak vendor UI into a Trip or Home group;
 * `test/vendorUiGuard.test.ts` fails the build when a screen forgets to ask.
 */

import { GroupType } from '@/data/types';

/** True only for an Event group. `null`/`undefined` (group still loading, or
 *  an unknown type from a newer server) is not an Event: show nothing rather
 *  than flash vendor UI. */
export function showsVendorTools(groupType: string | null | undefined): boolean {
  return groupType === GroupType.Event;
}

/** The Vendor deposit row on the expense form. Event groups get it; so does an
 *  expense that was ALREADY a deposit when opened (made before the rule, or the
 *  group was re-typed) so the user can still turn it off, and back on. Pass the
 *  original (saved) flag, never the live toggle, or switching it off would
 *  unmount the row. */
export function showsDepositRow(
  groupType: string | null | undefined,
  originalIsDeposit: boolean,
): boolean {
  return showsVendorTools(groupType) || originalIsDeposit;
}

/** The sub-event picker row on the expense form. Event groups get it; so does
 *  an expense already tagged with a sub-event, so the tag can be cleared. */
export function showsSubEventRow(
  groupType: string | null | undefined,
  originalSubEventId: string | null | undefined,
): boolean {
  return showsVendorTools(groupType) || Boolean(originalSubEventId);
}

/** The Upcoming payments card on the plan screen. Event groups get it; so does
 *  any group that still has a deposit with a balance owing, so it can be seen
 *  and settled. */
export function showsUpcomingPayments(
  groupType: string | null | undefined,
  openDepositCount: number,
): boolean {
  return showsVendorTools(groupType) || openDepositCount > 0;
}
