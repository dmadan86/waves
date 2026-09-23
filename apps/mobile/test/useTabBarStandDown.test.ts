/**
 * The hook a screen uses to take the bottom of the phone while its own footer
 * is up. The regression it exists for: a tab that is left mid-selection does not
 * unmount (and on a frozen tab, does not re-render), so the claim has to be let
 * go from the navigation's blur event, not from an effect.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetTabBarSuppression, tabBarSuppressedSnapshot } from '../src/lib/tabBarSuppress';
import { useTabBarStandDown } from '../src/lib/useTabBarStandDown';
import { renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());

type Listener = () => void;

function fakeNavigation(focused = true) {
  const listeners: Record<string, Set<Listener>> = { focus: new Set(), blur: new Set() };
  return {
    focused,
    isFocused() {
      return this.focused;
    },
    addListener(event: 'focus' | 'blur', fn: Listener) {
      listeners[event]!.add(fn);
      return () => listeners[event]!.delete(fn);
    },
    fire(event: 'focus' | 'blur') {
      this.focused = event === 'focus';
      listeners[event]!.forEach((fn) => fn());
    },
    count: () => listeners.focus!.size + listeners.blur!.size,
  };
}

const h = vi.hoisted(() => ({
  navigation: null as unknown,
  segments: ['(tabs)', 'review'] as string[],
}));

vi.mock('expo-router', () => ({
  useNavigation: () => h.navigation,
  useSegments: () => h.segments,
}));

let navigation: ReturnType<typeof fakeNavigation>;

beforeEach(() => {
  resetTabBarSuppression();
  navigation = fakeNavigation();
  h.navigation = navigation;
  h.segments = ['(tabs)', 'review'];
});

describe('useTabBarStandDown', () => {
  it('claims the bar under the route while active and on screen', () => {
    renderHook((active: boolean) => useTabBarStandDown(active), { props: true });
    expect(tabBarSuppressedSnapshot()).toEqual(['(tabs)/review']);
  });

  it('claims nothing while inactive, and lets go when the selection clears', () => {
    const view = renderHook((active: boolean) => useTabBarStandDown(active), { props: false });
    expect(tabBarSuppressedSnapshot()).toEqual([]);
    view.rerender(true);
    expect(tabBarSuppressedSnapshot()).toEqual(['(tabs)/review']);
    view.rerender(false);
    expect(tabBarSuppressedSnapshot()).toEqual([]);
  });

  it('lets go on blur without any re-render, and claims again on focus', () => {
    renderHook((active: boolean) => useTabBarStandDown(active), { props: true });
    navigation.fire('blur');
    expect(tabBarSuppressedSnapshot()).toEqual([]);
    navigation.fire('focus');
    expect(tabBarSuppressedSnapshot()).toEqual(['(tabs)/review']);
  });

  it('does not claim for a screen rendered while it is not on top', () => {
    navigation.focused = false;
    renderHook((active: boolean) => useTabBarStandDown(active), { props: true });
    expect(tabBarSuppressedSnapshot()).toEqual([]);
  });

  it('reads the latest selection when focus returns', () => {
    const view = renderHook((active: boolean) => useTabBarStandDown(active), { props: true });
    navigation.fire('blur');
    view.rerender(false);
    navigation.fire('focus');
    expect(tabBarSuppressedSnapshot()).toEqual([]);
  });

  it('re-claims under the new scope when the route changes under it', () => {
    const view = renderHook((active: boolean) => useTabBarStandDown(active), { props: true });
    h.segments = ['(tabs)', 'review', 'bank'];
    view.rerender(true);
    expect(tabBarSuppressedSnapshot()).toEqual(['(tabs)/review/bank']);
  });

  it('releases and unsubscribes on unmount — the only way out for a popped screen', () => {
    const view = renderHook((active: boolean) => useTabBarStandDown(active), { props: true });
    expect(navigation.count()).toBe(2);
    view.unmount();
    expect(tabBarSuppressedSnapshot()).toEqual([]);
    expect(navigation.count()).toBe(0);
  });
});
