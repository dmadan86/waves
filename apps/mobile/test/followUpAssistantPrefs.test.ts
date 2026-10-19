import { describe, expect, it, vi } from 'vitest';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_PREFS } from '@waves/core';
import { useFollowUpPrefs } from '../src/lib/followUpPrefs';
import { flush, renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('@react-native-async-storage/async-storage', () => {
  const data = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => data.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        data.set(key, value);
      }),
    },
  };
});

describe('account-specific assistant preferences', () => {
  it('LR-STORE-01 loads each viewer, reloads on switching and persists updates', async () => {
    const first = { ...DEFAULT_PREFS, enabled: false };
    const second = { ...DEFAULT_PREFS, muted: ['place'] };
    await AsyncStorage.setItem('waves.followup_prefs:viewer-a', JSON.stringify(first));
    await AsyncStorage.setItem('waves.followup_prefs:viewer-b', JSON.stringify(second));
    const view = renderHook((viewer: string) => useFollowUpPrefs(viewer), { props: 'viewer-a' });
    try {
      expect(view.result.current.ready).toBe(false);
      await flush();
      expect(view.result.current.ready).toBe(true);
      expect(view.result.current.prefs).toEqual(first);
      view.rerender('viewer-b');
      expect(view.result.current.ready).toBe(false);
      await flush();
      expect(view.result.current.ready).toBe(true);
      expect(view.result.current.prefs).toEqual(second);
      view.result.current.update((prefs) => ({ ...prefs, enabled: false }));
      await flush();
      const updated = { ...second, enabled: false };
      expect(view.result.current.prefs).toEqual(updated);
      await expect(AsyncStorage.getItem('waves.followup_prefs:viewer-b')).resolves.toBe(
        JSON.stringify(updated),
      );
      await expect(AsyncStorage.getItem('waves.followup_prefs:viewer-a')).resolves.toBe(
        JSON.stringify(first),
      );
      view.rerender('viewer-a');
      await flush();
      expect(view.result.current.prefs).toEqual(first);
      expect(AsyncStorage.getItem).toHaveBeenCalledWith('waves.followup_prefs:viewer-a');
      view.rerender('viewer-b');
      await flush();
      expect(view.result.current.prefs).toEqual(updated);
    } finally {
      view.unmount();
    }
  });
});
