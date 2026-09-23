/**
 * Which networks sync may use. The engine reads the stored choice straight from
 * disk on every flush, so the settings switch must never claim a value that did
 * not reach disk — and an older, slower write must never land over a newer one.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadSyncNetworkPreference,
  networkAllows,
  SyncNetworkPreference,
  SyncNetworkProvider,
  useSyncNetwork,
} from '../src/lib/syncNetwork';
import { firstProvider, flush, renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());
vi.mock('expo-network', () => ({
  NetworkStateType: { WIFI: 'WIFI', CELLULAR: 'CELLULAR', NONE: 'NONE' },
}));
vi.mock('../src/lib/legacyKeys', () => ({ legacyKeysMigrated: Promise.resolve() }));

const KEY = 'waves.sync_network';
const WIFI = 'WIFI' as never;
const CELLULAR = 'CELLULAR' as never;

type Provided = {
  preference: SyncNetworkPreference;
  loading: boolean;
  setPreference: (value: SyncNetworkPreference) => Promise<void>;
};
const provided = (tree: unknown) => firstProvider(tree)!.value as Provided;

beforeEach(async () => {
  vi.restoreAllMocks();
  await AsyncStorage.clear();
});

describe('networkAllows', () => {
  it('lets Both through on anything', () => {
    expect(networkAllows(SyncNetworkPreference.Both, WIFI)).toBe(true);
    expect(networkAllows(SyncNetworkPreference.Both, CELLULAR)).toBe(true);
  });

  it('holds Wi-Fi-only off mobile data, and mobile-only off Wi-Fi', () => {
    expect(networkAllows(SyncNetworkPreference.Wifi, WIFI)).toBe(true);
    expect(networkAllows(SyncNetworkPreference.Wifi, CELLULAR)).toBe(false);
    expect(networkAllows(SyncNetworkPreference.Cellular, CELLULAR)).toBe(true);
    expect(networkAllows(SyncNetworkPreference.Cellular, WIFI)).toBe(false);
  });

  it('fails open on an unknown interface type', () => {
    expect(networkAllows(SyncNetworkPreference.Wifi, null)).toBe(true);
    expect(networkAllows(SyncNetworkPreference.Cellular, undefined)).toBe(true);
  });
});

describe('loadSyncNetworkPreference', () => {
  it('defaults to Both for nothing stored, junk, or an unreadable store', async () => {
    await expect(loadSyncNetworkPreference()).resolves.toBe('both');
    await AsyncStorage.setItem(KEY, 'satellite');
    await expect(loadSyncNetworkPreference()).resolves.toBe('both');
    vi.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('locked'));
    await expect(loadSyncNetworkPreference()).resolves.toBe('both');
  });

  it('reads back each stored choice', async () => {
    for (const value of ['wifi', 'cellular', 'both']) {
      await AsyncStorage.setItem(KEY, value);
      await expect(loadSyncNetworkPreference()).resolves.toBe(value);
    }
  });
});

describe('the sync-network provider', () => {
  it('shows the default while loading, then the stored choice', async () => {
    await AsyncStorage.setItem(KEY, 'wifi');
    const view = renderHook(() => SyncNetworkProvider({ children: null }));
    expect(provided(view.result.current)).toMatchObject({ preference: 'both', loading: true });
    await flush();
    expect(provided(view.result.current)).toMatchObject({ preference: 'wifi', loading: false });
  });

  it('stores a non-default choice and clears the key for the default', async () => {
    const view = renderHook(() => SyncNetworkProvider({ children: null }));
    await flush();

    await provided(view.result.current).setPreference(SyncNetworkPreference.Cellular);
    expect(provided(view.result.current).preference).toBe('cellular');
    await expect(AsyncStorage.getItem(KEY)).resolves.toBe('cellular');

    await provided(view.result.current).setPreference(SyncNetworkPreference.Both);
    expect(provided(view.result.current).preference).toBe('both');
    await expect(AsyncStorage.getItem(KEY)).resolves.toBeNull();
  });

  it('rolls the switch back to what is on disk when a write fails', async () => {
    await AsyncStorage.setItem(KEY, 'wifi');
    const view = renderHook(() => SyncNetworkProvider({ children: null }));
    await flush();

    vi.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await provided(view.result.current).setPreference(SyncNetworkPreference.Cellular);

    expect(provided(view.result.current).preference).toBe('wifi');
    await expect(AsyncStorage.getItem(KEY)).resolves.toBe('wifi');
  });

  it('does not let a stale failure clobber a newer choice', async () => {
    const view = renderHook(() => SyncNetworkProvider({ children: null }));
    await flush();

    vi.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    const { setPreference } = provided(view.result.current);
    const first = setPreference(SyncNetworkPreference.Wifi);
    const second = setPreference(SyncNetworkPreference.Cellular);
    await Promise.all([first, second]);

    expect(provided(view.result.current).preference).toBe('cellular');
    await expect(AsyncStorage.getItem(KEY)).resolves.toBe('cellular');
  });

  it('ignores a load that lands after unmount', async () => {
    await AsyncStorage.setItem(KEY, 'wifi');
    const view = renderHook(() => SyncNetworkProvider({ children: null }));
    view.unmount();
    await flush();
    expect(provided(view.result.current)).toMatchObject({ preference: 'both', loading: true });
  });

  it('hands consumers the value, and refuses to run outside the provider', () => {
    const tree = renderHook(() => SyncNetworkProvider({ children: null })).result.current;
    const { ctx, value } = firstProvider(tree)!;
    expect(renderHook(() => useSyncNetwork(), { contexts: [[ctx, value]] }).result.current).toBe(
      value,
    );
    expect(() => renderHook(() => useSyncNetwork())).toThrow(/inside SyncNetworkProvider/);
  });
});
