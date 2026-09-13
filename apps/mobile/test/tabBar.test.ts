import { describe, expect, it } from 'vitest';

import { resolveTabBar, tabBarRouteForSelection } from '../src/lib/tabBar';

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
    expect(resolveTabBar(['group', '[id]'])).toEqual({ hidden: false, activeKey: '' });
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

  it('shows the bar with nothing lit on Activity, now that it pushes rather than tabs', () => {
    // Activity swapped places with Drafts: it moved out of `(tabs)` to a root
    // stack screen (`app/activity.tsx`), reached from the dashboard hero rather
    // than the bar — the same move Settings made before it. Its root segment is
    // now `activity` with no `(tabs)` prefix, so it lights no tab, exactly like
    // `profile` above.
    const state = resolveTabBar(['activity']);
    expect(state.hidden).toBe(false);
    expect(['index', 'friends', 'captures', 'me']).not.toContain(state.activeKey);
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
