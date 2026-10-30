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
  if (root === 'group' || root === 'activity') activeKey = 'index';

  return { hidden: false, activeKey };
}

/**
 * Personal mode: the bar swaps to the private-money destinations while you are
 * on the Personal tab, `personal/*`, or its linked ledger features. Derived from the route alone, so there is no state to forget to reset.
 */
export function isPersonalMode(segments: readonly string[]): boolean {
  const [root, screen] = segments;
  // Statement import is a personal-ledger feature opened from Overview.
  if (root === 'captures' && screen === 'statement') return true;
  // Categories is a personal-ledger feature opened from Overview.
  if (root === 'settings' && screen === 'categories') return true;
  return (root === '(tabs)' && screen === 'me') || root === 'personal';
}

/** Highlight the owning Personal destination, leaving standalone features unselected. */
export function personalActiveKey(segments: readonly string[]): string {
  if (segments[0] === '(tabs)') return segments[1] === 'me' ? 'me' : '';
  if (segments[0] !== 'personal') return '';
  const leaf = segments[1] ?? '';
  if (leaf === 'budgets' || leaf === 'loans') return 'me';
  if (leaf === 'entry' || leaf === 'source') return 'transactions';
  return leaf === 'transactions' || leaf === 'spending' || leaf === 'recurring' ? leaf : '';
}

/** Where a Personal-mode bar tap goes, or null when it is already current. */
export function personalRouteForSelection(
  activeKey: string,
  selectedKey: string,
  atRoot = true,
): '/' | '/me' | '/personal/transactions' | '/personal/recurring' | '/personal/spending' | null {
  if (selectedKey === activeKey && atRoot) return null;
  switch (selectedKey) {
    case 'shared':
      return '/';
    case 'transactions':
      return '/personal/transactions';
    case 'recurring':
      return '/personal/recurring';
    case 'spending':
      return '/personal/spending';
    default:
      return '/me';
  }
}

const screen2 = (segments: readonly string[]): string => segments[2] ?? '';

/** Forms keep the mic out of their input and footer space. */
export function resolveFab(segments: readonly string[]): boolean {
  const [root, screen] = segments;
  if (resolveTabBar(segments).hidden) return false;
  // Company mode: forms and the export/invite screens keep the add button out of their footers.
  if (
    root === 'group' &&
    ['company-entry', 'company-wages', 'invite', 'export'].includes(screen2(segments))
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
