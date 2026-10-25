import { describe, expect, it } from 'vitest';

import {
  isPersonalMode,
  personalActiveKey,
  personalRouteForSelection,
  resolveFab,
  resolveTabBar,
  tabBarRouteForSelection,
} from '../src/lib/tabBar';

describe('tabBarRouteForSelection', () => {
  it('does not navigate when the selected tab is already active', () => {
    expect(tabBarRouteForSelection('index', 'index')).toBeNull();
    expect(tabBarRouteForSelection('friends', 'friends')).toBeNull();
    expect(tabBarRouteForSelection('captures', 'captures')).toBeNull();
  });

  it('maps inactive tab selections to their routes', () => {
    expect(tabBarRouteForSelection('friends', 'index')).toBe('/');
    expect(tabBarRouteForSelection('index', 'friends')).toBe('/friends');
    expect(tabBarRouteForSelection('index', 'captures')).toBe('/captures');
    expect(tabBarRouteForSelection('index', 'me')).toBe('/me');
  });
});

describe('resolveTabBar', () => {
  it('draws no bar at all for someone signed out, whatever the route', () => {
    expect(resolveTabBar(['(tabs)', 'index'], true)).toEqual({ hidden: true, activeKey: '' });
  });

  it('lights the current tab inside the tabs group', () => {
    expect(resolveTabBar(['(tabs)', 'index'])).toEqual({ hidden: false, activeKey: 'index' });
    expect(resolveTabBar(['(tabs)', 'friends'])).toEqual({ hidden: false, activeKey: 'friends' });
    // `captures` (the "Review" tab) replaced `activity` in the bar — its file
    // moved into `(tabs)/captures.tsx`, so a person on it now shows the same
    // shape as any other tab: `(tabs)` as the root segment, the tab's own file
    // name as the leaf.
    expect(resolveTabBar(['(tabs)', 'captures'])).toEqual({
      hidden: false,
      activeKey: 'captures',
    });
    expect(resolveTabBar(['(tabs)', 'me'])).toEqual({ hidden: false, activeKey: 'me' });
  });

  it('defaults to home when the tabs group has no leaf yet', () => {
    expect(resolveTabBar(['(tabs)'])).toEqual({ hidden: false, activeKey: 'index' });
  });

  it('shows the bar with nothing current deeper in the app', () => {
    expect(resolveTabBar(['group', '[id]'])).toEqual({ hidden: false, activeKey: 'index' });
    expect(resolveTabBar(['settings', 'notifications'])).toEqual({ hidden: false, activeKey: '' });
  });

  it('does not light the removed account tab even when on it', () => {
    // Settings still exists and is reached from the header avatar, but it is no
    // longer a bar destination — and no longer inside the tab group either, so
    // it pushes like any other screen. The bar stays, with nothing lit.
    const state = resolveTabBar(['profile']);
    expect(state.hidden).toBe(false);
    expect(['index', 'friends', 'captures', 'me']).not.toContain(state.activeKey);
  });

  it('lights Home on Activity and group subroutes', () => {
    expect(resolveTabBar(['activity']).activeKey).toBe('index');
    expect(resolveTabBar(['group', '[id]', 'members']).activeKey).toBe('index');
  });

  it('hides on the full-screen camera and the signed-out screens', () => {
    expect(resolveTabBar(['capture']).hidden).toBe(true);
    expect(resolveTabBar(['welcome']).hidden).toBe(true);
    expect(resolveTabBar(['sign-in']).hidden).toBe(true);
    expect(resolveTabBar(['sign-up']).hidden).toBe(true);
    expect(resolveTabBar(['phone']).hidden).toBe(true);
    expect(resolveTabBar(['verify-email']).hidden).toBe(true);
    expect(resolveTabBar(['guest-welcome']).hidden).toBe(true);
    expect(resolveTabBar(['join']).hidden).toBe(true);
    expect(resolveTabBar(['language']).hidden).toBe(true);
    expect(resolveTabBar(['new-group']).hidden).toBe(true);
    expect(resolveTabBar(['friends', 'contacts']).hidden).toBe(true);
    expect(resolveTabBar(['add-from-another-group']).hidden).toBe(true);
    expect(resolveTabBar(['paywall']).hidden).toBe(true);
  });

  it('hides on the rise-from-bottom modals nested under a group', () => {
    expect(resolveTabBar(['group', '[id]', 'add-expense']).hidden).toBe(true);
    expect(resolveTabBar(['group', '[id]', 'settle']).hidden).toBe(true);
    expect(resolveTabBar(['group', '[id]', 'invite']).hidden).toBe(true);
    expect(resolveTabBar(['group', '[id]', 'itemize']).hidden).toBe(true);
  });

  it('keeps the bar on non-modal group sub-screens', () => {
    expect(resolveTabBar(['group', '[id]', 'members']).hidden).toBe(false);
    expect(resolveTabBar(['group', '[id]', 'settings']).hidden).toBe(false);
  });

  it('treats an empty segment list as the resting home state', () => {
    expect(resolveTabBar([])).toEqual({ hidden: false, activeKey: '' });
  });
});

describe('contact pickers', () => {
  it('hides the bar on both the group-form picker and the Friends picker', () => {
    expect(resolveTabBar(['contact-picker']).hidden).toBe(true);
    expect(resolveTabBar(['friends', 'contacts']).hidden).toBe(true);
  });
});

describe('personal mode', () => {
  it('is on for the Personal tab and personal screens only', () => {
    expect(isPersonalMode(['(tabs)', 'me'])).toBe(true);
    expect(isPersonalMode(['personal', 'transactions'])).toBe(true);
    expect(isPersonalMode(['(tabs)', 'index'])).toBe(false);
    expect(isPersonalMode(['group', '[id]'])).toBe(false);
  });

  it('names the current personal destination', () => {
    expect(personalActiveKey(['(tabs)', 'me'])).toBe('me');
    expect(personalActiveKey(['personal', 'transactions'])).toBe('transactions');
    expect(personalActiveKey(['personal', 'spending'])).toBe('spending');
    expect(personalActiveKey(['personal', 'recurring'])).toBe('recurring');
    expect(personalActiveKey(['personal', 'budgets'])).toBe('me');
  });

  it('routes taps, and the way back goes home', () => {
    expect(personalRouteForSelection('me', 'shared')).toBe('/');
    expect(personalRouteForSelection('me', 'spending')).toBe('/personal/spending');
    expect(personalRouteForSelection('me', 'recurring')).toBe('/personal/recurring');
    expect(personalRouteForSelection('spending', 'me')).toBe('/me');
    expect(personalRouteForSelection('me', 'me')).toBeNull();
  });
});

it.each(['transactions', 'recurring', 'spending', 'budgets', 'loans', 'entry', 'source'])(
  'uses Personal mode for personal/%s',
  (screen) => {
    expect(isPersonalMode(['personal', screen])).toBe(true);
  },
);
it.each([
  ['captures', 'statement'],
  ['settings', 'categories'],
])('keeps %s/%s in Personal without highlighting a tab', (root, screen) => {
  expect(isPersonalMode([root, screen])).toBe(true);
  expect(personalActiveKey([root, screen])).toBe('');
});
it('keeps profile and other settings outside Personal', () => {
  expect(isPersonalMode(['profile'])).toBe(false);
  expect(isPersonalMode(['settings', 'account'])).toBe(false);
  expect(personalActiveKey(['settings', 'transactions'])).toBe('');
});
it.each([
  ['budgets', 'me'],
  ['loans', 'me'],
  ['entry', 'transactions'],
  ['source', 'transactions'],
])('highlights %s as %s', (screen, key) => {
  expect(personalActiveKey(['personal', screen, 'id'])).toBe(key);
});
it.each([
  ['personal', 'entry'],
  ['captures', 'paste'],
  ['captures', 'statement'],
  ['settings', 'categories'],
])('hides the FAB on %s/%s forms', (root, screen) => {
  expect(resolveFab([root, screen])).toBe(false);
});
it('hides the entry bar and keeps the FAB on Personal destinations', () => {
  expect(resolveTabBar(['personal', 'entry']).hidden).toBe(true);
  for (const screen of ['transactions', 'recurring', 'spending', 'budgets'])
    expect(resolveFab(['personal', screen])).toBe(true);
});
