/**
 * The "All actions" page: which tiles exist, who sees them, and how search/chips narrow them.
 * Pure (no react-native) so it is unit-tested. Labels live in i18n (`t.allActions.tiles[key]`);
 * Recurring, Budgets and Loans are named by segment so they open through `openPlanning`.
 */

import type { PlanningSegment } from '@/lib/openPlanning';

export type ActionColor =
  'purple' | 'green' | 'orange' | 'coral' | 'blue' | 'teal' | 'pink' | 'indigo' | 'amber' | 'red';

export type ActionTarget =
  | { kind: 'route'; href: string }
  | { kind: 'planning'; segment: PlanningSegment }
  /** A bottom-bar tab, switched to rather than pushed. */
  | { kind: 'tab'; href: string }
  /** The capture screen with a fresh scan nonce. */
  | { kind: 'scan' };

export type ActionKey =
  | 'addExpense'
  | 'scanBill'
  | 'voice'
  | 'askAi'
  | 'transactions'
  | 'budgets'
  | 'recurring'
  | 'loans'
  | 'calendar'
  | 'bigBills'
  | 'spending'
  | 'recap'
  | 'rentals'
  | 'vehicles'
  | 'investments'
  | 'accounts'
  | 'coupleSpace'
  | 'sharedRentals'
  | 'familyGroup'
  | 'dates'
  | 'newGroup'
  | 'addFriend'
  | 'settleUp'
  | 'groups'
  | 'review'
  | 'entries'
  | 'attendance'
  | 'wages'
  | 'work'
  | 'clients'
  | 'vendors'
  | 'bills'
  | 'payments'
  | 'tickets'
  | 'files'
  | 'team'
  | 'statements';

export type ActionSpace = 'quick' | 'personal' | 'family' | 'groups' | 'company';
export type ActionChip = 'all' | 'personal' | 'family' | 'groups' | 'company';
export const ACTION_CHIPS: readonly ActionChip[] = [
  'all',
  'personal',
  'family',
  'groups',
  'company',
];

export interface ActionTile {
  key: ActionKey;
  icon: string;
  color: ActionColor;
  target: ActionTarget;
}

export interface ActionSection {
  /** `company:<id>` for each company; otherwise the space. */
  id: string;
  space: ActionSpace;
  /** The muted right-hand line: the partner / space name, or the company name. */
  sub?: string;
  tiles: ActionTile[];
}

export interface ActionsContext {
  /** The viewer's live couple/home spaces, in group order. */
  family: readonly { id: string; type: 'couple' | 'home'; name: string }[];
  /** The viewer's companies with their role there ('admin' = owner, 'manager', 'member'). */
  companies: readonly { id: string; name: string; role: string | null }[];
  companiesEnabled: boolean;
}

const tile = (key: ActionKey, icon: string, color: ActionColor, href: string): ActionTile => ({
  key,
  icon,
  color,
  target: { kind: 'route', href },
});
const planning = (
  key: ActionKey,
  icon: string,
  color: ActionColor,
  segment: PlanningSegment,
): ActionTile => ({ key, icon, color, target: { kind: 'planning', segment } });

const QUICK: ActionTile[] = [
  tile('addExpense', 'add-circle-outline', 'blue', '/capture'),
  { key: 'scanBill', icon: 'scan-outline', color: 'teal', target: { kind: 'scan' } },
  tile('voice', 'mic-outline', 'purple', '/voice'),
  tile('askAi', 'sparkles-outline', 'pink', '/personal/ask'),
];

const PERSONAL: ActionTile[] = [
  tile('transactions', 'swap-horizontal-outline', 'blue', '/personal/transactions'),
  planning('budgets', 'pie-chart-outline', 'purple', 'budgets'),
  planning('recurring', 'repeat-outline', 'teal', 'recurring'),
  planning('loans', 'cash-outline', 'green', 'loans'),
  tile('calendar', 'calendar-outline', 'indigo', '/personal/calendar'),
  tile('bigBills', 'receipt-outline', 'coral', '/personal/bigbills'),
  tile('spending', 'trending-up-outline', 'orange', '/personal/spending'),
  tile('recap', 'bar-chart-outline', 'blue', '/personal/recap'),
  tile('rentals', 'home-outline', 'green', '/rentals'),
  tile('vehicles', 'car-outline', 'red', '/vehicles'),
  tile('investments', 'leaf-outline', 'green', '/investments'),
  tile('accounts', 'wallet-outline', 'amber', '/personal/accounts'),
];

const GROUPS: ActionTile[] = [
  tile('newGroup', 'people-outline', 'blue', '/new-group'),
  tile('addFriend', 'person-add-outline', 'teal', '/friends/add-person'),
  tile('settleUp', 'checkmark-circle-outline', 'green', '/settle-up'),
  tile('groups', 'people-circle-outline', 'orange', '/groups'),
  {
    key: 'review',
    icon: 'file-tray-outline',
    color: 'indigo',
    target: { kind: 'tab', href: '/captures' },
  },
];

/** 'any' member, 'admin' = owner or manager, 'owner' = owner only (mirrors CompanyMore). */
type Need = 'any' | 'admin' | 'owner';

const COMPANY: readonly { need: Need; tile: (id: string) => ActionTile }[] = [
  { need: 'any', tile: (id) => tile('entries', 'bag-outline', 'blue', `/group/${id}`) },
  {
    need: 'any',
    tile: (id) => tile('attendance', 'time-outline', 'teal', `/group/${id}/company-attendance`),
  },
  {
    need: 'admin',
    tile: (id) => tile('wages', 'cash-outline', 'green', `/group/${id}/company-wages`),
  },
  {
    need: 'any',
    tile: (id) => tile('work', 'checkbox-outline', 'purple', `/group/${id}/company-work`),
  },
  {
    need: 'any',
    tile: (id) => tile('clients', 'id-card-outline', 'indigo', `/group/${id}/company-clients`),
  },
  {
    need: 'admin',
    tile: (id) => tile('vendors', 'storefront-outline', 'orange', `/group/${id}/company-vendors`),
  },
  {
    need: 'admin',
    tile: (id) => tile('bills', 'receipt-outline', 'coral', `/group/${id}/company-bills`),
  },
  {
    need: 'admin',
    tile: (id) => tile('payments', 'card-outline', 'blue', `/group/${id}/company-payments`),
  },
  {
    need: 'any',
    tile: (id) => tile('tickets', 'chatbubbles-outline', 'pink', `/group/${id}/company-tickets`),
  },
  {
    need: 'any',
    tile: (id) => tile('files', 'folder-outline', 'amber', `/group/${id}/company-files`),
  },
  {
    need: 'admin',
    tile: (id) => tile('team', 'person-outline', 'teal', `/group/${id}/company-people`),
  },
  {
    need: 'any',
    tile: (id) => tile('statements', 'stats-chart-outline', 'indigo', `/group/${id}/export`),
  },
];

function allowed(need: Need, role: string | null): boolean {
  if (need === 'any') return role === 'admin' || role === 'manager' || role === 'member';
  if (need === 'owner') return role === 'admin';
  return role === 'admin' || role === 'manager';
}

/** Every section this viewer may see, in page order. Empty ones are dropped. */
export function buildActionSections(ctx: ActionsContext): ActionSection[] {
  const couple = ctx.family.find((f) => f.type === 'couple');
  const home = ctx.family.find((f) => f.type === 'home');
  const shared = couple ?? home;
  const family: ActionTile[] = [
    ...(couple ? [tile('coupleSpace', 'heart-outline', 'pink', `/group/${couple.id}`)] : []),
    ...(shared
      ? [tile('sharedRentals', 'home-outline', 'teal', `/rentals?space=${shared.id}`)]
      : []),
    ...(home ? [tile('familyGroup', 'people-outline', 'purple', `/group/${home.id}`)] : []),
    ...(shared ? [tile('dates', 'gift-outline', 'coral', '/dates')] : []),
  ];
  const sections: ActionSection[] = [
    { id: 'quick', space: 'quick', tiles: QUICK },
    { id: 'personal', space: 'personal', tiles: PERSONAL },
    { id: 'family', space: 'family', sub: shared?.name, tiles: family },
    { id: 'groups', space: 'groups', tiles: GROUPS },
  ];
  if (ctx.companiesEnabled) {
    for (const c of ctx.companies) {
      sections.push({
        id: `company:${c.id}`,
        space: 'company',
        sub: c.name,
        tiles: COMPANY.filter((x) => allowed(x.need, c.role)).map((x) => x.tile(c.id)),
      });
    }
  }
  return sections.filter((s) => s.tiles.length > 0);
}

/**
 * Narrow sections by chip and search text. Quick stays on every chip except when searching is
 * the point (it is filtered like the rest). `label` is the localized tile name, so search works
 * in every language.
 */
export function filterActionSections(
  sections: readonly ActionSection[],
  chip: ActionChip,
  query: string,
  label: (key: ActionKey) => string,
): ActionSection[] {
  const q = query.trim().toLocaleLowerCase();
  return sections
    .filter((s) => chip === 'all' || s.space === 'quick' || s.space === chip)
    .map((s) => ({
      ...s,
      tiles: q ? s.tiles.filter((x) => label(x.key).toLocaleLowerCase().includes(q)) : s.tiles,
    }))
    .filter((s) => s.tiles.length > 0);
}

/** The chips worth showing: Family / Company only when there is something behind them. */
export function visibleChips(sections: readonly ActionSection[]): ActionChip[] {
  return ACTION_CHIPS.filter((c) => c === 'all' || sections.some((s) => s.space === c));
}
