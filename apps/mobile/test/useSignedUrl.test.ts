/**
 * A signed URL that never rots on screen: minted on mount, re-asked on a timer
 * and on return to the foreground, with only the newest answer applied.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flush, renderHook } from './support/fakeReact';

const app = vi.hoisted(() => ({
  listeners: new Set<(state: string) => void>(),
}));

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      app.listeners.add(listener);
      return { remove: () => app.listeners.delete(listener) };
    },
  },
}));

const { SIGNED_URL_LIFETIME_MS, useSignedUrl } = await import('../src/lib/useSignedUrl');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  // setImmediate stays real: `flush` uses it to let promise callbacks land.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  app.listeners.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSignedUrl', () => {
  it('shows nothing for no path, and never asks', () => {
    const resolve = vi.fn();
    const view = renderHook(() => useSignedUrl(null, resolve));
    expect(view.result.current).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
    expect(app.listeners.size).toBe(0);
  });

  it('resolves the path to a URL once minted', async () => {
    const resolve = vi.fn(async (key: string) => `https://signed/${key}?t=1`);
    const view = renderHook(() => useSignedUrl('a.jpg', resolve));
    expect(view.result.current).toBeNull();

    await flush();

    expect(view.result.current).toBe('https://signed/a.jpg?t=1');
    expect(resolve).toHaveBeenCalledWith('a.jpg');
  });

  it('re-asks every five minutes, well inside the hour a URL lives', async () => {
    let n = 0;
    const resolve = vi.fn(async () => `u${++n}`);
    const view = renderHook(() => useSignedUrl('a.jpg', resolve));
    await flush();
    expect(view.result.current).toBe('u1');

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(view.result.current).toBe('u2');
    expect(SIGNED_URL_LIFETIME_MS).toBe(60 * 60 * 1000);
  });

  it('does not re-render when a refresh returns the same URL', async () => {
    const resolve = vi.fn(async () => 'same');
    const view = renderHook(() => useSignedUrl('a.jpg', resolve));
    await flush();
    const renders = view.renders;

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(view.renders).toBe(renders);
  });

  it('re-asks on return to the foreground, not on going to the background', async () => {
    const resolve = vi.fn(async () => 'url');
    renderHook(() => useSignedUrl('a.jpg', resolve));
    await flush();

    for (const listener of app.listeners) listener('background');
    expect(resolve).toHaveBeenCalledTimes(1);
    for (const listener of app.listeners) listener('active');
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('lets only the newest mint land when an older one answers late', async () => {
    const first = deferred<string | null>();
    const second = deferred<string | null>();
    const resolve = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = renderHook(() => useSignedUrl('a.jpg', resolve));

    for (const listener of app.listeners) listener('active');
    second.resolve('fresh');
    await flush();
    first.resolve('stale');
    await flush();

    expect(view.result.current).toBe('fresh');
  });

  it('clears the image when the latest mint fails, and ignores an older failure', async () => {
    const first = deferred<string | null>();
    const resolve = vi
      .fn()
      .mockResolvedValueOnce('ok')
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(new Error('401'));
    const view = renderHook(() => useSignedUrl('a.jpg', resolve));
    await flush();
    expect(view.result.current).toBe('ok');

    for (const listener of app.listeners) listener('active'); // #2, pending
    for (const listener of app.listeners) listener('active'); // #3, fails
    await flush();
    expect(view.result.current).toBeNull();

    first.reject(new Error('late'));
    await flush();
    expect(view.result.current).toBeNull();
  });

  it('never flashes the previous image under a new path', async () => {
    const resolve = vi.fn(async (key: string): Promise<string | null> => `url-${key}`);
    const first = deferred<string | null>();
    let key = 'a.jpg';
    const view = renderHook(() => useSignedUrl(key, resolve));
    await flush();
    expect(view.result.current).toBe('url-a.jpg');

    resolve.mockReturnValueOnce(first.promise);
    key = 'b.jpg';
    view.rerender();
    expect(view.result.current).toBeNull();

    first.resolve('url-b.jpg');
    await flush();
    expect(view.result.current).toBe('url-b.jpg');
  });

  it('stops the timer and the listener on unmount, and drops a late answer', async () => {
    const pending = deferred<string | null>();
    const resolve = vi.fn().mockReturnValue(pending.promise);
    const view = renderHook(() => useSignedUrl('a.jpg', resolve));

    view.unmount();
    expect(app.listeners.size).toBe(0);
    pending.resolve('late');
    await flush();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(view.result.current).toBeNull();
  });
});
