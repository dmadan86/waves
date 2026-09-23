import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReducedMotionProvider, useReducedMotion } from '../src/lib/reducedMotion';
import { shouldApplyInitialReducedMotionPreference } from '../src/lib/reducedMotionState';
import { firstProvider, flush, renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());

const env = vi.hoisted(() => ({
  listeners: new Set<(enabled: boolean) => void>(),
  initial: Promise.resolve(false) as Promise<boolean>,
}));

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    addEventListener: (_: string, listener: (enabled: boolean) => void) => {
      env.listeners.add(listener);
      return { remove: () => env.listeners.delete(listener) };
    },
    isReduceMotionEnabled: () => env.initial,
  },
}));

describe('shouldApplyInitialReducedMotionPreference', () => {
  it('uses the initial OS query while the provider is mounted and no event arrived', () => {
    expect(shouldApplyInitialReducedMotionPreference(true, false)).toBe(true);
  });

  it('ignores the initial query after a newer change event arrives first', () => {
    expect(shouldApplyInitialReducedMotionPreference(true, true)).toBe(false);
  });

  it('ignores the initial query after unmount', () => {
    expect(shouldApplyInitialReducedMotionPreference(false, false)).toBe(false);
  });
});

describe('ReducedMotionProvider', () => {
  function query(enabled: boolean) {
    let answer!: (value: boolean) => void;
    env.initial = new Promise<boolean>((resolve) => {
      answer = resolve;
    });
    return () => answer(enabled);
  }

  function mount() {
    const view = renderHook(() => ReducedMotionProvider({ children: null }));
    const value = () => firstProvider(view.result.current)!.value as boolean;
    return { view, value };
  }

  beforeEach(() => {
    env.listeners.clear();
  });

  it('assumes reduced until the OS answers, then follows the answer', async () => {
    const answer = query(false);
    const { value } = mount();
    expect(value()).toBe(true);
    answer();
    await flush();
    expect(value()).toBe(false);
  });

  it('follows change events, and a late initial answer does not overwrite a newer event', async () => {
    const answer = query(true);
    const { value } = mount();
    for (const listener of env.listeners) listener(false);
    expect(value()).toBe(false);
    answer();
    await flush();
    expect(value()).toBe(false);
  });

  it('stops listening on unmount and ignores the answer after it', async () => {
    const answer = query(false);
    const { view, value } = mount();
    view.unmount();
    expect(env.listeners.size).toBe(0);
    answer();
    await flush();
    expect(value()).toBe(true);
  });

  it('hands consumers the provided value, and says false with no provider', () => {
    query(false);
    const { view } = mount();
    const { ctx, value } = firstProvider(view.result.current)!;
    expect(renderHook(() => useReducedMotion(), { contexts: [[ctx, value]] }).result.current).toBe(
      true,
    );
    expect(renderHook(() => useReducedMotion()).result.current).toBe(false);
  });
});
