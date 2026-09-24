/**
 * The launch splash waits on this rather than a clock, so it must say "ready"
 * exactly once and tell a listener that arrived before or after.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { flush, renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());

const { isLaunchReady, markLaunchReady, resetLaunchReadyForTest, useLaunchReady } =
  await import('../src/lib/launchReady');

beforeEach(() => resetLaunchReadyForTest());

describe('launch ready', () => {
  it('starts not ready and flips once', () => {
    expect(isLaunchReady()).toBe(false);
    markLaunchReady();
    markLaunchReady();
    expect(isLaunchReady()).toBe(true);
  });

  it('tells a splash that was already waiting', async () => {
    const view = renderHook(() => useLaunchReady());
    expect(view.result.current).toBe(false);
    markLaunchReady();
    await flush();
    expect(view.result.current).toBe(true);
  });

  it('answers ready at once for a splash that mounts afterwards', async () => {
    markLaunchReady();
    const view = renderHook(() => useLaunchReady());
    await flush();
    expect(view.result.current).toBe(true);
  });
});
