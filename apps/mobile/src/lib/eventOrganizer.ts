/**
 * The one rule for the event-organizer feature (docs/event-organizer.md):
 * vendor tools (Vendor deposit, balance due, the Vendors tab, upcoming vendor
 * payments, sub-event budgets and tags) belong to Event groups and nowhere
 * else. Every screen asks these helpers instead of comparing the type itself,
 * so a new surface cannot quietly leak vendor UI into a Trip or Home group;
 * `test/vendorUiGuard.test.ts` fails the build when a screen forgets to ask.
 */

/** True only for an Event group. `null`/`undefined` (group still loading, or
 *  an unknown type from a newer server) is not an Event: show nothing rather
 *  than flash vendor UI. */
export function showsVendorTools(groupType: string | null | undefined): boolean {
  return groupType === 'event';
}

/** The Vendor deposit row on the expense form. Event groups get it; so does an
 *  expense that is ALREADY a deposit (made before the rule, or the group was
 *  re-typed) so the user can still turn it off. */
export function showsDepositRow(groupType: string | null | undefined, isDeposit: boolean): boolean {
  return showsVendorTools(groupType) || isDeposit;
}
