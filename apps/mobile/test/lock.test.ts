/**
 * The whole-app lock and the personal-ledger gate, driven through their hooks.
 *
 * What is pinned here: a cold start with the lock on is always locked; the
 * grace window re-locks only after the app has been away for at least that
 * long; turning the lock on demands proof first; and the personal gate opens
 * only for a successful check made by a screen that is still on show.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  describeGrace,
  DEFAULT_GRACE_SECONDS,
  LockProvider,
  useLock,
  usePersonalGate,
} from '../src/lib/lock';
import {
  getPersonalLockState,
  markPersonalUnlocked,
  resetPersonalLockForTests,
  setPersonalPresence,
} from '../src/lib/personalLock';
import {
  findAll,
  firstProvider,
  flush,
  renderHook,
  type FakeContext,
  type FakeElement,
} from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());

const env = vi.hoisted(() => ({
  os: 'ios' as string,
  secure: new Map<string, string>(),
  appStateListeners: new Set<(state: string) => void>(),
  segments: [] as string[],
  hasHardware: true,
  enrolled: true,
  authResults: [] as boolean[],
  authCalls: [] as unknown[],
  pendingAuth: null as null | ((ok: boolean) => void),
  holdAuth: false,
}));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return env.os;
    },
  },
  AppState: {
    addEventListener: (_: string, listener: (state: string) => void) => {
      env.appStateListeners.add(listener);
      return { remove: () => env.appStateListeners.delete(listener) };
    },
  },
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => env.secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    env.secure.set(key, value);
  },
}));

vi.mock('expo-local-authentication', () => ({
  hasHardwareAsync: async () => env.hasHardware,
  isEnrolledAsync: async () => env.enrolled,
  authenticateAsync: (options: unknown) => {
    env.authCalls.push(options);
    if (env.holdAuth) {
      return new Promise((resolve) => {
        env.pendingAuth = (ok) => resolve({ success: ok });
      });
    }
    return Promise.resolve({ success: env.authResults.shift() ?? false });
  },
}));

vi.mock('expo-router', async () => {
  const react = await import('./support/fakeReact');
  return {
    useSegments: () => env.segments,
    // Focused for as long as it is mounted; unmount is the blur.
    useFocusEffect: (effect: () => (() => void) | void) => react.useEffect(effect, [effect]),
  };
});

vi.mock('@/lib/legacyKeys', () => ({ legacyKeysMigrated: Promise.resolve() }));

vi.mock('@/i18n', () => ({
  plural: (_locale: string, count: number, forms: string) => `${forms}:${count}`,
}));

type Lock = ReturnType<typeof useLock>;

function emit(state: string) {
  for (const listener of [...env.appStateListeners]) listener(state);
}

async function mountLock() {
  const view = renderHook(() => LockProvider({ children: null }));
  await flush();
  const value = () => firstProvider(view.result.current)!.value as Lock;
  const ctx = () => firstProvider(view.result.current)!.ctx;
  return { view, value, ctx };
}

beforeEach(() => {
  env.os = 'ios';
  env.secure.clear();
  env.appStateListeners.clear();
  env.segments = [];
  env.hasHardware = true;
  env.enrolled = true;
  env.authResults = [];
  env.authCalls = [];
  env.pendingAuth = null;
  env.holdAuth = false;
  resetPersonalLockForTests();
  vi.useRealTimers();
});

describe('the app lock', () => {
  it('is off, unlocked and ready once storage and hardware have answered', async () => {
    const { value } = await mountLock();
    expect(value()).toMatchObject({
      enabled: false,
      locked: false,
      supported: true,
      ready: true,
      graceSeconds: DEFAULT_GRACE_SECONDS,
    });
  });

  it('comes up locked on a cold start when it was turned on, with the stored grace', async () => {
    env.secure.set('waves.app_lock_enabled', 'true');
    env.secure.set('waves.app_lock_grace_seconds', '60');
    const { value } = await mountLock();
    expect(value()).toMatchObject({ enabled: true, locked: true, graceSeconds: 60 });
  });

  it('ignores a stored grace that is not a usable number', async () => {
    env.secure.set('waves.app_lock_grace_seconds', '-4');
    const { value } = await mountLock();
    expect(value().graceSeconds).toBe(DEFAULT_GRACE_SECONDS);
  });

  it('is unsupported and never reads SecureStore on web', async () => {
    env.os = 'web';
    env.secure.set('waves.app_lock_enabled', 'true');
    const { value } = await mountLock();
    expect(value()).toMatchObject({ supported: false, enabled: false, ready: true });
  });

  it('discards the load when unmounted before it lands', async () => {
    env.secure.set('waves.app_lock_enabled', 'true');
    const view = renderHook(() => LockProvider({ children: null }));
    view.unmount();
    await flush();
    expect((firstProvider(view.result.current)!.value as Lock).ready).toBe(false);
  });

  it('will not turn on without a successful check, and turns on after one', async () => {
    const { value } = await mountLock();

    env.authResults = [false];
    await value().setEnabled(true);
    expect(value().enabled).toBe(false);
    expect(env.secure.has('waves.app_lock_enabled')).toBe(false);

    env.authResults = [true];
    await value().setEnabled(true);
    expect(value()).toMatchObject({ enabled: true, locked: false });
    expect(env.secure.get('waves.app_lock_enabled')).toBe('true');

    await value().setEnabled(false);
    expect(value().enabled).toBe(false);
    expect(env.secure.get('waves.app_lock_enabled')).toBe('false');
  });

  it('turns off on web without touching SecureStore', async () => {
    env.os = 'web';
    const { value } = await mountLock();
    await value().setEnabled(false);
    await value().setGraceSeconds(15);
    expect(env.secure.size).toBe(0);
    expect(value().graceSeconds).toBe(15);
  });

  it('stores a new grace window', async () => {
    const { value } = await mountLock();
    await value().setGraceSeconds(300);
    expect(value().graceSeconds).toBe(300);
    expect(env.secure.get('waves.app_lock_grace_seconds')).toBe('300');
  });

  it('unlocks only on a successful check', async () => {
    env.secure.set('waves.app_lock_enabled', 'true');
    const { value } = await mountLock();

    env.authResults = [false];
    await expect(value().unlock()).resolves.toBe(false);
    expect(value().locked).toBe(true);

    env.authResults = [true];
    await expect(value().unlock()).resolves.toBe(true);
    expect(value().locked).toBe(false);
  });

  it('re-locks after being away at least the grace window, timed from the first departure', async () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
    env.secure.set('waves.app_lock_enabled', 'true');
    env.secure.set('waves.app_lock_grace_seconds', '30');
    env.authResults = [true];
    const { value } = await mountLock();
    await value().unlock();
    expect(value().locked).toBe(false);

    // A short trip: inactive then background, back after 20s.
    emit('inactive');
    vi.setSystemTime(1_010_000);
    emit('background');
    vi.setSystemTime(1_020_000);
    emit('active');
    expect(value().locked).toBe(false);

    // A long one: the clock starts at the first departure, not the second.
    vi.setSystemTime(2_000_000);
    emit('inactive');
    vi.setSystemTime(2_025_000);
    emit('background');
    vi.setSystemTime(2_030_000);
    emit('active');
    expect(value().locked).toBe(true);
  });

  it('ignores a return with no departure, and transitions it does not know', async () => {
    env.secure.set('waves.app_lock_enabled', 'true');
    env.authResults = [true];
    const { value } = await mountLock();
    await value().unlock();
    emit('unknown');
    emit('active');
    expect(value().locked).toBe(false);
  });

  it('stops listening once it is turned off', async () => {
    env.secure.set('waves.app_lock_enabled', 'true');
    const { value } = await mountLock();
    const withLock = env.appStateListeners.size;
    await value().setEnabled(false);
    expect(env.appStateListeners.size).toBe(withLock - 1);
  });

  it('refuses to be read outside its provider', () => {
    expect(() => renderHook(() => useLock())).toThrow(/inside LockProvider/);
  });
});

describe('personal presence and the personal idle clock', () => {
  it('follows the router in and out of the private section', async () => {
    const { view } = await mountLock();
    const [presence] = findAll(
      view.result.current,
      (n: FakeElement) => typeof n.type === 'function' && 'graceSeconds' in n.props,
    );
    const render = presence!.type as (props: unknown) => unknown;

    env.segments = ['(tabs)', 'personal'];
    const inside = renderHook(() => render(presence!.props));
    markPersonalUnlocked(5_000);
    expect(getPersonalLockState().awaySince).toBeNull();

    env.segments = ['(tabs)', 'groups'];
    inside.rerender();
    expect(getPersonalLockState().awaySince).not.toBeNull();
  });

  it('marks the ledger away when the app leaves, and re-locks it when it comes back too late', async () => {
    vi.useFakeTimers({ now: 10_000, toFake: ['Date'] });
    await mountLock();
    setPersonalPresence(true, 30);
    markPersonalUnlocked();

    emit('background');
    expect(getPersonalLockState().awaySince).toBe(10_000);

    vi.setSystemTime(10_000 + 31_000);
    emit('active');
    expect(getPersonalLockState().unlockedAt).toBeNull();
  });
});

describe('the personal gate', () => {
  async function gate(prompt = 'Open your ledger') {
    const lock = await mountLock();
    const ctx = lock.ctx() as FakeContext<unknown>;
    const view = renderHook(() => usePersonalGate(prompt), {
      contexts: [[ctx, lock.value()]],
    });
    return { ...lock, gate: view };
  }

  it('asks once it is ready and focused, and opens on success', async () => {
    env.authResults = [true];
    const { gate: view } = await gate('Open your ledger');
    await flush();
    expect(env.authCalls).toEqual([
      { promptMessage: 'Open your ledger', fallbackLabel: 'Use passcode' },
    ]);
    expect(view.result.current).toMatchObject({ unlocked: true, checking: false, failed: false });
  });

  it('stays shut after a refusal, and asks again on retry', async () => {
    env.authResults = [false];
    const { gate: view } = await gate();
    await flush();
    expect(view.result.current).toMatchObject({ unlocked: false, failed: true });
    expect(env.authCalls).toHaveLength(1);

    env.authResults = [true];
    view.result.current.retry();
    await flush();
    expect(env.authCalls).toHaveLength(2);
    expect(view.result.current).toMatchObject({ unlocked: true, failed: false });
  });

  it('opens without asking when nothing is enrolled', async () => {
    env.enrolled = false;
    const { gate: view } = await gate();
    await flush();
    expect(env.authCalls).toHaveLength(0);
    expect(view.result.current.unlocked).toBe(true);
  });

  it('does not open for an answer that lands after the screen has gone', async () => {
    env.holdAuth = true;
    const { gate: view } = await gate();
    await flush();
    expect(view.result.current.checking).toBe(true);

    view.unmount();
    env.pendingAuth!(true);
    await flush();
    expect(getPersonalLockState().unlockedAt).toBeNull();
  });

  it('waits for the lock to be ready before deciding anything', () => {
    const view = renderHook(() => usePersonalGate('x'), {
      contexts: [
        [
          firstProvider(renderHook(() => LockProvider({ children: null })).result.current)!.ctx,
          { graceSeconds: 30, supported: false, ready: false },
        ],
      ],
    });
    expect(env.authCalls).toHaveLength(0);
    expect(view.result.current.unlocked).toBe(false);
  });
});

describe('describeGrace', () => {
  const t = {
    lock: { graceImmediate: 'Straight away', graceSeconds: 'secs', graceMinutes: 'mins' },
  } as unknown as Parameters<typeof describeGrace>[1];

  it('says straight away, seconds, or whole minutes', () => {
    expect(describeGrace(0, t, 'en')).toBe('Straight away');
    expect(describeGrace(-5, t, 'en')).toBe('Straight away');
    expect(describeGrace(30, t, 'en')).toBe('secs:30');
    expect(describeGrace(60, t, 'en')).toBe('mins:1');
    expect(describeGrace(300, t, 'en')).toBe('mins:5');
  });
});
