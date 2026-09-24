/**
 * The session provider: who is signed in, their profile, and every door in.
 *
 * Driven through the synchronous fake React in `support/fakeReact`, so each
 * test is the provider mounted once, its effects run, and the value it hands
 * its children read back. Supabase, the browser and the native sheets are all
 * stand-ins; `@waves/core` (which decides *which* call each door makes) is the
 * real thing, because that decision is the part worth pinning.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetClaimedCodes } from '../src/lib/oauthClaim';
import { firstProvider, flush, renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());

type Query = {
  table: string;
  op: 'select' | 'insert' | 'update';
  cols?: string;
  returning?: string;
  payload?: Record<string, unknown>;
  filters: [string, unknown][];
  terminal?: 'single' | 'maybeSingle';
};

type Result = { data: unknown; error: unknown };

const world = vi.hoisted(() => ({
  listener: null as ((event: string, session: unknown) => void) | null,
  unsubscribed: 0,
  linkListener: null as ((event: { url: string }) => void) | null,
  linkRemoved: 0,
  initialUrl: null as string | null,
  queries: [] as unknown[],
  db: (() => ({ data: null, error: null })) as (q: never) => Result,
  auth: {} as Record<string, ReturnType<typeof vi.fn>>,
  browser: vi.fn(),
  order: [] as string[],
  peek: (() => Promise.resolve(null)) as () => Promise<unknown>,
}));

vi.mock('@/lib/backend', () => {
  const query = (table: string) => {
    const q: Query = { table, op: 'select', filters: [] };
    const run = () => {
      world.queries.push(q);
      return Promise.resolve(world.db(q as never));
    };
    const builder = {
      select(cols: string) {
        if (q.op === 'select') q.cols = cols;
        else q.returning = cols;
        return builder;
      },
      insert(payload: Record<string, unknown>) {
        q.op = 'insert';
        q.payload = payload;
        return builder;
      },
      update(payload: Record<string, unknown>) {
        q.op = 'update';
        q.payload = payload;
        return builder;
      },
      eq(col: string, value: unknown) {
        q.filters.push([col, value]);
        return builder;
      },
      maybeSingle() {
        q.terminal = 'maybeSingle';
        return run();
      },
      single() {
        q.terminal = 'single';
        return run();
      },
      then(resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) {
        return run().then(resolve, reject);
      },
    };
    return builder;
  };
  return {
    peekSession: () => world.peek(),
    backend: {
      auth: new Proxy(
        {},
        {
          get: (_t, name: string) => {
            if (name === 'onAuthStateChange') {
              return (fn: (event: string, session: unknown) => void) => {
                world.listener = fn;
                return {
                  data: {
                    subscription: {
                      unsubscribe: () => {
                        world.unsubscribed += 1;
                      },
                    },
                  },
                };
              };
            }
            return world.auth[name];
          },
        },
      ),
      from: (table: string) => query(table),
    },
  };
});

vi.mock('expo-auth-session', () => ({ makeRedirectUri: () => 'waves://auth' }));
vi.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (...args: unknown[]) => world.browser(...args),
}));
vi.mock('expo-linking', () => ({
  getInitialURL: async () => world.initialUrl,
  addEventListener: (_name: string, fn: (event: { url: string }) => void) => {
    world.linkListener = fn;
    return {
      remove: () => {
        world.linkRemoved += 1;
      },
    };
  },
}));

const spies = vi.hoisted(() => ({
  cancelNudges: vi.fn(async () => {}),
  clearCaptureNudge: vi.fn(async (_id: string) => {}),
  googleNativeSignIn: vi.fn(),
  appleNativeSignIn: vi.fn(),
  identifyForReporting: vi.fn(),
  reportHandled: vi.fn(),
  sendPhoneCode: vi.fn(async (_phone: string) => {}),
  confirmPhoneCode: vi.fn(async (_phone: string, _code: string) => {}),
  lockPersonal: vi.fn(),
  syncPersonalAccount: vi.fn(),
  refreshPushToken: vi.fn(async () => ({ ok: true })),
  revokePushToken: vi.fn(async () => {}),
  markDeliberateSignOut: vi.fn(),
}));

vi.mock('@/lib/captureNudge/schedule', () => ({ cancelNudges: spies.cancelNudges }));
vi.mock('@/lib/captureNudge/settings', () => ({ clearCaptureNudge: spies.clearCaptureNudge }));
vi.mock('@/lib/nativeIdentity', () => ({
  googleNativeSignIn: spies.googleNativeSignIn,
  appleNativeSignIn: spies.appleNativeSignIn,
}));
vi.mock('@/lib/observability', () => ({
  identifyForReporting: spies.identifyForReporting,
  reportHandled: spies.reportHandled,
}));
vi.mock('@/lib/phoneAuth', () => ({
  sendPhoneCode: spies.sendPhoneCode,
  confirmPhoneCode: spies.confirmPhoneCode,
}));
vi.mock('@/lib/personalLock', () => ({
  lockPersonal: spies.lockPersonal,
  syncPersonalAccount: spies.syncPersonalAccount,
}));
vi.mock('@/lib/push', () => ({
  refreshPushToken: spies.refreshPushToken,
  revokePushToken: spies.revokePushToken,
}));
vi.mock('@/sync/retention', () => ({ markDeliberateSignOut: spies.markDeliberateSignOut }));

const { AuthProvider, useAuth, useViewerId } = await import('../src/lib/auth');

type AuthValue = ReturnType<typeof useAuth>;

function user(id: string, extra: Record<string, unknown> = {}) {
  return { user: { id, is_anonymous: false, user_metadata: {}, ...extra } };
}

function guest(id: string) {
  return { user: { id, is_anonymous: true, user_metadata: {} } };
}

function profileRow(id: string, name = 'Asha') {
  return {
    id,
    display_name: name,
    avatar_url: null,
    default_vpa: null,
    payment_rail: null,
    payment_handle: null,
    country_code: 'IN',
    address: null,
    default_currency: 'INR',
    locale: 'en',
  };
}

/** A database whose `profiles` table holds exactly these rows. */
function tableOf(rows: Record<string, ReturnType<typeof profileRow>>) {
  return (q: Query): Result => {
    const id = q.filters.find(([c]) => c === 'id')?.[1] as string;
    if (q.op === 'select') return { data: rows[id] ?? null, error: null };
    if (q.op === 'insert') {
      rows[q.payload!.id as string] = { ...profileRow(q.payload!.id as string), ...q.payload };
      return { data: null, error: null };
    }
    if (!rows[id]) return { data: [], error: null };
    rows[id] = { ...rows[id]!, ...q.payload };
    return { data: q.terminal === 'single' ? rows[id] : [{ id }], error: null };
  };
}

let session: unknown = null;

beforeEach(() => {
  vi.clearAllMocks();
  resetClaimedCodes();
  vi.stubGlobal('__DEV__', false);
  session = null;
  world.listener = null;
  world.linkListener = null;
  world.unsubscribed = 0;
  world.linkRemoved = 0;
  world.initialUrl = null;
  world.queries = [];
  world.order = [];
  world.peek = () => Promise.resolve(null);
  world.db = tableOf({}) as never;
  world.browser = vi.fn();
  world.auth = {
    getSession: vi.fn(async () => ({ data: { session } })),
    exchangeCodeForSession: vi.fn(async (code: string) => ({
      data: { session: user(`from-${code}`) },
      error: null,
    })),
    linkIdentity: vi.fn(async () => ({ data: { url: 'https://idp/link' }, error: null })),
    signInWithOAuth: vi.fn(async () => ({ data: { url: 'https://idp/signin' }, error: null })),
    updateUser: vi.fn(async () => ({ data: {}, error: null })),
    signInWithOtp: vi.fn(async () => ({ error: null })),
    verifyOtp: vi.fn(async () => ({ error: null })),
    signInAnonymously: vi.fn(async () => ({ error: null })),
    signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
    signInWithPassword: vi.fn(async () => ({ data: { session: user('u1') }, error: null })),
    signInWithIdToken: vi.fn(async () => ({
      data: { session: user('native-1'), user: { id: 'native-1' } },
      error: null,
    })),
    signOut: vi.fn(async () => {
      world.order.push('signOut');
      return { error: null };
    }),
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Mount the provider and let its first round of promises land. */
async function mount() {
  const view = renderHook(() => AuthProvider({ children: null }));
  await flush();
  return {
    view,
    get value() {
      return firstProvider(view.result.current)!.value as AuthValue;
    },
  };
}

// ─────────────────────────────────────────────────────────── boot ──

describe('starting up', () => {
  it('restores the stored session, then loads that account’s profile', async () => {
    session = user('u1');
    world.db = tableOf({ u1: profileRow('u1', 'Asha') }) as never;

    const auth = await mount();

    expect(auth.value.loading).toBe(false);
    expect(auth.value.session).toBe(session);
    expect(auth.value.isGuest).toBe(false);
    expect(auth.value.profile?.display_name).toBe('Asha');
    expect(auth.value.profileSettled).toBe(false);
    expect(spies.syncPersonalAccount).toHaveBeenCalledWith('u1');
    expect(spies.identifyForReporting).toHaveBeenLastCalledWith('u1');
    expect(spies.refreshPushToken).toHaveBeenCalledTimes(1);
  });

  it('opens on the session saved on the phone without waiting for the network', async () => {
    const stored = user('u1');
    world.peek = () => Promise.resolve(stored);
    // A refresh that never comes back: an hour-old token on a dead connection.
    world.auth.getSession!.mockImplementationOnce(() => new Promise(() => {}));

    const auth = await mount();

    expect(auth.value.loading).toBe(false);
    expect(auth.value.session).toBe(stored);
    expect(spies.syncPersonalAccount).toHaveBeenCalledWith('u1');
  });

  it('lets the real session answer over the saved one when it lands', async () => {
    let releasePeek: (value: unknown) => void = () => {};
    world.peek = () => new Promise((resolve) => (releasePeek = resolve));
    session = null;

    const auth = await mount();
    // The refresh was refused and the saved session arrives late: still signed out.
    releasePeek(user('stale'));
    await flush();

    expect(auth.value.loading).toBe(false);
    expect(auth.value.session).toBeNull();
  });

  it('treats a session that cannot be read as a signed-out launch, not a dead one', async () => {
    world.auth.getSession!.mockRejectedValueOnce(new Error('keystore locked'));

    const auth = await mount();

    expect(auth.value.loading).toBe(false);
    expect(auth.value.session).toBeNull();
    expect(auth.value.profile).toBeNull();
    expect(spies.reportHandled).toHaveBeenCalledWith(expect.any(Error), 'auth.getSession');
    expect(spies.refreshPushToken).not.toHaveBeenCalled();
    expect(spies.identifyForReporting).toHaveBeenLastCalledWith(null);
  });

  it('ignores a session read that lands after unmount, and lets go of its listeners', async () => {
    session = user('u1');
    const view = renderHook(() => AuthProvider({ children: null }));
    view.unmount();
    await flush();

    const value = firstProvider(view.result.current)!.value as AuthValue;
    expect(value.loading).toBe(true);
    expect(value.session).toBeNull();
    expect(world.unsubscribed).toBe(1);
    expect(world.linkRemoved).toBe(1);
  });

  it('marks a guest as a guest', async () => {
    session = guest('g1');
    const auth = await mount();
    expect(auth.value.isGuest).toBe(true);
  });
});

// ─────────────────────────────────────────────── session changes ──

describe('a session that changes underneath', () => {
  it('follows the auth listener, and keys the personal unlock to the new account', async () => {
    session = user('u1');
    world.db = tableOf({ u1: profileRow('u1', 'Asha'), u2: profileRow('u2', 'Ben') }) as never;
    const auth = await mount();

    world.listener!('SIGNED_IN', user('u2'));
    await flush();

    expect((auth.value.session as { user: { id: string } }).user.id).toBe('u2');
    expect(auth.value.profile?.display_name).toBe('Ben');
    expect(spies.syncPersonalAccount).toHaveBeenLastCalledWith('u2');

    world.listener!('SIGNED_OUT', null);
    await flush();
    expect(auth.value.session).toBeNull();
    expect(auth.value.profile).toBeNull();
    expect(spies.syncPersonalAccount).toHaveBeenLastCalledWith(null);
  });

  it('never shows one account’s profile to the next, even for a moment', async () => {
    session = user('u1');
    const rows = { u1: profileRow('u1', 'Asha') };
    world.db = tableOf(rows) as never;
    const auth = await mount();
    expect(auth.value.profile?.display_name).toBe('Asha');

    // B's row is not there yet, so B's load is still retrying — and A's
    // profile, still in state, must not be read as B's.
    vi.useFakeTimers();
    world.listener!('SIGNED_IN', user('u2'));
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.value.profile).toBeNull();
    expect(auth.value.profileSettled).toBe(false);
  });

  it('re-reads the session on refresh', async () => {
    const auth = await mount();
    session = user('u9');
    await auth.value.refresh();
    await flush();
    expect((auth.value.session as { user: { id: string } }).user.id).toBe('u9');
  });
});

// ────────────────────────────────────────────────── the profile ──

describe('loading the profile', () => {
  it('writes the row itself when the trigger never did, from what the provider sent', async () => {
    vi.useFakeTimers();
    session = user('u1', {
      user_metadata: { full_name: '  Asha Rao ', picture: 'https://pic', locale: ' ta ' },
    });
    const rows: Record<string, ReturnType<typeof profileRow>> = {};
    world.db = tableOf(rows) as never;

    const view = renderHook(() => AuthProvider({ children: null }));
    await vi.advanceTimersByTimeAsync(5_000);

    const insert = (world.queries as Query[]).find((q) => q.op === 'insert');
    expect(insert?.payload).toEqual({
      id: 'u1',
      display_name: 'Asha Rao',
      avatar_url: 'https://pic',
      locale: 'ta',
    });
    // Five reads before giving up on the trigger, then the one after the insert.
    expect((world.queries as Query[]).filter((q) => q.op === 'select')).toHaveLength(6);
    const value = firstProvider(view.result.current)!.value as AuthValue;
    expect(value.profile?.display_name).toBe('Asha Rao');
  });

  it('falls back to the placeholder name and English when the provider sent nothing', async () => {
    vi.useFakeTimers();
    session = user('u1', { user_metadata: { display_name: '   ', locale: '  ' } });
    world.db = tableOf({}) as never;

    renderHook(() => AuthProvider({ children: null }));
    await vi.advanceTimersByTimeAsync(5_000);

    const insert = (world.queries as Query[]).find((q) => q.op === 'insert');
    expect(insert?.payload).toEqual({
      id: 'u1',
      display_name: 'Guest',
      avatar_url: null,
      locale: 'en',
    });
  });

  it('counts a lost insert race as success and uses the row the trigger wrote', async () => {
    vi.useFakeTimers();
    session = user('u1', { user_metadata: { name: 'N' } });
    let inserted = false;
    world.db = ((q: Query): Result => {
      if (q.op === 'insert') {
        inserted = true;
        return { data: null, error: { code: '23505', message: 'duplicate' } };
      }
      return { data: inserted ? profileRow('u1', 'From trigger') : null, error: null };
    }) as never;

    const view = renderHook(() => AuthProvider({ children: null }));
    await vi.advanceTimersByTimeAsync(5_000);

    const value = firstProvider(view.result.current)!.value as AuthValue;
    expect(value.profile?.display_name).toBe('From trigger');
    expect(spies.reportHandled).not.toHaveBeenCalled();
  });

  it('settles without a profile when the insert is refused, so screens can offer a retry', async () => {
    vi.useFakeTimers();
    session = user('u1');
    world.db = ((q: Query): Result =>
      q.op === 'insert'
        ? { data: null, error: { code: '42501', message: 'denied' } }
        : { data: null, error: null }) as never;

    const view = renderHook(() => AuthProvider({ children: null }));
    await vi.advanceTimersByTimeAsync(5_000);

    const value = firstProvider(view.result.current)!.value as AuthValue;
    expect(value.profile).toBeNull();
    expect(value.profileSettled).toBe(true);
    expect(spies.reportHandled).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'denied' }),
      'auth.loadProfile',
    );
  });

  it('reports a row still missing after the self-heal instead of waiting for ever', async () => {
    vi.useFakeTimers();
    session = user('u1');
    world.db = (() => ({ data: null, error: null })) as never;

    const view = renderHook(() => AuthProvider({ children: null }));
    await vi.advanceTimersByTimeAsync(5_000);

    expect((firstProvider(view.result.current)!.value as AuthValue).profileSettled).toBe(true);
    expect(spies.reportHandled).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'profile row missing after self-heal' }),
      'auth.loadProfile',
    );
  });

  it('does not insert over a read that failed, and a retry loads it once it works', async () => {
    session = user('u1');
    let failing = true;
    world.db = ((q: Query): Result => {
      if (failing) return { data: null, error: { message: 'offline' } };
      return { data: profileRow('u1', 'Back'), error: null };
    }) as never;

    const auth = await mount();
    expect(auth.value.profileSettled).toBe(true);
    expect((world.queries as Query[]).some((q) => q.op === 'insert')).toBe(false);

    failing = false;
    auth.value.reloadProfile();
    await flush();

    expect(auth.value.profile?.display_name).toBe('Back');
    expect(auth.value.profileSettled).toBe(false);
  });

  it('updates the profile and keeps what the database returned', async () => {
    session = user('u1');
    world.db = tableOf({ u1: profileRow('u1', 'Asha') }) as never;
    const auth = await mount();

    await auth.value.updateProfile({ display_name: 'Asha R' });
    await flush();

    expect(auth.value.profile?.display_name).toBe('Asha R');
  });

  it('refuses a profile update with nobody signed in, and surfaces a database refusal', async () => {
    const auth = await mount();
    await expect(auth.value.updateProfile({ display_name: 'x' })).rejects.toThrow('Not signed in');

    session = user('u1');
    world.listener!('SIGNED_IN', session);
    world.db = ((q: Query): Result =>
      q.op === 'update'
        ? { data: null, error: new Error('rls') }
        : { data: profileRow('u1'), error: null }) as never;
    await flush();
    await expect(auth.value.updateProfile({ display_name: 'x' })).rejects.toThrow('rls');
  });
});

// ─────────────────────────────────────────── the link callback ──

describe('a sign-in that outlived the process that started it', () => {
  it('redeems the code in the launch link', async () => {
    world.initialUrl = 'waves://auth?code=launch';
    const auth = await mount();

    expect(world.auth.exchangeCodeForSession).toHaveBeenCalledWith('launch');
    expect((auth.value.session as { user: { id: string } }).user.id).toBe('from-launch');
  });

  it('redeems a code only once however many times the link arrives', async () => {
    const auth = await mount();

    world.linkListener!({ url: 'waves://auth?code=twice' });
    world.linkListener!({ url: 'waves://auth?code=twice' });
    await flush();

    expect(world.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect((auth.value.session as { user: { id: string } }).user.id).toBe('from-twice');
  });

  it('ignores a link with no code, and reports a code that would not redeem', async () => {
    await mount();
    world.linkListener!({ url: 'waves://groups/1' });
    await flush();
    expect(world.auth.exchangeCodeForSession).not.toHaveBeenCalled();

    world.auth.exchangeCodeForSession!.mockResolvedValueOnce({
      data: { session: null },
      error: new Error('expired'),
    });
    world.linkListener!({ url: 'waves://auth?code=stale' });
    await flush();
    expect(spies.reportHandled).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'expired' }),
      'auth.linkCallback',
    );
  });
});

// ──────────────────────────────────────────── codes and guests ──

describe('codes and the guest door', () => {
  it('hands phone codes to the phone module', async () => {
    const auth = await mount();
    await auth.value.sendOtp('+911234567890');
    await auth.value.verifyOtp('+911234567890', '123456');
    expect(spies.sendPhoneCode).toHaveBeenCalledWith('+911234567890');
    expect(spies.confirmPhoneCode).toHaveBeenCalledWith('+911234567890', '123456');
  });

  it('mails an email code, creating an account only when asked to', async () => {
    const auth = await mount();
    await auth.value.sendEmailOtp('  a@b.co ', false);
    expect(world.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'a@b.co',
      options: { shouldCreateUser: false },
    });

    await auth.value.verifyEmailOtp(' a@b.co ', ' 123456 ');
    expect(world.auth.verifyOtp).toHaveBeenCalledWith({
      email: 'a@b.co',
      token: '123456',
      type: 'email',
    });
  });

  it('surfaces every refusal from the code and guest calls', async () => {
    const auth = await mount();
    world.auth.signInWithOtp!.mockResolvedValueOnce({ error: new Error('rate limited') });
    await expect(auth.value.sendEmailOtp('a@b.co', true)).rejects.toThrow('rate limited');
    world.auth.verifyOtp!.mockResolvedValueOnce({ error: new Error('wrong code') });
    await expect(auth.value.verifyEmailOtp('a@b.co', '1')).rejects.toThrow('wrong code');
    world.auth.signInAnonymously!.mockResolvedValueOnce({ error: new Error('disabled') });
    await expect(auth.value.continueAsGuest()).rejects.toThrow('disabled');
  });

  it('opens an anonymous session for a guest', async () => {
    const auth = await mount();
    await auth.value.continueAsGuest();
    expect(world.auth.signInAnonymously).toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────── passwords ──

describe('email or phone and a password', () => {
  it('signs somebody with nothing in', async () => {
    const auth = await mount();
    await expect(auth.value.withPassword('A@B.co', 'long-enough-pw', 'sign_in')).resolves.toEqual(
      {},
    );
    expect(world.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@b.co',
      password: 'long-enough-pw',
    });
  });

  it('signs up by email with the name, and says to check the inbox when no session came back', async () => {
    const auth = await mount();
    const outcome = await auth.value.withPassword('a@b.co', 'long-enough-pw', 'sign_up', ' Asha ');
    expect(outcome).toEqual({ verifyEmail: 'a@b.co' });
    expect(world.auth.signUp).toHaveBeenCalledWith({
      email: 'a@b.co',
      password: 'long-enough-pw',
      options: { data: { display_name: 'Asha' } },
    });
  });

  it('carries no blank name, and a phone sign-up never waits on an inbox', async () => {
    const auth = await mount();
    const outcome = await auth.value.withPassword(
      '+919876543210',
      'long-enough-pw',
      'sign_up',
      '  ',
    );
    expect(outcome).toEqual({});
    expect(world.auth.signUp).toHaveBeenCalledWith({
      phone: '+919876543210',
      password: 'long-enough-pw',
    });
  });

  it('refuses a weak password before calling anything, and surfaces a refused sign-in', async () => {
    const auth = await mount();
    await expect(auth.value.withPassword('a@b.co', 'short', 'sign_in')).rejects.toThrow(/at least/);
    expect(world.auth.signInWithPassword).not.toHaveBeenCalled();

    world.auth.signInWithPassword!.mockResolvedValueOnce({
      data: { session: null },
      error: new Error('Invalid login'),
    });
    await expect(auth.value.withPassword('a@b.co', 'long-enough-pw', 'sign_in')).rejects.toThrow(
      'Invalid login',
    );
  });

  it('upgrades a guest in place, and writes the chosen name over the placeholder', async () => {
    vi.useFakeTimers();
    session = guest('g1');
    const rows = { g1: profileRow('g1', 'Guest') };
    // The profiles row answers an update only on the second try, the way it
    // does when the trigger lands a beat late.
    let updates = 0;
    const table = tableOf(rows);
    world.db = ((q: Query): Result => {
      if (q.op === 'update' && q.returning === 'id' && ++updates === 1) {
        return { data: [], error: null };
      }
      return table(q);
    }) as never;
    const view = renderHook(() => AuthProvider({ children: null }));
    await vi.advanceTimersByTimeAsync(0);
    const value = () => firstProvider(view.result.current)!.value as AuthValue;
    expect(value().profile?.display_name).toBe('Guest');

    session = user('g1');
    const pending = value().withPassword('a@b.co', 'long-enough-pw', 'sign_up', 'Asha');
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toEqual({});

    expect(world.auth.signUp).not.toHaveBeenCalled();
    expect(world.auth.updateUser).toHaveBeenCalledWith({
      email: 'a@b.co',
      password: 'long-enough-pw',
      data: { display_name: 'Asha' },
    });
    // The metadata copy is written first, whatever the row does.
    expect(world.auth.updateUser).toHaveBeenCalledWith({ data: { display_name: 'Asha' } });
    expect(updates).toBe(2);
    expect(rows.g1.display_name).toBe('Asha');
    expect(value().profile?.display_name).toBe('Asha');
    expect(value().isGuest).toBe(false);
  });

  it('upgrades a guest without a name without touching the profile', async () => {
    session = guest('g1');
    const auth = await mount();
    await auth.value.withPassword('a@b.co', 'long-enough-pw', 'sign_up');
    expect(world.auth.updateUser).toHaveBeenCalledTimes(1);
    expect((world.queries as Query[]).some((q) => q.op === 'update')).toBe(false);
  });

  it('surfaces a refused upgrade', async () => {
    session = guest('g1');
    const auth = await mount();
    world.auth.updateUser!.mockResolvedValueOnce({ error: new Error('email taken') });
    await expect(auth.value.withPassword('a@b.co', 'long-enough-pw', 'sign_up')).rejects.toThrow(
      'email taken',
    );
  });
});

// ─────────────────────────────────────────────── Google / Apple ──

describe('Google', () => {
  it('uses the phone’s own sheet for a fresh sign-in', async () => {
    spies.googleNativeSignIn.mockResolvedValueOnce({
      kind: 'credential',
      credential: { idToken: 'google-token' },
    });
    const auth = await mount();
    await auth.value.withGoogle();
    await flush();

    expect(world.auth.signInWithIdToken).toHaveBeenCalledWith({
      provider: 'google',
      token: 'google-token',
    });
    expect((auth.value.session as { user: { id: string } }).user.id).toBe('native-1');
    expect(world.browser).not.toHaveBeenCalled();
  });

  it('does nothing when the sheet is dismissed', async () => {
    spies.googleNativeSignIn.mockResolvedValueOnce({ kind: 'dismissed' });
    const auth = await mount();
    await auth.value.withGoogle();
    expect(world.auth.signInWithIdToken).not.toHaveBeenCalled();
    expect(world.browser).not.toHaveBeenCalled();
  });

  it('surfaces a refused id token', async () => {
    spies.googleNativeSignIn.mockResolvedValueOnce({
      kind: 'credential',
      credential: { idToken: 't' },
    });
    world.auth.signInWithIdToken!.mockResolvedValueOnce({ data: {}, error: new Error('bad') });
    const auth = await mount();
    await expect(auth.value.withGoogle()).rejects.toThrow('bad');
  });

  it('falls back to the browser when the sheet is unavailable, and redeems the code', async () => {
    vi.stubGlobal('__DEV__', true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    spies.googleNativeSignIn.mockResolvedValueOnce({ kind: 'unavailable' });
    world.browser.mockResolvedValueOnce({ type: 'success', url: 'waves://auth?code=g1' });
    const auth = await mount();

    await auth.value.withGoogle();
    await flush();

    expect(world.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'waves://auth', skipBrowserRedirect: true },
    });
    expect(world.browser).toHaveBeenCalledWith('https://idp/signin', 'waves://auth');
    expect((auth.value.session as { user: { id: string } }).user.id).toBe('from-g1');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('leaves the screen alone when the browser is closed', async () => {
    spies.googleNativeSignIn.mockResolvedValueOnce({ kind: 'unavailable' });
    world.browser.mockResolvedValueOnce({ type: 'cancel' });
    const auth = await mount();
    await auth.value.withGoogle();
    await flush();
    expect(auth.value.session).toBeNull();
    expect(world.auth.getSession).toHaveBeenCalledTimes(1);
  });

  it('turns every broken browser round trip into an error the screen can show', async () => {
    const auth = await mount();
    spies.googleNativeSignIn.mockResolvedValue({ kind: 'unavailable' });

    world.auth.signInWithOAuth!.mockResolvedValueOnce({ data: null, error: new Error('down') });
    await expect(auth.value.withGoogle()).rejects.toThrow('down');

    world.auth.signInWithOAuth!.mockResolvedValueOnce({ data: {}, error: null });
    await expect(auth.value.withGoogle()).rejects.toThrow('did not give us a sign-in link');

    world.browser.mockResolvedValueOnce({
      type: 'success',
      url: 'waves://auth?error=access_denied&error_description=Consent%20declined',
    });
    await expect(auth.value.withGoogle()).rejects.toThrow('Consent declined');

    world.browser.mockResolvedValueOnce({ type: 'success', url: 'waves://auth' });
    await expect(auth.value.withGoogle()).rejects.toThrow('came back without a code');
  });

  it('links Google onto a guest through the browser and keeps the session held', async () => {
    session = guest('g1');
    world.browser.mockResolvedValueOnce({ type: 'success', url: 'waves://auth' });
    const auth = await mount();

    await auth.value.withGoogle();
    await flush();

    expect(spies.googleNativeSignIn).not.toHaveBeenCalled();
    expect(world.auth.linkIdentity).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'waves://auth', skipBrowserRedirect: true },
    });
    expect(auth.value.session).toBe(session);
  });

  it('keeps whichever session redeemed the code first', async () => {
    const auth = await mount();
    // The link handler got there first and spent the code.
    world.linkListener!({ url: 'waves://auth?code=raced' });
    await flush();

    spies.googleNativeSignIn.mockResolvedValueOnce({ kind: 'unavailable' });
    world.browser.mockResolvedValueOnce({ type: 'success', url: 'waves://auth?code=raced' });
    session = user('from-raced');
    await auth.value.withGoogle();
    await flush();

    expect(world.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect((auth.value.session as { user: { id: string } }).user.id).toBe('from-raced');
  });
});

describe('Apple', () => {
  it('signs in with the native sheet and keeps the name Apple only sends once', async () => {
    spies.appleNativeSignIn.mockResolvedValueOnce({
      kind: 'credential',
      credential: {
        identityToken: 'apple-token',
        nonce: 'n1',
        fullName: { givenName: 'Ada', middleName: '', familyName: 'Lovelace' },
      },
    });
    const rows = { 'native-1': profileRow('native-1', 'Guest') };
    world.db = tableOf(rows) as never;
    const auth = await mount();

    await auth.value.withApple();
    await flush();

    expect(world.auth.signInWithIdToken).toHaveBeenCalledWith({
      provider: 'apple',
      token: 'apple-token',
      nonce: 'n1',
    });
    expect(world.auth.updateUser).toHaveBeenCalledWith({
      data: { display_name: 'Ada Lovelace' },
    });
    expect(rows['native-1'].display_name).toBe('Ada Lovelace');
    expect((auth.value.session as { user: { id: string } }).user.id).toBe('native-1');
  });

  it('writes no name on a sign-in that carried none', async () => {
    spies.appleNativeSignIn.mockResolvedValueOnce({
      kind: 'credential',
      credential: { identityToken: 't', nonce: 'n', fullName: null },
    });
    const auth = await mount();
    await auth.value.withApple();
    expect(world.auth.updateUser).not.toHaveBeenCalled();
  });

  it('does nothing when dismissed, and surfaces a refused token', async () => {
    const auth = await mount();
    spies.appleNativeSignIn.mockResolvedValueOnce({ kind: 'dismissed' });
    await auth.value.withApple();
    expect(world.auth.signInWithIdToken).not.toHaveBeenCalled();

    spies.appleNativeSignIn.mockResolvedValueOnce({
      kind: 'credential',
      credential: { identityToken: 't', nonce: 'n', fullName: null },
    });
    world.auth.signInWithIdToken!.mockResolvedValueOnce({ data: {}, error: new Error('nope') });
    await expect(auth.value.withApple()).rejects.toThrow('nope');
  });

  it('links Apple onto an existing account through the browser', async () => {
    session = user('u1');
    world.db = tableOf({ u1: profileRow('u1') }) as never;
    world.browser.mockResolvedValueOnce({ type: 'success', url: 'waves://auth?code=ap' });
    const auth = await mount();

    await auth.value.withApple();
    await flush();

    expect(spies.appleNativeSignIn).not.toHaveBeenCalled();
    expect(world.auth.linkIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'apple' }),
    );
    expect((auth.value.session as { user: { id: string } }).user.id).toBe('from-ap');
  });

  it('falls back to the browser when the sheet is unavailable, and changes nothing on cancel', async () => {
    spies.appleNativeSignIn.mockResolvedValueOnce({ kind: 'unavailable' });
    world.browser.mockResolvedValueOnce({ type: 'dismiss' });
    const auth = await mount();
    await auth.value.withApple();
    expect(world.auth.signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'apple' }),
    );
    expect(auth.value.session).toBeNull();
  });
});

// ─────────────────────────────────────────────────── sign-out ──

describe('signing out', () => {
  it('revokes, cancels and locks everything this account set up, then ends the session', async () => {
    session = user('u1');
    world.db = tableOf({ u1: profileRow('u1') }) as never;
    spies.revokePushToken.mockImplementationOnce(async () => {
      world.order.push('revoke');
    });
    spies.lockPersonal.mockImplementationOnce(() => world.order.push('lock'));
    spies.markDeliberateSignOut.mockImplementationOnce(() => world.order.push('mark'));
    // A failure to cancel a reminder must not keep somebody signed in.
    spies.cancelNudges.mockRejectedValueOnce(new Error('no permission'));
    spies.clearCaptureNudge.mockRejectedValueOnce(new Error('storage'));
    const auth = await mount();

    await auth.value.signOut();

    expect(spies.clearCaptureNudge).toHaveBeenCalledWith('u1');
    expect(world.order).toEqual(['revoke', 'lock', 'mark', 'signOut']);
  });

  it('signs out with no account id to clear when nobody was signed in', async () => {
    const auth = await mount();
    await auth.value.signOut();
    expect(spies.clearCaptureNudge).toHaveBeenCalledWith('');
  });
});

// ─────────────────────────────────────────────────── consumers ──

describe('reading the session from a screen', () => {
  it('refuses to run outside the provider', () => {
    expect(() => renderHook(() => useAuth())).toThrow(/inside AuthProvider/);
  });

  it('takes identity from the session, not the profile', async () => {
    session = user('u1');
    // The profile has not landed — which is exactly when this must still answer.
    world.db = (() => ({ data: null, error: { message: 'offline' } })) as never;
    const auth = await mount();
    const { ctx, value } = firstProvider(auth.view.result.current)!;

    expect(renderHook(() => useViewerId(), { contexts: [[ctx, value]] }).result.current).toBe('u1');
    expect(
      renderHook(() => useViewerId(), { contexts: [[ctx, { session: null }]] }).result.current,
    ).toBeNull();
  });
});
