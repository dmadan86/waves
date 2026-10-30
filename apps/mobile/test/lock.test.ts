/**
 * The one app lock, driven through its provider: on by default where the device
 * can lock, locked on a cold start of a signed-in app, never right after a
 * sign-in, and re-locked only after being away at least the grace window.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { describeGrace, DEFAULT_GRACE_SECONDS, LockProvider, useLock } from '../src/lib/lock';
import { firstProvider, flush, renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());

const env = vi.hoisted(() => ({
  os: 'ios' as string,
  secure: new Map<string, string>(),
  appStateListeners: new Set<(state: string) => void>(),
  userId: 'u1' as string | null,
  authLoading: false,
  level: 1,
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
  getEnrolledLevelAsync: async () => env.level,
  SecurityLevel: { NONE: 0 },
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

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    loading: env.authLoading,
    session: env.userId ? { user: { id: env.userId } } : null,
  }),
}));

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
  return { view, value };
}

beforeEach(() => {
  env.os = 'ios';
  env.secure.clear();
  env.appStateListeners.clear();
  env.userId = 'u1';
  env.authLoading = false;
  env.level = 1;
  env.hasHardware = true;
  env.enrolled = true;
  env.authResults = [];
  env.authCalls = [];
  env.pendingAuth = null;
  env.holdAuth = false;
  vi.useRealTimers();
});

describe('the app lock', () => {
  it('is on by default and locks a signed-in cold start', async () => {
    const { value } = await mountLock();
    expect(value()).toMatchObject({
      enabled: true,
      locked: true,
      supported: true,
      ready: true,
      graceSeconds: DEFAULT_GRACE_SECONDS,
    });
  });

  it('respects an explicit off, and stays off with nothing to unlock with', async () => {
    env.secure.set('waves.app_lock_enabled', 'false');
    expect((await mountLock()).value()).toMatchObject({ enabled: false, locked: false });

    env.secure.clear();
    env.hasHardware = false;
    expect((await mountLock()).value()).toMatchObject({ enabled: false, supported: false });

    env.hasHardware = true;
    env.enrolled = false;
    env.level = 0;
    expect((await mountLock()).value()).toMatchObject({ enabled: false, supported: false });

    env.level = 1; // a device passcode alone is enough
    expect((await mountLock()).value()).toMatchObject({ enabled: true, supported: true });
  });

  it('never locks a signed-out user, nor one who signs in afterwards', async () => {
    env.userId = null;
    const { view, value } = await mountLock();
    expect(value().locked).toBe(false);

    env.userId = 'u2';
    view.rerender();
    await flush();
    expect(value().locked).toBe(false);
  });

  it('does not carry a cold-start lock across sign-out and back in', async () => {
    const { view, value } = await mountLock();
    expect(value().locked).toBe(true);

    env.userId = null;
    view.rerender();
    await flush();
    env.userId = 'u1';
    view.rerender();
    await flush();
    expect(value().locked).toBe(false);
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
    env.secure.set('waves.app_lock_enabled', 'false');
    const { value } = await mountLock();

    env.authResults = [false];
    await value().setEnabled(true);
    expect(value().enabled).toBe(false);
    expect(env.secure.get('waves.app_lock_enabled')).toBe('false');

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

  it('does not count its own biometric sheet as leaving, even with a zero window', async () => {
    env.secure.set('waves.app_lock_grace_seconds', '0');
    env.holdAuth = true;
    const { value } = await mountLock();
    const asking = value().unlock();
    emit('inactive');
    emit('active');
    env.pendingAuth!(true);
    await asking;
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
