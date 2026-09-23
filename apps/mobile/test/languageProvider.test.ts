/**
 * `LanguageProvider` and `LocaleSync` — choosing a language, and telling the
 * server about it.
 *
 * Strings change the moment a language is chosen; direction does not, because
 * React Native decides right-to-left natively at launch. So the provider:
 * persists the choice, sets `allowRTL` and `forceRTL` in step, and raises the
 * restart prompt only when the new direction differs from the one the app
 * *launched* in — Arabic → English → Arabic in one sitting ends where it began
 * and asks nothing. Icons follow the layout actually on screen (the launch
 * direction) on a device, and the choice itself on web.
 *
 * `LocaleSync` writes the locale to the profile once per session per value, and
 * never in the tick before the stored choice has been read — which would
 * overwrite a real choice with the phone's default on every launch.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FakeElement } from './support/fakeReact';

// The fake runtime rides along on the mocked module, so a test that resets
// modules can still reach the very instance the code under test is bound to.
vi.mock('react', async () => {
  const fake = await import('./support/fakeReact');
  return { ...fake.reactModule(), __fake: fake };
});
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());
vi.mock('react/jsx-dev-runtime', async () => (await import('./support/fakeReact')).jsxModule());
// Through vi.mock rather than the config alias, so the one in-memory store
// survives the `vi.resetModules` each mount does (mock factories are cached).
vi.mock('@react-native-async-storage/async-storage', () => import('./mocks/async-storage'));

const h = vi.hoisted(() => ({
  os: 'android',
  isRTL: false,
  allowRTL: vi.fn(),
  forceRTL: vi.fn(),
  setLayoutDirection: vi.fn(),
  locales: [{ languageCode: 'en', regionCode: 'IN', languageTag: 'en-IN' }] as Record<
    string,
    string
  >[],
  auth: {
    session: { user: { id: 'me' } } as unknown,
    profile: { locale: 'en-IN' } as { locale: string } | null,
    updateProfile: vi.fn(async (_patch: unknown) => undefined),
  },
}));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return h.os;
    },
  },
  I18nManager: {
    get isRTL() {
      return h.isRTL;
    },
    allowRTL: h.allowRTL,
    forceRTL: h.forceRTL,
  },
}));
vi.mock('@waves/ui', () => ({ setLayoutDirection: h.setLayoutDirection }));
vi.mock('@/lib/legacyKeys', () => ({ legacyKeysMigrated: Promise.resolve() }));
vi.mock('expo-localization', () => ({ getLocales: () => h.locales }));
vi.mock('@/lib/auth', () => ({ useAuth: () => h.auth }));

type LanguageModule = typeof import('@/i18n/language');
type FakeReactModule = typeof import('./support/fakeReact');

/** Fresh modules, so the direction the app "launched" in is read again. */
async function load(): Promise<{
  lang: LanguageModule;
  react: FakeReactModule;
  i18n: typeof import('@/i18n');
}> {
  vi.resetModules();
  // The mocked `react`'s runtime — the very instance the modules under test
  // are bound to. (A fresh import of the fake itself would be a second one.)
  const react = ((await import('react')) as unknown as { __fake: FakeReactModule }).__fake;
  const i18n = await import('@/i18n');
  const lang = await import('@/i18n/language');
  return { lang, react, i18n };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

interface Value {
  language: string;
  stored: string | null;
  locale: string;
  loading: boolean;
  phoneLanguage: string;
  restartNeeded: boolean;
  setLanguage: (value: string | null) => Promise<void>;
}

async function mountProvider() {
  const { lang, react, i18n } = await load();
  const rendered = react.renderHook(
    () => lang.LanguageProvider({ children: 'app' }) as unknown as FakeElement,
  );
  const outer = () => rendered.result.current;
  const middle = () => outer().props.children as FakeElement;
  const inner = () => middle().props.children as FakeElement;
  return {
    rendered,
    lang,
    react,
    i18n,
    value: () => outer().props.value as Value,
    restart: () => inner().props.value as { prompt: unknown; clear: () => void },
    /** What this render handed down, as `renderHook` contexts for a consumer. */
    contexts: (): [unknown, unknown][] =>
      [outer(), middle(), inner()].map((el) => [react.contextOf(el), el.props.value]),
  };
}

// Pay the cold transform of the string tables once, outside any test's budget.
beforeAll(async () => {
  await import('@/i18n/language');
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  h.os = 'android';
  h.isRTL = false;
  h.locales = [{ languageCode: 'en', regionCode: 'IN', languageTag: 'en-IN' }];
  h.auth.session = { user: { id: 'me' } };
  h.auth.profile = { locale: 'en-IN' };
  await AsyncStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LanguageProvider', () => {
  it('follows the phone until the stored choice has been read', async () => {
    const p = await mountProvider();
    expect(p.value()).toMatchObject({
      language: 'en',
      stored: null,
      loading: true,
      phoneLanguage: 'en',
    });
    await settle();
    expect(p.value()).toMatchObject({
      language: 'en',
      stored: null,
      loading: false,
      locale: 'en-IN',
    });
    expect(p.value().restartNeeded).toBe(false);
  });

  it('restores a stored choice, formatted for the phone’s region', async () => {
    await AsyncStorage.setItem('waves.language', 'hi');
    h.locales = [{ languageCode: 'en', regionCode: 'AE', languageTag: 'en-AE' }];
    const p = await mountProvider();
    await settle();
    expect(p.value()).toMatchObject({ language: 'hi', stored: 'hi', locale: 'hi-AE' });
    expect(p.i18n.activeStrings()).toBe(p.i18n.STRINGS_BY_LANGUAGE.hi);
  });

  it('ignores a stored value that is not a language, and an unreadable store', async () => {
    await AsyncStorage.setItem('waves.language', 'klingon');
    const p = await mountProvider();
    await settle();
    expect(p.value().stored).toBeNull();

    vi.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('locked'));
    const q = await mountProvider();
    await settle();
    expect(q.value()).toMatchObject({ stored: null, loading: false });
  });

  it('drops a read that lands after unmount', async () => {
    await AsyncStorage.setItem('waves.language', 'ta');
    const p = await mountProvider();
    p.rendered.unmount();
    await settle();
    expect(p.value().loading).toBe(true);
  });

  it('keeps icons on the launch direction on a device, whatever is chosen', async () => {
    const p = await mountProvider();
    await settle();
    await p.value().setLanguage('ar');
    expect(h.setLayoutDirection).toHaveBeenCalled();
    expect(h.setLayoutDirection.mock.calls.every(([rtl]) => rtl === false)).toBe(true);
  });

  it('mirrors icons with the choice on web, where there is no restart', async () => {
    h.os = 'web';
    const p = await mountProvider();
    await settle();
    await p.value().setLanguage('ar');
    expect(h.setLayoutDirection).toHaveBeenLastCalledWith(true);
    expect(h.forceRTL).not.toHaveBeenCalled();
    expect(p.restart().prompt).toBeNull();
    expect(p.value().restartNeeded).toBe(false);
  });

  it('persists a choice and asks for a restart only when the direction turns', async () => {
    const p = await mountProvider();
    await settle();

    await p.value().setLanguage('ta');
    expect(await AsyncStorage.getItem('waves.language')).toBe('ta');
    expect(h.allowRTL).toHaveBeenLastCalledWith(false);
    expect(h.forceRTL).toHaveBeenLastCalledWith(false);
    expect(p.restart().prompt).toBeNull();

    await p.value().setLanguage('ar');
    expect(h.allowRTL).toHaveBeenLastCalledWith(true);
    expect(h.forceRTL).toHaveBeenLastCalledWith(true);
    expect(p.restart().prompt).toEqual({ language: 'ar', rtl: true });
    expect(p.value().restartNeeded).toBe(true);

    p.restart().clear();
    expect(p.restart().prompt).toBeNull();
  });

  it('asks nothing for a round trip back to the launch direction', async () => {
    h.isRTL = true;
    h.locales = [{ languageCode: 'ar', regionCode: 'AE', languageTag: 'ar-AE' }];
    const p = await mountProvider();
    await settle();
    await p.value().setLanguage('en');
    expect(p.restart().prompt).toEqual({ language: 'en', rtl: false });
    p.restart().clear();
    await p.value().setLanguage('ar');
    expect(p.restart().prompt).toBeNull();
  });

  it('puts the language back under the phone’s control', async () => {
    await AsyncStorage.setItem('waves.language', 'ta');
    const p = await mountProvider();
    await settle();
    await p.value().setLanguage(null);
    expect(await AsyncStorage.getItem('waves.language')).toBeNull();
    expect(p.value()).toMatchObject({ stored: null, language: 'en', locale: 'en-IN' });
  });

  it('keeps the choice on screen even when it cannot be written', async () => {
    vi.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('full'));
    vi.spyOn(AsyncStorage, 'removeItem').mockRejectedValue(new Error('full'));
    const p = await mountProvider();
    await settle();
    await p.value().setLanguage('hi');
    expect(p.value().language).toBe('hi');
    await expect(p.value().setLanguage(null)).resolves.toBeUndefined();
  });

  it('hands the same value to useStrings and useLanguage', async () => {
    const p = await mountProvider();
    await settle();
    const contexts = p.contexts();
    const read = <T>(hook: () => T): T => p.react.renderHook(hook, { contexts }).result.current;
    expect(read(() => p.lang.useLanguage())).toBe(p.value());
    expect(read(() => p.i18n.useStrings()).language).toBe('en');
    expect(read(() => p.lang.useRestartPrompt())).toBe(p.restart());
  });

  it('refuses useLanguage outside the provider, and has a quiet default prompt', async () => {
    const { lang, react } = await load();
    expect(() => react.renderHook(() => lang.useLanguage())).toThrow(/inside LanguageProvider/);
    const prompt = react.renderHook(() => lang.useRestartPrompt()).result.current;
    expect(prompt.prompt).toBeNull();
    expect(() => prompt.clear()).not.toThrow();
  });
});

describe('LocaleSync', () => {
  async function mountSync(language: Partial<Value>) {
    const { react } = await load();
    const lang = await import('@/i18n/language');
    const sync = await import('@/i18n/localeSync');
    // `useLanguage` reads the provider's context; stand one up by hand.
    const provider = react.renderHook(
      () => lang.LanguageProvider({ children: null }) as unknown as FakeElement,
    );
    const valueCtx = react.contextOf(provider.result.current.props.children);
    // One object, mutated in place: the consumer reads its fields each render.
    const current = { locale: 'ta-IN', loading: false, ...language };
    const rendered = react.renderHook(() => sync.LocaleSync(), {
      contexts: [[valueCtx, current]],
    });
    return {
      rendered,
      set(next: Partial<Value>) {
        Object.assign(current, next);
        rendered.rerender();
      },
    };
  }

  it('writes a changed locale to the profile once', async () => {
    const s = await mountSync({});
    expect(s.rendered.result.current).toBeNull();
    expect(h.auth.updateProfile).toHaveBeenCalledWith({ locale: 'ta-IN' });
    s.set({}); // re-render, same locale
    expect(h.auth.updateProfile).toHaveBeenCalledTimes(1);
  });

  it('does not retry a value the server normalised or refused', async () => {
    h.auth.updateProfile.mockRejectedValue(new Error('offline'));
    const s = await mountSync({});
    await settle();
    h.auth.profile = { locale: 'en-IN' }; // unchanged: still differs
    s.set({});
    expect(h.auth.updateProfile).toHaveBeenCalledTimes(1);
    s.set({ locale: 'hi-IN' });
    expect(h.auth.updateProfile).toHaveBeenLastCalledWith({ locale: 'hi-IN' });
  });

  it('never writes while the stored choice is still loading', async () => {
    await mountSync({ loading: true });
    expect(h.auth.updateProfile).not.toHaveBeenCalled();
  });

  it('writes nothing with no session or profile, or when they already agree', async () => {
    h.auth.session = null;
    await mountSync({});
    h.auth.session = { user: { id: 'me' } };
    h.auth.profile = null;
    await mountSync({});
    h.auth.profile = { locale: 'ta-IN' };
    await mountSync({});
    expect(h.auth.updateProfile).not.toHaveBeenCalled();
  });

  it('tries again once for a fresh session', async () => {
    const s = await mountSync({});
    expect(h.auth.updateProfile).toHaveBeenCalledTimes(1);
    h.auth.session = { user: { id: 'me' }, fresh: true };
    s.set({});
    expect(h.auth.updateProfile).toHaveBeenCalledTimes(2);
  });
});
