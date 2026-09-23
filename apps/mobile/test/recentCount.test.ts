import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_RECENT_COUNT } from '@waves/core';

import {
  loadStoredRecentCount,
  RecentCountProvider,
  saveStoredRecentCount,
  useRecentCount,
} from '../src/lib/recentCount';
import { firstProvider, flush, renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());

const KEY = 'recent.count';

describe('recent count storage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await AsyncStorage.clear();
  });

  it('loads the default when storage is empty, invalid, or unavailable', async () => {
    await expect(loadStoredRecentCount()).resolves.toBe(DEFAULT_RECENT_COUNT);

    await AsyncStorage.setItem(KEY, '999');
    await expect(loadStoredRecentCount()).resolves.toBe(DEFAULT_RECENT_COUNT);

    vi.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(loadStoredRecentCount()).resolves.toBe(DEFAULT_RECENT_COUNT);
  });

  it('round-trips each allowed recent count through AsyncStorage', async () => {
    for (const count of [3, 5, 10] as const) {
      await saveStoredRecentCount(count);
      await expect(AsyncStorage.getItem(KEY)).resolves.toBe(String(count));
      await expect(loadStoredRecentCount()).resolves.toBe(count);
    }
  });

  it('swallows write failures after the caller has already updated UI state', async () => {
    vi.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));

    await expect(saveStoredRecentCount(10)).resolves.toBeUndefined();
  });

  it('keeps repeated preference loads cheap and deterministic', async () => {
    await AsyncStorage.setItem(KEY, '10');

    const values = await Promise.all(Array.from({ length: 200 }, () => loadStoredRecentCount()));

    expect(new Set(values)).toEqual(new Set([10]));
  });
});

type Provided = { count: number; loading: boolean; setCount: (n: 3 | 5 | 10) => Promise<void> };

describe('the recent-count provider', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await AsyncStorage.clear();
  });

  const provided = (tree: unknown) => firstProvider(tree)!.value as Provided;

  it('starts at the default while loading, then shows the stored size', async () => {
    await AsyncStorage.setItem(KEY, '10');
    const view = renderHook(() => RecentCountProvider({ children: null }));
    expect(provided(view.result.current)).toMatchObject({
      count: DEFAULT_RECENT_COUNT,
      loading: true,
    });

    await flush();

    expect(provided(view.result.current)).toMatchObject({ count: 10, loading: false });
  });

  it('keeps a choice made during the load instead of the stored value landing on it', async () => {
    await AsyncStorage.setItem(KEY, '10');
    const view = renderHook(() => RecentCountProvider({ children: null }));

    await provided(view.result.current).setCount(3);
    await flush();

    expect(provided(view.result.current)).toMatchObject({ count: 3, loading: false });
    await expect(AsyncStorage.getItem(KEY)).resolves.toBe('3');
  });

  it('drops the late load after unmount', async () => {
    await AsyncStorage.setItem(KEY, '10');
    const view = renderHook(() => RecentCountProvider({ children: null }));
    view.unmount();
    await flush();
    expect(provided(view.result.current)).toMatchObject({
      count: DEFAULT_RECENT_COUNT,
      loading: true,
    });
  });

  it('hands consumers the provided value, and refuses to run outside a provider', () => {
    const tree = renderHook(() => RecentCountProvider({ children: null })).result.current;
    const { ctx, value } = firstProvider(tree)!;
    expect(renderHook(() => useRecentCount(), { contexts: [[ctx, value]] }).result.current).toBe(
      value,
    );
    expect(() => renderHook(() => useRecentCount())).toThrow(/inside RecentCountProvider/);
  });
});
