/**
 * The plumbing under the operator's release policy and notices.
 *
 * Nothing here decides anything — `appState` in @waves/core does, and has its
 * own tests. What this file must get right is what it feeds that decider: the
 * cache before the network, the cache kept when the network fails, dismissals
 * remembered per version and per notice, and a re-ask on every foreground.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppStatusProvider, useAppStatus } from '../src/lib/appStatus';
import { firstProvider, flush, renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());

const env = vi.hoisted(() => ({
  listeners: new Set<(state: string) => void>(),
  opened: [] as string[],
  policy: vi.fn(),
  notices: vi.fn(),
  decider: vi.fn(),
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  AppState: {
    addEventListener: (_: string, listener: (state: string) => void) => {
      env.listeners.add(listener);
      return { remove: () => env.listeners.delete(listener) };
    },
  },
  Linking: {
    openURL: async (url: string) => {
      env.opened.push(url);
    },
  },
}));

vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '1.4.0' } } }));

vi.mock('@/data/api', () => ({
  fetchReleasePolicy: (platform: string) => env.policy(platform),
  fetchAppNotices: () => env.notices(),
}));

vi.mock('@/i18n', () => ({
  deviceCountry: () => 'IN',
  useStrings: () => ({ language: 'ta' }),
}));

vi.mock('@/lib/legacyKeys', () => ({ legacyKeysMigrated: Promise.resolve() }));

// The decider is tested in @waves/core. Here it only has to reflect its inputs,
// so the test can see exactly what the provider handed it.
vi.mock('@waves/core', () => ({
  appState: (input: { release: { latest?: string; url?: string } | null; notices: unknown }) => {
    env.decider(input);
    return {
      gate: 'none',
      latestVersion: input.release?.latest ?? null,
      storeUrl: input.release?.url ?? null,
      gateText: null,
      banner: null,
      notices: Array.isArray(input.notices) ? input.notices : [],
    };
  },
}));

type Status = ReturnType<typeof useAppStatus>;

function lastInput() {
  return env.decider.mock.calls.at(-1)![0] as Record<string, unknown>;
}

async function mount() {
  const view = renderHook(() => AppStatusProvider({ children: null }));
  await flush();
  const value = () => firstProvider(view.result.current)!.value as Status;
  return { view, value };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  env.listeners.clear();
  env.opened = [];
  env.policy.mockReset();
  env.notices.mockReset();
  env.decider.mockReset();
  env.policy.mockResolvedValue(null);
  env.notices.mockResolvedValue([]);
});

describe('what the provider feeds the decider', () => {
  it('asks for this platform, this build, this country and the language on screen', async () => {
    const { value } = await mount();
    expect(env.policy).toHaveBeenCalledWith('android');
    expect(lastInput()).toMatchObject({
      installedVersion: '1.4.0',
      platform: 'android',
      country: 'IN',
      locale: 'ta',
    });
    expect(value().installed).toBe('1.4.0');
  });

  it('uses and then refreshes the cached answer', async () => {
    await AsyncStorage.setItem('waves.release_policy', JSON.stringify({ latest: '1.5.0' }));
    await AsyncStorage.setItem('waves.app_notices', JSON.stringify([{ id: 'n1' }]));
    env.policy.mockResolvedValue({ latest: '1.6.0', url: 'market://waves' });
    env.notices.mockResolvedValue([{ id: 'n2' }]);

    const { value } = await mount();

    expect(env.decider.mock.calls.some(([i]) => i.release?.latest === '1.5.0')).toBe(true);
    expect(value().latestVersion).toBe('1.6.0');
    expect(value().notices).toEqual([{ id: 'n2' }]);
    await expect(AsyncStorage.getItem('waves.release_policy')).resolves.toBe(
      JSON.stringify({ latest: '1.6.0', url: 'market://waves' }),
    );
    await expect(AsyncStorage.getItem('waves.app_notices')).resolves.toBe(
      JSON.stringify([{ id: 'n2' }]),
    );
  });

  it('keeps the cached answer when both fetches fail', async () => {
    await AsyncStorage.setItem('waves.release_policy', JSON.stringify({ latest: '1.5.0' }));
    await AsyncStorage.setItem('waves.app_notices', JSON.stringify([{ id: 'n1' }]));
    env.policy.mockRejectedValue(new Error('offline'));
    env.notices.mockRejectedValue(new Error('offline'));

    const { value } = await mount();

    expect(value().latestVersion).toBe('1.5.0');
    expect(value().notices).toEqual([{ id: 'n1' }]);
  });

  it('treats an unreadable cache as no cache', async () => {
    await AsyncStorage.setItem('waves.release_policy', '{not json');
    await AsyncStorage.setItem('waves.notices_dismissed', JSON.stringify(['a', 3, 'b']));
    await mount();
    expect(lastInput()).toMatchObject({ release: null, dismissedNoticeIds: ['a', 'b'] });
  });

  it('ignores a dismissed-notice list that is not a list', async () => {
    await AsyncStorage.setItem('waves.notices_dismissed', JSON.stringify({ a: 1 }));
    await mount();
    expect(lastInput().dismissedNoticeIds).toEqual([]);
  });

  it('re-asks on every foreground, and not for other transitions', async () => {
    await mount();
    expect(env.policy).toHaveBeenCalledTimes(1);

    for (const listener of env.listeners) listener('background');
    for (const listener of env.listeners) listener('active');
    await flush();
    expect(env.policy).toHaveBeenCalledTimes(2);
  });

  it('stops listening and drops the load after unmount', async () => {
    const view = renderHook(() => AppStatusProvider({ children: null }));
    view.unmount();
    await flush();
    expect(env.listeners.size).toBe(0);
    expect(env.policy).not.toHaveBeenCalled();
  });

  it('recheck asks the server again on demand', async () => {
    const { value } = await mount();
    env.policy.mockResolvedValue({ latest: '2.0.0' });
    await value().recheck();
    await flush();
    expect(value().latestVersion).toBe('2.0.0');
  });
});

describe('dismissals', () => {
  it('waves away the soft update for the version offered, and remembers it', async () => {
    env.policy.mockResolvedValue({ latest: '1.6.0' });
    const { value } = await mount();
    value().dismissUpdate();
    await flush();
    expect(lastInput().dismissedUpdateVersion).toBe('1.6.0');
    await expect(AsyncStorage.getItem('waves.update_dismissed')).resolves.toBe('1.6.0');
  });

  it('has nothing to dismiss when no version is offered', async () => {
    const { value } = await mount();
    value().dismissUpdate();
    await flush();
    await expect(AsyncStorage.getItem('waves.update_dismissed')).resolves.toBeNull();
  });

  it('remembers dismissed notices once each, keeping only the last fifty', async () => {
    const ids = Array.from({ length: 49 }, (_, i) => `old${i}`);
    await AsyncStorage.setItem('waves.notices_dismissed', JSON.stringify(ids));
    const { value } = await mount();

    value().dismissNotice('old3');
    value().dismissNotice('new1');
    value().dismissNotice('new2');
    await flush();

    const stored = JSON.parse((await AsyncStorage.getItem('waves.notices_dismissed'))!);
    expect(stored).toHaveLength(50);
    expect(stored[0]).toBe('old1');
    expect(stored.slice(-2)).toEqual(['new1', 'new2']);
    expect(stored.filter((id: string) => id === 'old3')).toHaveLength(1);
  });
});

describe('the store button', () => {
  it('opens the store page the policy named', async () => {
    env.policy.mockResolvedValue({ latest: '1.6.0', url: 'market://details?id=waves' });
    const { value } = await mount();
    value().openStore();
    await flush();
    expect(env.opened).toEqual(['market://details?id=waves']);
  });

  it('does nothing when there is nowhere to go', async () => {
    const { value } = await mount();
    value().openStore();
    await flush();
    expect(env.opened).toEqual([]);
  });
});

it('refuses to be read outside its provider', () => {
  expect(() => renderHook(() => useAppStatus())).toThrow(/inside AppStatusProvider/);
});
