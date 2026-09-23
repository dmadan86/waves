/**
 * The dashboard's one rotating tip: hidden until the dismissed set has loaded
 * (so it never flashes in and vanishes), picked by the day, and gone for good
 * once dismissed.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UiStrings } from '../src/i18n';
import { useDashboardTips } from '../src/lib/tips';
import { flush, renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());

const KEY = 'dashboardTips:dismissed';
const DAY_MS = 86_400_000;

const t = {
  tips: {
    voiceTitle: 'Voice',
    voiceBody: 'Say it',
    splitTitle: 'Split',
    splitBody: 'Reshape',
    remindTitle: 'Remind',
    remindBody: 'Nudge',
    offlineTitle: 'Offline',
    offlineBody: 'Works offline',
    scanTitle: 'Scan',
    scanBody: 'Scan a receipt',
  },
} as unknown as UiStrings;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  await AsyncStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDashboardTips', () => {
  it('shows nothing until the dismissed set has loaded, then the tip for the day', async () => {
    vi.setSystemTime(DAY_MS * 5); // day 5 → the one at index 0 of five
    const view = renderHook(() => useDashboardTips(t));
    expect(view.result.current.tip).toBeNull();

    await flush();

    expect(view.result.current.tip).toMatchObject({ id: 'voice', title: 'Voice' });
  });

  it('rotates by the day and carries the scan route', async () => {
    vi.setSystemTime(DAY_MS * 4);
    const view = renderHook(() => useDashboardTips(t));
    await flush();
    expect(view.result.current.tip).toMatchObject({ id: 'scan', route: '/capture?scan=1' });
  });

  it('skips what was dismissed before', async () => {
    vi.setSystemTime(DAY_MS * 5);
    await AsyncStorage.setItem(KEY, JSON.stringify(['voice']));
    const view = renderHook(() => useDashboardTips(t));
    await flush();
    // Four left, day 5 → index 1 of [split, remind, offline, scan].
    expect(view.result.current.tip?.id).toBe('remind');
  });

  it('retires the current tip for good and remembers it', async () => {
    vi.setSystemTime(DAY_MS * 5);
    const view = renderHook(() => useDashboardTips(t));
    await flush();

    view.result.current.dismiss();
    await flush();

    expect(view.result.current.tip?.id).not.toBe('voice');
    await expect(AsyncStorage.getItem(KEY)).resolves.toBe(JSON.stringify(['voice']));
  });

  it('stops appearing once every tip is dismissed, and dismiss is then a no-op', async () => {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify(['voice', 'split', 'remind', 'offline', 'scan']),
    );
    const view = renderHook(() => useDashboardTips(t));
    await flush();
    expect(view.result.current.tip).toBeNull();

    const setItem = vi.spyOn(AsyncStorage, 'setItem');
    view.result.current.dismiss();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('treats a corrupt or unreadable store as nothing dismissed', async () => {
    vi.setSystemTime(0);
    await AsyncStorage.setItem(KEY, '{not json');
    const corrupt = renderHook(() => useDashboardTips(t));
    await flush();
    expect(corrupt.result.current.tip?.id).toBe('voice');

    vi.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('locked'));
    const unreadable = renderHook(() => useDashboardTips(t));
    await flush();
    expect(unreadable.result.current.tip?.id).toBe('voice');
  });

  it('keeps quiet when the load lands after unmount', async () => {
    const view = renderHook(() => useDashboardTips(t));
    view.unmount();
    await flush();
    expect(view.result.current.tip).toBeNull();
  });
});
