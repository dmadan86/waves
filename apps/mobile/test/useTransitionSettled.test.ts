/**
 * A pushed screen holds its heavy content until the slide-in has finished, and
 * never longer than the fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());

const nav = vi.hoisted(() => ({
  listeners: new Map<string, (event: unknown) => void>(),
  unsubscribed: 0,
}));

vi.mock('expo-router', () => ({
  useNavigation: () => ({
    addListener: (name: string, fn: (event: unknown) => void) => {
      nav.listeners.set(name, fn);
      return () => {
        nav.unsubscribed += 1;
      };
    },
  }),
}));

const { useTransitionSettled } = await import('../src/lib/useTransitionSettled');

beforeEach(() => {
  vi.useFakeTimers();
  nav.listeners.clear();
  nav.unsubscribed = 0;
});
afterEach(() => vi.useRealTimers());

describe('useTransitionSettled', () => {
  it('is false during the push and true once it ends', () => {
    const view = renderHook(() => useTransitionSettled());
    expect(view.result.current).toBe(false);

    nav.listeners.get('transitionEnd')!({ data: { closing: false } });
    expect(view.result.current).toBe(true);
    // Settled for good: the listener and the timer are let go.
    expect(nav.unsubscribed).toBeGreaterThan(0);
  });

  it('ignores the end of a closing transition', () => {
    const view = renderHook(() => useTransitionSettled(10_000));
    nav.listeners.get('transitionEnd')!({ data: { closing: true } });
    expect(view.result.current).toBe(false);
  });

  it('settles on the fallback when no transition event ever comes', () => {
    const view = renderHook(() => useTransitionSettled(450));
    vi.advanceTimersByTime(449);
    expect(view.result.current).toBe(false);
    vi.advanceTimersByTime(1);
    expect(view.result.current).toBe(true);
  });
});
