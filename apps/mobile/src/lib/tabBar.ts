/**
 * The rules the root bottom bar follows, kept pure so they can be tested.
 *
 * The bar is rendered once over the whole navigation stack (see `AppTabBar`),
 * and two questions decide what it does on any given screen: should it show at
 * all, and which of the five destinations reads as current. Both are a function
 * of the route segments alone, so they live here away from the component.
 */

/**
 * Leaf or root route names the bar hides on: the full-screen camera and the
 * rise-from-bottom modals (which own their own footer actions), and the
 * signed-out screens, which are not part of the app proper.
 */
export const TAB_BAR_HIDDEN_ROUTES: ReadonlySet<string> = new Set([
  'welcome',
  'sign-in',
  'sign-up',
  'phone',
  'verify-email',
  'guest-welcome',
  'start',
  'join',
  'r',
  'language',
  'capture',
  'contact-picker',
  // Full-screen pickers with a confirm button anchored to the bottom: under the
  // bar that button is hidden and nobody can add anyone.
  'contacts',
  'add-from-another-group',
  'scan',
  'new-group',
  'new-company',
  'add-expense',
  'settle',
  'invite',
  'itemize',
  'voice',
  'paywall',
  'entry',
]);

export interface TabBarState {
  /** True when the bar should not render on this route at all. */
  readonly hidden: boolean;
  /**
   * The destination key that reads as current: one of the four tabs, or '' when
   * nothing is current (settings and other non-destinations).
   */
  readonly activeKey: string;
}

export type TabBarRoute = '/' | '/friends' | '/captures' | '/me';

/**
 * The route a bottom-bar tap should navigate to, or null when the destination is
 * already at its root. Nested screens may highlight the same destination.
 */
export function tabBarRouteForSelection(
  activeKey: string,
  selectedKey: string,
  atRoot = true,
): TabBarRoute | null {
  if (selectedKey === activeKey && atRoot) return null;

  switch (selectedKey) {
    case 'friends':
      return '/friends';
    case 'captures':
      return '/captures';
    case 'me':
      return '/me';
    default:
      return '/';
  }
}

/**
 * Resolve the bar's state from the current route segments.
 *
 * `signedOut` wins first: the bar belongs to the app proper, which needs a
 * session, so a person with no account never sees it — not on the auth screens,
 * and not on the one public page they can still reach signed-out (the privacy
 * policy, opened from the login legal line). Once they are in, that same privacy
 * page — now reached from Settings — keeps the bar like any other settings page.
 *
 * Then `hidden`: a modal or the camera or a signed-out screen shows no bar.
 * Otherwise tabs select themselves; groups and Activity select Home.
 */
export function resolveTabBar(segments: readonly string[], signedOut = false): TabBarState {
  if (signedOut) {
    return { hidden: true, activeKey: '' };
  }

  const root = segments[0] ?? '';
  const leaf = segments[segments.length - 1] ?? '';

  if (TAB_BAR_HIDDEN_ROUTES.has(root) || TAB_BAR_HIDDEN_ROUTES.has(leaf)) {
    return { hidden: true, activeKey: '' };
  }

  let activeKey = '';
  if (root === '(tabs)') activeKey = segments[1] ?? 'index';
  // Groups and Activity belong to Home; settings and other routes select nothing.
  if (root === 'group' || root === 'activity' || root === 'actions') activeKey = 'index';

  return { hidden: false, activeKey };
}

/**
 * Personal mode: the bar swaps to the private-money destinations while you are
 * on the Personal tab, `personal/*`, or its linked ledger features. Derived from the route alone, so there is no state to forget to reset.
 */
export function isPersonalMode(segments: readonly string[], space?: string): boolean {
  const [root, screen] = segments;
  // Shared settings pages stay in Personal only when opened from Me (`?space=personal`).
  if ((root === 'settings' || root === 'profile') && space === 'personal') return true;
  // Statement import is a personal-ledger feature opened from Overview.
  if (root === 'captures' && screen === 'statement') return true;
  return (
    (root === '(tabs)' && screen === 'me') ||
    root === 'personal' ||
    root === 'investments' ||
    root === 'rentals' ||
    root === 'vehicles'
  );
}

/** Highlight the owning Personal destination, leaving standalone features unselected. */
export function personalActiveKey(segments: readonly string[], space?: string): string {
  // Settings opened from the Personal Home menu highlight no tab.
  if (segments[0] === 'profile' || (segments[0] === 'settings' && space === 'personal')) return '';
  if (segments[0] === '(tabs)') return segments[1] === 'me' ? 'home' : '';
  if (segments[0] !== 'personal') return '';
  const leaf = segments[1] ?? '';
  if (leaf === 'entry' || leaf === 'transactions') return 'transactions';
  // Planning owns Recurring, Budgets, Loans and the Money calendar; a bill's page opens from there.
  if (['recurring', 'upcoming', 'source', 'budgets', 'loans', 'calendar'].includes(leaf))
    return 'planning';
  if (leaf === 'accounts') return 'accounts';
  return leaf === 'spending' ? 'reports' : '';
}

/** Where a Personal-mode bar tap goes, or null when it is already current. */
export function personalRouteForSelection(
  activeKey: string,
  selectedKey: string,
  atRoot = true,
):
  | '/me'
  | '/personal/accounts'
  | '/personal/transactions'
  | '/personal/recurring'
  | '/personal/spending'
  | null {
  if (selectedKey === activeKey && atRoot) return null;
  switch (selectedKey) {
    case 'transactions':
      return '/personal/transactions';
    case 'planning':
      return '/personal/recurring';
    case 'reports':
      return '/personal/spending';
    case 'accounts':
      return '/personal/accounts';
    default:
      return '/me';
  }
}

/**
 * How a Personal bar tap reaches `route`. From the (tabs) navigator it must push,
 * never replace: replacing swaps the whole navigator out, so Home would rebuild all
 * four tabs on return. Between Personal screens siblings replace each other, and
 * Home is reached by popping back to the still-mounted navigator.
 */
export function personalBarAction(
  segments: readonly string[],
  route: string,
): 'push' | 'replace' | 'dismissTo' | 'navigate' {
  if (route === '/me') return segments[0] === '(tabs)' ? 'navigate' : 'dismissTo';
  return segments[0] === '(tabs)' ? 'push' : 'replace';
}

/** Personal screens opened from a tab root: they pop their own stack, and the bar stays Personal. */
export function isNestedPersonal(segments: readonly string[], returnTo?: string): boolean {
  return (
    isPersonalMode(segments) &&
    (['entry', 'source', 'budgets', 'loans', 'upcoming'].includes(segments[1] ?? '') ||
      // A drill-down (Budgets/Reports/Me -> transactions) is pushed on top of its opener, so
      // Back must pop to it. Treated as a tab root, the bar's own Back sent it to Personal Home.
      (!!returnTo && ['transactions', 'spending'].includes(segments[1] ?? '')))
  );
}

/** Hardware Back on a Personal tab root: another tab goes to Personal Home, Home leaves to the shared Home. */
export function personalBackRoute(activeKey: string): '/me' | '/' {
  return activeKey === 'home' ? '/' : '/me';
}

/** The screen a Personal destination opens on; Planning opens on Recurring. */
const PERSONAL_ROOTS: Readonly<Record<string, string>> = {
  transactions: 'transactions',
  planning: 'recurring',
  reports: 'spending',
  accounts: 'accounts',
};

/** True when the Personal destination's own root is the screen on show. */
export function isPersonalRoot(segments: readonly string[], key: string): boolean {
  if (key === 'home')
    return segments[0] === '(tabs)' && segments[1] === 'me' && segments.length <= 2;
  return segments[0] === 'personal' && segments.length === 2 && segments[1] === PERSONAL_ROOTS[key];
}

const screen2 = (segments: readonly string[]): string => segments[2] ?? '';

/** Owner asked to hide the company round + for now; flip to true to bring it back. */
export const COMPANY_FAB_ENABLED = false;

/** The floating button the bar draws: the company one is off while COMPANY_FAB_ENABLED is false. */
export function showFab(segments: readonly string[], company: boolean): boolean {
  return resolveFab(segments) && (!company || COMPANY_FAB_ENABLED);
}

/** Forms keep the mic out of their input and footer space. */
export function resolveFab(segments: readonly string[]): boolean {
  const [root, screen] = segments;
  if (resolveTabBar(segments).hidden) return false;
  // Company mode: forms and the export/invite screens keep the add button out of their footers.
  if (
    root === 'group' &&
    [
      'company-entry',
      'company-wages',
      'company-calendar',
      'company-leave-policy',
      'company-bills',
      'invite',
      'export',
    ].includes(screen2(segments))
  )
    return false;
  if (root === 'captures' && (screen === 'paste' || screen === 'statement')) return false;
  if (
    root === 'settings' &&
    [
      'categories',
      'account',
      'delete-account',
      'packs',
      'paying',
      'backup',
      'import',
      'feedback',
      'redeem',
      'invite',
      'voice-recorder',
    ].includes(screen ?? '')
  )
    return false;
  return true;
}

/** Highlighting an owner does not mean its root is on screen. */
export function isTabRoot(segments: readonly string[], key: string): boolean {
  if (segments[0] === '(tabs)') {
    return (segments[1] ?? 'index') === key && segments.length <= 2;
  }
  return segments[0] === 'personal' && segments[1] === key && segments.length === 2;
}
