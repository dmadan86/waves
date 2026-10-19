/**
 * The Free-user teaser (MC-TE-*): one static line, at most once every 7 days.
 *
 *  MC-TE-01  shows for Free at most once per 7 days
 *  MC-TE-02  never shows for Pro, never without an account
 *  MC-TE-03  dismissing hides it for this visit; "See Pro" counts the view and opens plans
 *  MC-TE-04  the teaser event and copy
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { STRINGS_BY_LANGUAGE } from '../src/i18n';
import {
  TEASER_INTERVAL_MS,
  teaserApplies,
  teaserDue,
  teaserKey,
} from '../src/lib/assistantTeaser';
import { act, findAll, flush, renderHook, textOf, type FakeElement } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());

const env = vi.hoisted(() => ({
  track: vi.fn(),
  push: vi.fn(),
  haptics: vi.fn(),
}));

vi.mock('react-native', () => ({ View: 'View', Pressable: 'Pressable' }));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
vi.mock('@waves/ui', async () => {
  const themes = await import('@waves/ui/themes');
  return {
    Text: 'Text',
    Button: 'Button',
    Sheet: 'Sheet',
    useTheme: () => themes.lightTheme,
    iconSize: { md: 18, base: 16 },
  };
});
vi.mock('@/components/AssistantEnter', () => ({ AssistantEnter: 'AssistantEnter' }));
vi.mock('@/lib/events', () => ({ track: env.track }));
vi.mock('@/lib/navigation', () => ({ router: { push: env.push } }));
vi.mock('@/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/i18n')>();
  return {
    ...actual,
    useStrings: () => ({ t: actual.STRINGS_BY_LANGUAGE.en, locale: 'en-IN', language: 'en' }),
  };
});

import { AssistantProSheet, AssistantTeaser } from '../src/components/AssistantTeaser';

const en = STRINGS_BY_LANGUAGE.en;
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-10-20T10:00:00.000Z');

const byLabel = (tree: unknown, label: string): FakeElement | undefined =>
  findAll(tree, (n) => String(n.props.accessibilityLabel ?? '').startsWith(label))[0];

async function mount(isPro: boolean, viewerId: string | null = 'me') {
  const view = renderHook(() => AssistantTeaser({ viewerId, isPro }));
  await flush();
  return view;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  env.track.mockClear();
  env.push.mockClear();
  for (const id of ['me', 'other']) await AsyncStorage.removeItem(teaserKey(id));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MC-TE-01 once per 7 days for Free', () => {
  it('shows the first time, with the question and the way to plans', async () => {
    const view = await mount(false);
    expect(textOf(view.result.current)).toContain('Pro would ask: Where was this?');
    expect(textOf(view.result.current)).toContain('See Pro');
    expect(await AsyncStorage.getItem(teaserKey('me'))).toBe(new Date(T0).toISOString());
  });

  it('does not show again within 7 days, but does on the 7th day', async () => {
    await mount(false);
    vi.setSystemTime(T0 + 3 * DAY);
    expect((await mount(false)).result.current).toBeNull();
    vi.setSystemTime(T0 + 7 * DAY - 1000);
    expect((await mount(false)).result.current).toBeNull();
    vi.setSystemTime(T0 + 7 * DAY);
    expect((await mount(false)).result.current).not.toBeNull();
  });

  it('keeps its own clock per account', async () => {
    await mount(false, 'me');
    expect((await mount(false, 'other')).result.current).not.toBeNull();
  });

  it('teaserDue: never shown, junk and future stamps are due; a fresh stamp is not', () => {
    expect(teaserDue(null, T0)).toBe(true);
    expect(teaserDue('', T0)).toBe(true);
    expect(teaserDue('not a date', T0)).toBe(true);
    expect(teaserDue(new Date(T0 + DAY).toISOString(), T0)).toBe(true);
    expect(teaserDue(new Date(T0 - DAY).toISOString(), T0)).toBe(false);
    expect(teaserDue(new Date(T0 - TEASER_INTERVAL_MS).toISOString(), T0)).toBe(true);
  });

  it('a full interval is seven days', () => {
    expect(TEASER_INTERVAL_MS).toBe(7 * DAY);
  });
});

describe('MC-TE-02 who sees it', () => {
  it('never shows for Pro, and does not spend the week either', async () => {
    const view = await mount(true);
    expect(view.result.current).toBeNull();
    expect(await AsyncStorage.getItem(teaserKey('me'))).toBeNull();
    expect(env.track).not.toHaveBeenCalled();
  });

  it('never shows without an account', async () => {
    expect((await mount(false, null)).result.current).toBeNull();
    expect(teaserApplies({ isPro: false, viewerId: null })).toBe(false);
    expect(teaserApplies({ isPro: true, viewerId: 'me' })).toBe(false);
    expect(teaserApplies({ isPro: false, viewerId: 'me' })).toBe(true);
  });

  it('shows when storage cannot be read, and carries on if it cannot be written', async () => {
    const read = vi.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    const write = vi.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('full'));
    const view = await mount(false);
    expect(view.result.current).not.toBeNull();
    read.mockRestore();
    write.mockRestore();
  });
});

describe('MC-TE-03 acting on it', () => {
  it('Dismiss hides it for this visit and it stays recorded as shown', async () => {
    const view = await mount(false);
    act(() =>
      (byLabel(view.result.current, en.assistant.teaserDismiss)?.props.onPress as () => void)(),
    );
    expect(view.result.current).toBeNull();
    vi.setSystemTime(T0 + DAY);
    expect((await mount(false)).result.current).toBeNull();
  });

  it('See Pro counts a premium_viewed for the teaser and opens the plans', async () => {
    const view = await mount(false);
    act(() => (byLabel(view.result.current, 'Pro would ask')?.props.onPress as () => void)());
    expect(env.track).toHaveBeenCalledWith('premium_viewed', { screen: 'assistant_teaser' });
    expect(env.push).toHaveBeenCalledWith('/paywall');
  });

  it('never blocks: the row has no overlay, only two buttons', async () => {
    const view = await mount(false);
    const buttons = findAll(view.result.current, (n) => n.props.accessibilityRole !== undefined);
    expect(buttons.map((b) => b.props.accessibilityRole)).toEqual(['link', 'button']);
  });
});

describe('MC-TE-04 telemetry and copy', () => {
  it('sends assistant_teaser_viewed with the kind, once', async () => {
    await mount(false);
    expect(env.track).toHaveBeenCalledTimes(1);
    expect(env.track).toHaveBeenCalledWith('assistant_teaser_viewed', { kind: 'place' });
  });

  it('names the question for the kind of teaser', async () => {
    const view = renderHook(() =>
      AssistantTeaser({ viewerId: 'me', isPro: false, kind: 'receipt' }),
    );
    await flush();
    expect(textOf(view.result.current)).toContain('Pro would ask: Got a receipt?');
  });

  it('is translated in every shipped language and keeps its placeholder', () => {
    for (const language of ['hi', 'ta', 'ar'] as const) {
      const strings = STRINGS_BY_LANGUAGE[language].assistant;
      expect(strings.teaserLine).toContain('{question}');
      expect(strings.teaserPlace).not.toBe(en.assistant.teaserPlace);
      expect(strings.teaserCta).not.toBe(en.assistant.teaserCta);
    }
  });
});

describe('the corrections-by-chat sheet', () => {
  it('opens the plans from "See Pro" and closes on "Not now"', () => {
    const onClose = vi.fn();
    const sheet = renderHook(() => AssistantProSheet({ visible: true, onClose })).result
      .current as FakeElement;
    expect(textOf(sheet)).toContain('Corrections by chat are Pro');
    const buttons = findAll(sheet, (n) => n.type === 'Button');
    act(() => (buttons[0]?.props.onPress as () => void)());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(env.push).toHaveBeenCalledWith('/paywall');
    expect(env.track).toHaveBeenCalledWith('premium_viewed', { screen: 'assistant_teaser' });
    act(() => (buttons[1]?.props.onPress as () => void)());
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
