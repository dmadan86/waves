/**
 * Household mode of the bottom bar: a couple / family / home / pool group wears
 * Personal's five-tab pill bar (Home, Transactions, Planning, Reports, Members),
 * every tab opening an existing household view. Pure and route-derived, like
 * `companyTab`, so it can be tested.
 */
import { hasHouseholdHome } from '@waves/core';

export type HouseholdBarKey = 'home' | 'transactions' | 'planning' | 'reports' | 'me';

/** The query params that choose a view of the group's own screen. */
export interface HouseholdSearch {
  readonly view?: string;
  readonly tab?: string;
  readonly hh?: string;
}

/** True inside a group whose home is the household one (and not a company). */
export function isHouseholdMode(
  segments: readonly string[],
  groupId: string | null,
  group: { type?: string | null; ledger_mode?: string | null } | null | undefined,
): boolean {
  return segments[0] === 'group' && groupId !== null && hasHouseholdHome(group);
}

const BAR_SCREEN: Readonly<Record<string, HouseholdBarKey>> = {
  insights: 'reports',
  month: 'reports',
  recap: 'reports',
  budget: 'planning',
  'add-bills': 'planning',
  recurring: 'planning',
  'recurring-edit': 'planning',
  'income-edit': 'planning',
  members: 'me',
  member: 'me',
  settings: 'me',
  invite: 'me',
  expense: 'transactions',
  pending: 'transactions',
};

/** Which household tab reads as current; '' for screens that belong to none. */
export function householdBarActiveKey(
  segments: readonly string[],
  search: HouseholdSearch = {},
): HouseholdBarKey | '' {
  if (segments[0] !== 'group') return '';
  if (segments.length <= 2) {
    if (search.view === 'ledger' || search.tab) return 'transactions';
    return search.hh === 'planning' || search.hh === 'upcoming' ? 'planning' : 'home';
  }
  return BAR_SCREEN[segments[2] ?? ''] ?? '';
}

/** Where a household-bar tab goes. */
export function householdBarRoute(groupId: string, key: string): string {
  // `nav=tab` makes the stack cut instead of sliding (see the group screens in _layout).
  switch (key) {
    case 'transactions':
      return `/group/${groupId}?view=ledger&nav=tab`;
    case 'planning':
      return `/group/${groupId}?hh=planning&nav=tab`;
    case 'reports':
      return `/group/${groupId}/insights?nav=tab`;
    case 'me':
      return `/group/${groupId}/members?nav=tab`;
    default:
      return `/group/${groupId}?nav=tab`;
  }
}

/** The ledger's Balances tab, as a Transactions-tab arrival. */
export const householdBalancesRoute = (groupId: string): string =>
  `${householdBarRoute(groupId, 'transactions')}&tab=balances`;

/** The household's Upcoming list, a view of the Planning tab. */
export const householdUpcomingRoute = (groupId: string): string =>
  `/group/${groupId}?hh=upcoming&nav=tab`;

/**
 * Where Back goes from a household tab root other than Home: the household Home
 * (tabs replace each other, so Home is no longer under them). Null on Home, on
 * screens opened from a tab (their own stack entry pops) and outside the group.
 */
export function householdBackRoute(
  segments: readonly string[],
  search: HouseholdSearch,
  groupId: string,
): string | null {
  const key = householdBarActiveKey(segments, search);
  if (key === '' || key === 'home' || !isHouseholdBarRoot(segments, search, key)) return null;
  return `/group/${groupId}?nav=back`;
}

/** True when the tab's own root screen is on show, so tapping it again does nothing. */
export function isHouseholdBarRoot(
  segments: readonly string[],
  search: HouseholdSearch,
  key: string,
): boolean {
  if (segments[0] !== 'group') return false;
  if (segments.length <= 2) return householdBarActiveKey(segments, search) === key;
  return (
    segments.length === 3 &&
    householdBarActiveKey(segments, search) === key &&
    ['insights', 'members'].includes(segments[2] ?? '')
  );
}

/** The in-place view `?hh=` selects on the household Home. */
export function householdViewFor(hh?: string): 'overview' | 'planning' | 'upcoming' {
  return hh === 'planning' ? 'planning' : hh === 'upcoming' ? 'upcoming' : 'overview';
}

/**
 * Hardware Back inside the household Home's local views (Bills, Income, Upcoming, Planning):
 * the view to fall back to, or null when the screen is already on its route's own view
 * (then the bar's tab Back, or leaving the group, applies).
 */
export function householdLocalBack(tab: string, hh?: string): string | null {
  const base = householdViewFor(hh);
  return tab === base ? null : base;
}

/** How a bar move reaches its href without ever unmounting a group root. */
export type BarMove = 'navigate' | 'push' | 'replace' | 'dismissTo';

/**
 * Group-root hrefs (`/group/:id?...`: Home, Transactions, Planning) are one mounted screen:
 * from the root `navigate` swaps its params in place, from a pushed tab `dismissTo` pops back
 * to it. Separate routes (Reports, Members, company sub-tabs) are pushed from the root and
 * replace each other, so the root is never rebuilt and the stack never grows.
 */
export function barMove(segments: readonly string[], href: string): BarMove {
  const targetRoot = (href.split('?')[0] ?? '').split('/').filter(Boolean).length <= 2;
  if (segments[0] !== 'group') return targetRoot ? 'dismissTo' : 'push';
  const atRoot = segments.length <= 2;
  if (targetRoot) return atRoot ? 'navigate' : 'dismissTo';
  return atRoot ? 'push' : 'replace';
}
