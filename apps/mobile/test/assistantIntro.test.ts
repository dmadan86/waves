/**
 * The first-run intro card (MC-IN-*): once per account, on this phone.
 *
 *  MC-IN-01  shows while `introSeen` is false, and "Got it" persists
 *  MC-IN-02  stays hidden once seen, per account, and across a remount
 *  MC-IN-03  unreadable or junk storage shows the card; a failed write is swallowed
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { darkTheme, lightTheme } from '@waves/ui/themes';

import { STRINGS_BY_LANGUAGE } from '../src/i18n';
import {
  introKey,
  parseIntroSeen,
  readIntroSeen,
  useAssistantIntro,
} from '../src/lib/assistantIntro';
import { act, findAll, flush, renderHook, textOf, type FakeElement } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());

const env = vi.hoisted(() => ({ dark: false, haptics: vi.fn() }));

vi.mock('react-native', () => ({ View: 'View', Pressable: 'Pressable' }));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
vi.mock('@waves/ui', async () => {
  const themes = await import('@waves/ui/themes');
  return {
    Text: 'Text',
    useTheme: () => (env.dark ? themes.darkTheme : themes.lightTheme),
    iconSize: { md: 18 },
  };
});
vi.mock('@/components/AssistantEnter', () => ({ AssistantEnter: 'AssistantEnter' }));
vi.mock('@/lib/assistantHaptics', () => ({ hapticSelect: env.haptics }));
vi.mock('@/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/i18n')>();
  return {
    ...actual,
    useStrings: () => ({ t: actual.STRINGS_BY_LANGUAGE.en, locale: 'en-IN', language: 'en' }),
  };
});

import { AssistantIntro } from '../src/components/AssistantIntro';

const en = STRINGS_BY_LANGUAGE.en;

function got(tree: unknown): FakeElement | undefined {
  return findAll(tree, (n) => n.props.accessibilityLabel === en.assistant.introAction)[0];
}

beforeEach(async () => {
  env.dark = false;
  env.haptics.mockClear();
  for (const id of ['me', 'other']) await AsyncStorage.removeItem(introKey(id));
});

describe('MC-IN-01 the intro card', () => {
  it('shows the explanation while it has not been seen, and "Got it" persists the dismissal', async () => {
    const view = renderHook(() => AssistantIntro({ viewerId: 'me' }));
    expect(view.result.current).toBeNull();
    await flush();
    expect(textOf(view.result.current)).toContain("I'll ask one or two quick things");
    expect(textOf(view.result.current)).toContain(en.followUps.dontAsk);

    act(() => (got(view.result.current)?.props.onPress as () => void)());
    expect(view.result.current).toBeNull();
    expect(await AsyncStorage.getItem(introKey('me'))).toBe('1');
    expect(env.haptics).toHaveBeenCalledTimes(1);
  });

  it('states the mute in the same words the question card uses', () => {
    expect(en.assistant.introBody).toContain(en.followUps.dontAsk);
  });
});

describe('MC-IN-02 once per account', () => {
  it('stays hidden after it has been seen, even on a fresh mount', async () => {
    await AsyncStorage.setItem(introKey('me'), '1');
    const view = renderHook(() => AssistantIntro({ viewerId: 'me' }));
    await flush();
    expect(view.result.current).toBeNull();
  });

  it('is per account: one person seeing it does not hide it for another', async () => {
    await AsyncStorage.setItem(introKey('me'), '1');
    const view = renderHook(() => AssistantIntro({ viewerId: 'other' }));
    await flush();
    expect(view.result.current).not.toBeNull();
  });

  it('draws nothing until storage has answered, and nothing without a signed-in account', async () => {
    const signedOut = renderHook(() => AssistantIntro({ viewerId: null }));
    await flush();
    expect(signedOut.result.current).toBeNull();
    const hook = renderHook(() => useAssistantIntro('me'));
    expect(hook.result.current.ready).toBe(false);
    await flush();
    expect(hook.result.current.ready).toBe(true);
    expect(hook.result.current.seen).toBe(false);
  });

  it('reads in dark mode too, with the same text', async () => {
    env.dark = true;
    const view = renderHook(() => AssistantIntro({ viewerId: 'me' }));
    await flush();
    expect(textOf(view.result.current)).toContain(en.assistant.introAction);
    expect(darkTheme.scheme).toBe('dark');
    expect(lightTheme.scheme).toBe('light');
  });
});

describe('MC-IN-03 storage that misbehaves', () => {
  it('only an explicit 1 counts as seen', () => {
    expect(parseIntroSeen('1')).toBe(true);
    for (const raw of [null, undefined, '', '0', 'true', 'yes', '{}']) {
      expect(parseIntroSeen(raw)).toBe(false);
    }
  });

  it('shows the card when storage cannot be read', async () => {
    const spy = vi.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    expect(await readIntroSeen('me')).toBe(false);
    spy.mockRestore();
  });

  it('dismisses on screen even when the write fails', async () => {
    const spy = vi.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('full'));
    const view = renderHook(() => AssistantIntro({ viewerId: 'me' }));
    await flush();
    act(() => (got(view.result.current)?.props.onPress as () => void)());
    await flush();
    expect(view.result.current).toBeNull();
    spy.mockRestore();
  });

  it('keeps the card in every shipped language, with real translations', () => {
    for (const language of ['hi', 'ta', 'ar'] as const) {
      const strings = STRINGS_BY_LANGUAGE[language].assistant;
      expect(strings.introBody).not.toBe(en.assistant.introBody);
      expect(strings.introAction).not.toBe(en.assistant.introAction);
    }
  });
});
