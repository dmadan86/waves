/**
 * What every tappable thing on the household Home does, as data: the quick-action
 * tiles, the hero tiles, the balance card, the header buttons and the More and ⋮
 * menus. The screen supplies labels and icons by key; the destinations live here so
 * a test can pin each one, and so "replace" (a bar destination: Back is Home) and
 * "push" (a screen opened from Home: Back pops to it) stay deliberate.
 */
import {
  householdBalancesRoute,
  householdBarRoute,
  type HouseholdBarKey,
} from '@/lib/householdTab';

export type MenuRoute = string | { pathname: string; params: Record<string, string> };

export type HouseholdAction =
  /** A bar destination: swaps the screen, so Back returns to Home. */
  | { kind: 'replace'; href: string }
  /** A screen opened from Home: pushed, Back pops to Home. */
  | { kind: 'push'; href: string }
  /** An in-place view of the Home (its own Back returns to the Overview). */
  | { kind: 'view'; view: 'bills' | 'income' | 'upcoming' }
  /** Opens the More menu. */
  | { kind: 'more' }
  /** A menu row that the OverflowMenu pushes itself. */
  | { kind: 'route'; route: MenuRoute };

const replace = (href: string): HouseholdAction => ({ kind: 'replace', href });
const push = (href: string): HouseholdAction => ({ kind: 'push', href });
const view = (v: 'bills' | 'income' | 'upcoming'): HouseholdAction => ({ kind: 'view', view: v });
const route = (r: MenuRoute): HouseholdAction => ({ kind: 'route', route: r });
const tab = (groupId: string, key: HouseholdBarKey): HouseholdAction =>
  replace(householdBarRoute(groupId, key));

export interface HouseholdEntry {
  readonly key: string;
  readonly action: HouseholdAction;
}

/** The quick-action grid, in order. */
export function householdTiles(groupId: string): HouseholdEntry[] {
  return [
    { key: 'expense', action: push(`/group/${groupId}/add-expense`) },
    { key: 'income', action: push(`/group/${groupId}/income-edit`) },
    { key: 'bills', action: view('bills') },
    { key: 'budget', action: push(`/group/${groupId}/budget`) },
    { key: 'settle', action: push(`/group/${groupId}/settle`) },
    { key: 'members', action: tab(groupId, 'me') },
    { key: 'expenses', action: tab(groupId, 'transactions') },
    { key: 'more', action: { kind: 'more' } },
  ];
}

/** The hero's three figures, the balance card and the header buttons. */
export function householdHomeButtons(groupId: string): HouseholdEntry[] {
  return [
    { key: 'flowIncome', action: view('income') },
    { key: 'flowSpent', action: tab(groupId, 'transactions') },
    { key: 'flowLeft', action: tab(groupId, 'reports') },
    { key: 'balance', action: replace(householdBalancesRoute(groupId)) },
    { key: 'search', action: tab(groupId, 'transactions') },
    { key: 'bell', action: view('upcoming') },
  ];
}

/** The More tile's menu. `now` stamps the scan link so it always opens fresh. */
export function householdMoreEntries(groupId: string, now: number): HouseholdEntry[] {
  return [
    { key: 'allExpenses', action: tab(groupId, 'transactions') },
    { key: 'whoPaid', action: replace(householdBalancesRoute(groupId)) },
    { key: 'upcoming', action: view('upcoming') },
    { key: 'spending', action: tab(groupId, 'reports') },
    { key: 'scan', action: push(`/capture?scan=${now}&targetGroupId=${groupId}`) },
    { key: 'voice', action: route({ pathname: '/voice', params: { group: groupId } }) },
    { key: 'categories', action: route('/settings/categories') },
    { key: 'import', action: route(`/group/${groupId}/import`) },
    { key: 'export', action: route(`/group/${groupId}/export`) },
  ];
}

/** The header ⋮ menu (the space's own settings, like Personal's gear). */
export function householdGearEntries(groupId: string): HouseholdEntry[] {
  return [
    { key: 'members', action: tab(groupId, 'me') },
    { key: 'invite', action: route(`/group/${groupId}/invite`) },
    { key: 'settle', action: route(`/group/${groupId}/settle`) },
    { key: 'settings', action: route(`/group/${groupId}/settings`) },
    { key: 'scene', action: route('/settings/scene') },
    { key: 'lock', action: route('/settings/lock') },
  ];
}

export interface ActionDeps {
  readonly router: {
    replace: (href: never) => void;
    push: (href: never) => void;
  };
  readonly showView: (view: 'bills' | 'income' | 'upcoming') => void;
  readonly openMore: () => void;
}

/** Performs an action; `route` kinds are the OverflowMenu's job, so they push here only if asked. */
export function runHouseholdAction(action: HouseholdAction, deps: ActionDeps): void {
  switch (action.kind) {
    case 'replace':
      return deps.router.replace(action.href as never);
    case 'push':
      return deps.router.push(action.href as never);
    case 'view':
      return deps.showView(action.view);
    case 'more':
      return deps.openMore();
    case 'route':
      return deps.router.push(action.route as never);
  }
}

/** The scan row, stamped at the tap so each scan opens the capture screen fresh. */
export function householdScanAction(groupId: string): HouseholdAction {
  return push(`/capture?scan=${Date.now()}&targetGroupId=${groupId}`);
}
