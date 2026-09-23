/**
 * The foot a screen leaves under its last row: just the system bar where the
 * app's bottom bar is hidden, and the deeper of the two where the bar covers
 * the route — so a tall footer's own request is never quietly dropped.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBottomClearance } from '../src/lib/clearance';

const state = vi.hoisted(() => ({
  segments: ['(tabs)', 'index'] as string[],
  session: { user: { id: 'u1' } } as unknown,
  overBar: 96,
}));

vi.mock('expo-router', () => ({ useSegments: () => state.segments }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ session: state.session }) }));
vi.mock('@waves/ui', () => ({
  useScreenClearance: (base?: number) => 24 + (base ?? 16),
  useTabBarClearance: () => state.overBar,
}));

beforeEach(() => {
  state.segments = ['(tabs)', 'index'];
  state.session = { user: { id: 'u1' } };
  state.overBar = 96;
});

describe('useBottomClearance', () => {
  it('clears the floating bar on a tab the bar is drawn over', () => {
    expect(useBottomClearance()).toBe(96);
  });

  it('clears the bar on a pushed page too, since the bar is drawn over the whole stack', () => {
    state.segments = ['group', '[id]'];
    expect(useBottomClearance()).toBe(96);
  });

  it('keeps a screen base that is taller than the bar', () => {
    expect(useBottomClearance(200)).toBe(224);
  });

  it('reserves only the system bar on a route that hides the app bar', () => {
    state.segments = ['capture'];
    expect(useBottomClearance()).toBe(40);
  });

  it('reserves only the system bar when signed out, where no bar is drawn', () => {
    state.session = null;
    expect(useBottomClearance(8)).toBe(32);
  });
});
