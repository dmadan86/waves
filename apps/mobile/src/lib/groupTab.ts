/**
 * Which tab of a group a `?tab=` link opens.
 *
 * Settle up is not a tab of its own: its payments sit at the top of Balances, so
 * the old `settle` value (links, notifications, a stored route) lands there.
 */

export type GroupTabParam = 'expenses' | 'balances' | 'vendors';

export function groupTabFromParam(param: string | undefined): GroupTabParam {
  if (param === 'vendors') return 'vendors';
  if (param === 'balances' || param === 'settle') return 'balances';
  return 'expenses';
}

/** The door to settling in a group: its Balances tab, payments first. */
export function settleHref(groupId: string): string {
  return `/group/${groupId}?tab=balances`;
}
