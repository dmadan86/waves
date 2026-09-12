/**
 * The client half of signing in with a phone — which of the two things a proved
 * number can do, and whether the door is offered at all.
 *
 * Two defects live here and neither one shows up as an error anywhere:
 *
 *   * **A guest signing in by phone lost everything.** They are already signed
 *     in, to an anonymous account holding a trip, and `setSession` would swap it
 *     for whoever owns the number. The data stays on the server under an account
 *     with no door left into it — no failure, no message, just a person whose
 *     trip is gone. ADR-006 says an anonymous session upgrades *in place*, and
 *     `planAuth` is where every other door already asks.
 *   * **`phoneSignInAvailable()` was written and never called.** Firebase is a
 *     native module. A JavaScript-only update onto a binary built before it
 *     existed leaves the tile drawn and dead, so the check has to answer — and
 *     answer without throwing, because the thing it is checking for is exactly
 *     the thing that throws.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The Supabase side: what the screen would have done to the session. */
const world = vi.hoisted(() => ({
  /** Null for nobody, or the user the device is currently holding. */
  user: null as { id: string; is_anonymous: boolean } | null,
  invoked: [] as { name: string; body: Record<string, unknown> }[],
  /** What `phone-verify` answers. Its shape decides which branch is taken. */
  answer: { data: {} as unknown, error: null as unknown },
  setSession: vi.fn(async () => ({ error: null })),
  refreshSession: vi.fn(async () => ({ error: null })),
}));

vi.mock('@/lib/backend', () => ({
  backend: {
    auth: {
      getSession: async () => ({ data: { session: world.user ? { user: world.user } : null } }),
      setSession: world.setSession,
      refreshSession: world.refreshSession,
    },
    functions: {
      invoke: async (name: string, options: { body: Record<string, unknown> }) => {
        world.invoked.push({ name, body: options.body });
        return world.answer;
      },
    },
  },
}));

/**
 * Firebase, standing in for the native module this build may or may not have.
 *
 * Mocked at `lib/firebaseModule` rather than at the package, because the package
 * is reached by a `require` and a `require` cannot be substituted — which is the
 * reason that one line lives in a file of its own.
 */
vi.mock('@/lib/firebaseModule', () => ({
  loadFirebaseAuth: () => () => ({
    signInWithPhoneNumber: async () => ({
      confirm: async () => ({ user: { getIdToken: async () => 'id-token' } }),
    }),
    signOut: async () => undefined,
  }),
}));

const { confirmPhoneCode, phoneSignInAvailable, sendPhoneCode } = await import('@/lib/phoneAuth');

beforeEach(() => {
  world.user = null;
  world.invoked = [];
  world.answer = { data: { access_token: 'access', refresh_token: 'refresh' }, error: null };
  world.setSession.mockClear();
  world.refreshSession.mockClear();
});

describe('whether this build can do it at all', () => {
  it('answers rather than throwing, which is the whole point of asking', async () => {
    // The check exists because requiring the module can blow up; a check that
    // blows up in the same circumstances is no check. Called twice because the
    // answer is cached and the cached path must not throw either.
    expect(() => phoneSignInAvailable()).not.toThrow();
    expect(typeof phoneSignInAvailable()).toBe('boolean');
    expect(() => phoneSignInAvailable()).not.toThrow();
  });
});

describe('a guest who signs in by phone', () => {
  it('keeps the account they are holding instead of being handed another', async () => {
    // The defect this pins: `setSession` swaps the anonymous account for
    // whoever owns the number, and everything entered as a guest is left on the
    // server under an id nobody can reach again. ADR-006 makes this an addition.
    world.user = { id: 'guest-1', is_anonymous: true };
    world.answer = { data: { attached: true }, error: null };

    await sendPhoneCode('+919876543210');
    await confirmPhoneCode('+919876543210', '123456');

    expect(world.invoked).toHaveLength(1);
    expect(world.invoked[0]?.body.mode).toBe('attach');
    expect(world.setSession).not.toHaveBeenCalled();
    // The ceiling lifts in the access token, so the session has to be reissued
    // before the app stops drawing it.
    expect(world.refreshSession).toHaveBeenCalled();
  });
});

describe('somebody with nothing to lose', () => {
  it('is signed in, and asks for that by name', async () => {
    world.user = null;

    await sendPhoneCode('+919876543210');
    await confirmPhoneCode('+919876543210', '123456');

    // Spelled out rather than left to a default: the server refuses a mode it
    // does not recognise, and silence is the one spelling that could drift.
    expect(world.invoked[0]?.body.mode).toBe('signin');
    expect(world.setSession).toHaveBeenCalled();
  });
});

describe('an account that already exists', () => {
  it('gains the number rather than being swapped for another account', async () => {
    // Same rule as the guest, and for the same reason: somebody holding an
    // account who proves a number is adding a way in, never trading one account
    // for another. If the number belongs elsewhere the server says so.
    world.user = { id: 'user-1', is_anonymous: false };
    world.answer = { data: { attached: true }, error: null };

    await sendPhoneCode('+919876543210');
    await confirmPhoneCode('+919876543210', '123456');

    expect(world.invoked[0]?.body.mode).toBe('attach');
    expect(world.setSession).not.toHaveBeenCalled();
  });
});

describe('what the person is told when it fails', () => {
  it('reads the sentence the function wrote rather than the one invoke made up', async () => {
    // `functions.invoke` collapses every non-2xx into one line about a non-2xx
    // status code. "That number is already on another Waves account" is
    // actionable; "Edge Function returned a non-2xx status code" is not, and
    // both used to reach the screen as the latter.
    world.user = { id: 'user-1', is_anonymous: false };
    world.answer = {
      data: null,
      error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
        context: new Response(
          JSON.stringify({
            code: 'PHONE_TAKEN',
            message: 'That number is already on another Waves account',
          }),
          { status: 409 },
        ),
      }),
    };

    await sendPhoneCode('+919876543210');
    await expect(confirmPhoneCode('+919876543210', '123456')).rejects.toThrow(
      'That number is already on another Waves account',
    );
  });
});
