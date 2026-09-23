/**
 * Starring a group, and what the star survives.
 *
 * The favourites store is a device-local singleton the clone picker and the
 * group settings screen both read, so the behaviour worth pinning is the plain
 * arithmetic under the hook: a toggle flips membership, a re-toggle flips it
 * back, an empty id does nothing, subscribers hear every change, and — the one
 * that matters for a preference — a star written now is still there after a
 * cold reload from disk.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  __resetFavoritesForTest,
  isFavorite,
  loadFavorites,
  subscribeFavorites,
  toggleFavorite,
  useFavorites,
} from '../src/lib/favorites';
import { flush, renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());

beforeEach(async () => {
  __resetFavoritesForTest();
  await AsyncStorage.clear();
});

describe('starring a group', () => {
  it('toggles a group in and back out', () => {
    expect(isFavorite('g1')).toBe(false);
    toggleFavorite('g1');
    expect(isFavorite('g1')).toBe(true);
    toggleFavorite('g1');
    expect(isFavorite('g1')).toBe(false);
  });

  it('keeps groups independent', () => {
    toggleFavorite('g1');
    expect(isFavorite('g1')).toBe(true);
    expect(isFavorite('g2')).toBe(false);
  });

  it('ignores an empty id', () => {
    toggleFavorite('');
    expect(isFavorite('')).toBe(false);
  });

  it('tells subscribers when a star changes', () => {
    const heard = vi.fn();
    const off = subscribeFavorites(heard);
    toggleFavorite('g1');
    expect(heard).toHaveBeenCalledTimes(1);
    off();
    toggleFavorite('g2');
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('survives a cold reload from disk', async () => {
    toggleFavorite('g1');
    // Simulate a fresh launch: the in-memory set is gone, only disk remains.
    __resetFavoritesForTest();
    expect(isFavorite('g1')).toBe(false);
    await loadFavorites();
    expect(isFavorite('g1')).toBe(true);
  });

  it('starts empty when disk holds nothing', async () => {
    await loadFavorites();
    expect(isFavorite('never-starred')).toBe(false);
  });

  it('keeps a toggle made before the first load resolves', async () => {
    // A prior run left one star on disk; the app relaunches and the load begins.
    await AsyncStorage.setItem('favorites.groups', JSON.stringify(['old']));
    __resetFavoritesForTest();

    const loading = loadFavorites();
    // The user stars a group before that read comes back.
    toggleFavorite('fresh');
    await loading;

    // The fresh star must survive — the slow stored set does not clobber it.
    expect(isFavorite('fresh')).toBe(true);
  });
});

describe('a stored value that is not a list of ids', () => {
  it('reads unparseable storage as no favourites rather than crashing', async () => {
    await AsyncStorage.setItem('favorites.groups', '{not json');
    await loadFavorites();
    expect(isFavorite('g1')).toBe(false);
  });

  it('ignores stored JSON that is not an array, and non-string entries inside one', async () => {
    await AsyncStorage.setItem('favorites.groups', '{"g1":true}');
    await loadFavorites();
    expect(isFavorite('g1')).toBe(false);

    __resetFavoritesForTest();
    await AsyncStorage.setItem('favorites.groups', JSON.stringify(['g2', 7, null]));
    await loadFavorites();
    expect(isFavorite('g2')).toBe(true);
    expect(isFavorite('7')).toBe(false);
  });

  it('keeps a star toggled during a read that then fails', async () => {
    let fail!: (error: Error) => void;
    vi.spyOn(AsyncStorage, 'getItem').mockReturnValueOnce(
      new Promise<string | null>((_, reject) => (fail = reject)),
    );
    const loading = loadFavorites();
    toggleFavorite('fresh');
    fail(new Error('disk'));
    await loading;
    expect(isFavorite('fresh')).toBe(true);
  });
});

describe('useFavorites', () => {
  it('is not ready until the stored stars load, then reflects them', async () => {
    await AsyncStorage.setItem('favorites.groups', JSON.stringify(['g1']));
    const view = renderHook(() => useFavorites());
    expect(view.result.current.ready).toBe(false);

    await flush();

    expect(view.result.current.ready).toBe(true);
    expect(view.result.current.isFavorite('g1')).toBe(true);
  });

  it('re-renders when a star is toggled anywhere, and stops listening on unmount', async () => {
    const view = renderHook(() => useFavorites());
    await flush();
    const before = view.renders;

    view.result.current.toggle('g9');
    expect(view.renders).toBeGreaterThan(before);
    expect(view.result.current.isFavorite('g9')).toBe(true);

    view.unmount();
    const afterUnmount = view.renders;
    toggleFavorite('g9');
    expect(view.renders).toBe(afterUnmount);
  });
});
