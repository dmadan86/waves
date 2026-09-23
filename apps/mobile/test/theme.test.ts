/**
 * The appearance preference. While `THEME_HIDDEN` holds, every consumer sees
 * light whatever is stored or whatever the phone says — but the stored choice
 * is still read and written untouched, so it comes back when the feature does.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SchemePreference,
  THEME_HIDDEN,
  ThemePreferenceProvider,
  useThemePreference,
} from '../src/lib/theme';
import { firstProvider, flush, renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());

const env = vi.hoisted(() => ({ scheme: 'dark' as string | null }));
vi.mock('react-native', () => ({ useColorScheme: () => env.scheme }));
vi.mock('../src/lib/legacyKeys', () => ({ legacyKeysMigrated: Promise.resolve() }));

type Theme = ReturnType<typeof useThemePreference>;

async function mount() {
  const view = renderHook(() => ThemePreferenceProvider({ children: null }));
  const value = () => firstProvider(view.result.current)!.value as Theme;
  return { view, value };
}

beforeEach(async () => {
  env.scheme = 'dark';
  await AsyncStorage.clear();
});

describe('the theme preference', () => {
  it('is hidden, so it says light and not overridden even on a dark phone with dark stored', async () => {
    expect(THEME_HIDDEN).toBe(true);
    await AsyncStorage.setItem('waves.theme_scheme', 'dark');
    const { value } = await mount();
    expect(value().loading).toBe(true);
    await flush();
    expect(value()).toMatchObject({
      preference: SchemePreference.Light,
      resolved: 'light',
      systemScheme: 'dark',
      loading: false,
      overridden: false,
    });
  });

  it('reports the phone’s own scheme, reading anything but dark as light', async () => {
    env.scheme = null;
    const { value } = await mount();
    expect(value().systemScheme).toBe('light');
  });

  it('still writes the choice through, and clears it for "follow the phone"', async () => {
    await AsyncStorage.setItem('waves.theme_scheme', 'light');
    const { value } = await mount();
    await flush();

    await value().setPreference(SchemePreference.Dark);
    await expect(AsyncStorage.getItem('waves.theme_scheme')).resolves.toBe('dark');

    await value().setPreference(null);
    await expect(AsyncStorage.getItem('waves.theme_scheme')).resolves.toBeNull();
  });

  it('drops a load that lands after unmount', async () => {
    const { view, value } = await mount();
    view.unmount();
    await flush();
    expect(value().loading).toBe(true);
  });

  it('refuses to be read outside its provider', () => {
    expect(() => renderHook(() => useThemePreference())).toThrow(/inside ThemePreferenceProvider/);
  });
});
