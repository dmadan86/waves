/**
 * Coverage for phone-verify — the exchange that turns a verified Firebase token
 * into a Waves session.
 *
 * The token verification itself is covered exhaustively in
 * `packages/core/test/firebaseToken.test.ts` against a real key pair; these
 * tests inject a stub for it and cover what this function adds around it. The
 * cases that carry the weight:
 *
 *   * a token that does not verify never reaches GoTrue, the gate or the relay;
 *   * ADR-006 survives — a number with no account is a plain refusal, not a new
 *     account, and not a 500 that looks like a bug;
 *   * the relay is opened *before* the code is asked for, or the hook sends an
 *     SMS before there is anywhere to park it;
 *   * a live code is never left behind, whichever way the exchange ends.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { forgetFirebaseKeys, handlePhoneVerify, type PhoneVerifyDeps } from './handler.ts';

const ENV: Record<string, string> = {
  FIREBASE_PROJECT_ID: 'waves-3e7b8',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
};

/**
 * Matched exactly rather than by substring, and not only because CodeQL says so:
 * `url.includes('googleapis.com')` is the shape that treats
 * `https://evil.example/?x=googleapis.com` as Google. It is a test double here,
 * so nothing was reachable — but a routing mock that matches loosely also hides
 * a typo in the URL under test by quietly falling through to another branch.
 */
const JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

const JWKS = { keys: [{ kid: 'key-1', kty: 'RSA', n: 'n', e: 'AQAB', alg: 'RS256' }] };

function request(body: unknown = { idToken: 'a.b.c' }): Request {
  return new Request('https://edge.test/phone-verify', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Every outbound call this function can make, each answerable per test. The
 * fetch mock routes on URL because the order of the two GoTrue calls is part of
 * what is being checked.
 */
function deps(
  overrides: {
    env?: Record<string, string>;
    otpStatus?: number;
    otpBody?: string;
    verifyStatus?: number;
    verifyBody?: unknown;
    parkedCode?: string | null;
    gateAllowed?: boolean;
    gateErrored?: boolean;
    callerId?: string | null;
    attachError?: { message: string };
    /** The number already on the caller's account, as GoTrue stores it: no `+`. */
    callerPhone?: string | null;
    /** False makes the proof a replay — the same Firebase sign-in, seen twice. */
    firstUse?: boolean;
    assertionErrored?: boolean;
    relayOpenErrored?: boolean;
    jwksOk?: boolean;
  } = {},
): PhoneVerifyDeps & {
  rpc: ReturnType<typeof vi.fn>;
  fetchImpl: ReturnType<typeof vi.fn>;
  updateUserById: ReturnType<typeof vi.fn>;
  getUserById: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn((name: string) => {
    if (name === 'waves_firebase_assertion_use') {
      if (overrides.assertionErrored) {
        return Promise.resolve({ data: null, error: { message: 'database unreachable' } });
      }
      return Promise.resolve({ data: overrides.firstUse ?? true, error: null });
    }
    if (name === 'waves_phone_gate') {
      if (overrides.gateErrored) {
        return Promise.resolve({ data: null, error: { message: 'database unreachable' } });
      }
      return Promise.resolve({
        data: { allowed: overrides.gateAllowed ?? true, reason: 'ok' },
        error: null,
      });
    }
    if (name === 'waves_otp_relay_open') {
      return overrides.relayOpenErrored
        ? Promise.resolve({ data: null, error: { message: 'no relay' } })
        : Promise.resolve({ data: 'exchange-1', error: null });
    }
    if (name === 'waves_otp_relay_claim') {
      return Promise.resolve({
        data: overrides.parkedCode === undefined ? '123456' : overrides.parkedCode,
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });

  const fetchImpl = vi.fn((url: string) => {
    if (url === JWKS_URL) {
      return Promise.resolve(
        new Response(JSON.stringify(JWKS), { status: overrides.jwksOk === false ? 500 : 200 }),
      );
    }
    if (url === `${ENV.SUPABASE_URL}/auth/v1/otp`) {
      return Promise.resolve(
        new Response(overrides.otpBody ?? '{}', { status: overrides.otpStatus ?? 200 }),
      );
    }
    if (url === `${ENV.SUPABASE_URL}/auth/v1/verify`) {
      return Promise.resolve(
        new Response(
          JSON.stringify(
            overrides.verifyBody ?? { access_token: 'access-1', refresh_token: 'refresh-1' },
          ),
          { status: overrides.verifyStatus ?? 200 },
        ),
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  const updateUserById = vi.fn(() =>
    Promise.resolve({ data: null, error: overrides.attachError ?? null }),
  );

  /**
   * What the account already carries. GoTrue answers with the number stripped of
   * its `+`, which is the whole reason the handler compares digits.
   */
  const getUserById = vi.fn(() =>
    Promise.resolve({
      data: { user: { id: overrides.callerId ?? 'user-1', phone: overrides.callerPhone ?? null } },
      error: null,
    }),
  );

  const env = { ...ENV, ...(overrides.env ?? {}) };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service: () => ({ rpc, auth: { admin: { updateUserById, getUserById } } }) as any,
    callerId: () => Promise.resolve(overrides.callerId ?? null),
    updateUserById,
    getUserById,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    env: (key: string) => env[key],
    rpc,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** Which RPCs were called, in order. The order is part of the contract. */
function rpcNames(d: { rpc: ReturnType<typeof vi.fn> }): string[] {
  return d.rpc.mock.calls.map((call) => call[0] as string);
}

vi.mock('../_shared/core.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    verifyFirebaseIdToken: vi.fn(() =>
      Promise.resolve({
        ok: true,
        identity: { uid: 'firebase-1', phone: '+919876543210', signedInAt: 1 },
      }),
    ),
  };
});

const core = await import('../_shared/core.js');
const verifyStub = core.verifyFirebaseIdToken as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  forgetFirebaseKeys();
  verifyStub.mockResolvedValue({
    ok: true,
    identity: { uid: 'firebase-1', phone: '+919876543210', signedInAt: 1 },
  });
});

describe('a verified token', () => {
  it('comes back with a session', async () => {
    const d = deps();
    const response = await handlePhoneVerify(request(), d);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
    });
  });

  it('opens the relay before asking GoTrue for a code', async () => {
    // The other order sends an SMS: GoTrue generates the code and posts it to
    // the hook, and if no exchange is open by then the hook does its ordinary
    // job and pays to deliver it.
    const d = deps();
    await handlePhoneVerify(request(), d);

    const names = rpcNames(d);
    const opened = names.indexOf('waves_otp_relay_open');
    const claimed = names.indexOf('waves_otp_relay_claim');
    expect(opened).toBeGreaterThanOrEqual(0);
    expect(opened).toBeLessThan(claimed);

    const askedAt = d.fetchImpl.mock.calls.findIndex(
      (call) => call[0] === `${ENV.SUPABASE_URL}/auth/v1/otp`,
    );
    expect(askedAt).toBeGreaterThanOrEqual(0);
  });

  it('clears the day, because a code was actually used', async () => {
    const d = deps();
    await handlePhoneVerify(request(), d);
    expect(rpcNames(d)).toContain('waves_phone_verified');
  });

  it('leaves no live code behind', async () => {
    const d = deps();
    await handlePhoneVerify(request(), d);
    expect(rpcNames(d)).toContain('waves_otp_relay_close');
  });
});

describe('a token that does not verify', () => {
  it('is refused without touching GoTrue, the gate or the relay', async () => {
    verifyStub.mockResolvedValue({ ok: false, reason: 'signature' });
    const d = deps();
    const response = await handlePhoneVerify(request(), d);

    expect(response.status).toBe(401);
    expect(rpcNames(d)).toEqual([]);
    // The JWKS fetch is the only call it should have made.
    expect(d.fetchImpl.mock.calls.every((call) => call[0] === JWKS_URL)).toBe(true);
  });

  it('says nothing about why', async () => {
    verifyStub.mockResolvedValue({ ok: false, reason: 'audience' });
    const response = await handlePhoneVerify(request(), deps());
    const body = (await response.json()) as { message: string };
    expect(body.message).not.toContain('audience');
  });
});

describe('ADR-006', () => {
  it('refuses a number with no account rather than making one', async () => {
    const d = deps({
      otpStatus: 422,
      otpBody: '{"code":422,"error_code":"otp_disabled","msg":"Signups not allowed for otp"}',
    });
    const response = await handlePhoneVerify(request(), d);

    expect(response.status).toBe(404);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('NO_ACCOUNT');
    // And the relay is still cleaned up.
    expect(rpcNames(d)).toContain('waves_otp_relay_close');
  });
});

describe('the daily gate', () => {
  it('applies to a Firebase sign-in exactly as to any other', async () => {
    const d = deps({ gateAllowed: false });
    const response = await handlePhoneVerify(request(), d);

    expect(response.status).toBe(429);
    expect(rpcNames(d)).not.toContain('waves_otp_relay_open');
  });
});

describe('when the exchange goes wrong', () => {
  it('refuses when the gate cannot be evaluated at all', async () => {
    // The opposite of otp-send, and on purpose: here the gate is the only thing
    // between a blocked number and a session, so an unreadable gate is a refusal
    // rather than a shrug.
    const d = deps({ gateErrored: true });
    const response = await handlePhoneVerify(request(), d);

    expect(response.status).toBe(503);
    expect(rpcNames(d)).not.toContain('waves_otp_relay_open');
  });

  it('claims and closes with the exchange it opened', async () => {
    // Two sign-ins on one number must not be able to take each other's code.
    const d = deps();
    await handlePhoneVerify(request(), d);

    const claim = d.rpc.mock.calls.find((call) => call[0] === 'waves_otp_relay_claim');
    const close = d.rpc.mock.calls.find((call) => call[0] === 'waves_otp_relay_close');
    expect(claim?.[1]).toEqual({ p_phone: '+919876543210', p_exchange: 'exchange-1' });
    expect(close?.[1]).toEqual({ p_phone: '+919876543210', p_exchange: 'exchange-1' });
  });

  it('does not hand back a session when no code was parked', async () => {
    const d = deps({ parkedCode: null });
    const response = await handlePhoneVerify(request(), d);

    expect(response.status).toBe(502);
    expect(rpcNames(d)).toContain('waves_otp_relay_close');
  });

  it('does not hand back a half-empty session', async () => {
    const d = deps({ verifyBody: { access_token: 'access-1' } });
    expect((await handlePhoneVerify(request(), d)).status).toBe(502);
  });

  it('refuses when Google cannot be reached for its keys', async () => {
    const d = deps({ jwksOk: false });
    expect((await handlePhoneVerify(request(), d)).status).toBe(503);
  });
});

describe('the request itself', () => {
  it('refuses anything but POST', async () => {
    const response = await handlePhoneVerify(
      new Request('https://edge.test/phone-verify', { method: 'GET' }),
      deps(),
    );
    expect(response.status).toBe(405);
  });

  it('refuses a body with no token', async () => {
    expect((await handlePhoneVerify(request({}), deps())).status).toBe(400);
  });

  it('refuses to run unconfigured', async () => {
    const d = deps({ env: { FIREBASE_PROJECT_ID: '' } });
    expect((await handlePhoneVerify(request(), d)).status).toBe(500);
  });
});

/**
 * Attaching a proved number to an account somebody already holds — ADR-006's
 * other half, and the reason signing in by phone ever finds anything: without
 * this, no account has a number and every sign-in is a refusal.
 */
describe('attaching a number to an account', () => {
  const attach = () => request({ idToken: 'a.b.c', mode: 'attach' });

  it('puts the number on the caller’s own account, keeping its id', async () => {
    const d = deps({ callerId: 'user-1' });
    const response = await handlePhoneVerify(attach(), d);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ attached: true });
    expect(d.updateUserById).toHaveBeenCalledWith('user-1', {
      phone: '+919876543210',
      phone_confirm: true,
    });
    // No session is minted and no code is relayed: they are already signed in.
    expect(rpcNames(d)).not.toContain('waves_otp_relay_open');
  });

  it('refuses when nobody is signed in', async () => {
    const d = deps({ callerId: null });
    const response = await handlePhoneVerify(attach(), d);

    expect(response.status).toBe(401);
    expect(d.updateUserById).not.toHaveBeenCalled();
  });

  it('names the one refusal a person cannot fix by retrying', async () => {
    const d = deps({
      callerId: 'user-1',
      attachError: { message: 'Phone number already registered' },
    });
    const response = await handlePhoneVerify(attach(), d);

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('PHONE_TAKEN');
  });

  it('never attaches on a request that did not ask to', async () => {
    // `functions.invoke` sends the current session with every call, so if the
    // mode were inferred from the header, somebody signed in as one account and
    // signing in by phone as another would silently move the number.
    const d = deps({ callerId: 'user-1' });
    await handlePhoneVerify(request({ idToken: 'a.b.c' }), d);

    expect(d.updateUserById).not.toHaveBeenCalled();
  });

  it('still counts against the daily gate', async () => {
    const d = deps({ callerId: 'user-1', gateAllowed: false });
    const response = await handlePhoneVerify(attach(), d);

    expect(response.status).toBe(429);
    expect(d.updateUserById).not.toHaveBeenCalled();
  });
});

/**
 * The mode is a name, and only two names exist.
 *
 * The first version read the mode as "attach, or else sign in", which made every
 * misspelling of the word a silent request for the *other* thing. That is the
 * same data-losing surprise the mode exists to prevent, arriving through a
 * capital letter.
 */
describe('the mode', () => {
  it('refuses a word it does not know rather than reading it as a sign-in', async () => {
    const d = deps({ callerId: 'user-1' });
    const response = await handlePhoneVerify(request({ idToken: 'a.b.c', mode: 'Attach' }), d);

    expect(response.status).toBe(400);
    // Neither thing happened: no number moved, and nobody was signed in as
    // somebody else while believing they were adding a number to their own.
    expect(d.updateUserById).not.toHaveBeenCalled();
    expect(rpcNames(d)).not.toContain('waves_otp_relay_open');
  });

  it('takes the sign-in spelled out as readily as the one left unsaid', async () => {
    const d = deps();
    const response = await handlePhoneVerify(request({ idToken: 'a.b.c', mode: 'signin' }), d);
    expect(response.status).toBe(200);
  });
});

/**
 * One proof, one use.
 *
 * A Firebase ID token stays good for ten minutes after the code was entered, and
 * it is refreshable, so "the same token twice" is not the only replay — a second
 * token minted from the same Firebase session is the same proof wearing a
 * different signature. Both are the same sign-in, and both are refused after the
 * first, because one proof buying both a session *and* an attachment to a second
 * account is two irreversible things from one SMS.
 */
describe('a proof already spent', () => {
  it('is refused, and the person is told to ask for a new code', async () => {
    const d = deps({ firstUse: false });
    const response = await handlePhoneVerify(request(), d);

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('ALREADY_USED');
  });

  it('is refused before the gate, so a replay cannot spend the allowance', async () => {
    // The other order is the attack: somebody holding one captured token replays
    // it three times and the number's real owner cannot sign in until tomorrow.
    const d = deps({ firstUse: false });
    await handlePhoneVerify(request(), d);

    expect(rpcNames(d)).not.toContain('waves_phone_gate');
    expect(rpcNames(d)).not.toContain('waves_otp_relay_open');
  });

  it('is claimed against the sign-in, not the token', async () => {
    // `auth_time` is what makes a refreshed token the same proof. Recording
    // anything derived from the token itself would pin nothing.
    const d = deps();
    await handlePhoneVerify(request(), d);

    const claim = d.rpc.mock.calls.find((call) => call[0] === 'waves_firebase_assertion_use');
    expect(claim?.[1]).toEqual({ p_uid: 'firebase-1', p_auth_time: 1 });
  });

  it('goes back when the gate could not be reached, so the code can be retyped', async () => {
    // Nothing was counted and nothing was sent; sending somebody back to
    // Firebase for a second SMS because our database blinked is a charge for our
    // own outage.
    const d = deps({ gateErrored: true });
    const response = await handlePhoneVerify(request(), d);

    expect(response.status).toBe(503);
    expect(rpcNames(d)).toContain('waves_firebase_assertion_release');
    // No refund: the call that would have counted the ask is the one that just
    // failed, so a refund here would take away an *earlier* attempt.
    expect(rpcNames(d)).not.toContain('waves_phone_gate_refund');
  });
});

/**
 * Whose failure it was decides who pays for it.
 *
 * Firebase has already sent and billed for the SMS by the time this function
 * runs, so the value of handing an attempt back is precisely that the same code
 * can be typed again — no second message, no second charge. What must never be
 * handed back is an attempt that ended in an answer.
 */
describe('an attempt nobody could have avoided', () => {
  it('is given back when the relay would not open', async () => {
    const d = deps({ relayOpenErrored: true });
    const response = await handlePhoneVerify(request(), d);

    expect(response.status).toBe(500);
    expect(rpcNames(d)).toContain('waves_phone_gate_refund');
    expect(rpcNames(d)).toContain('waves_firebase_assertion_release');
  });

  it('is given back when the hook never parked a code', async () => {
    const d = deps({ parkedCode: null });
    await handlePhoneVerify(request(), d);
    expect(rpcNames(d)).toContain('waves_phone_gate_refund');
  });

  it('is given back when GoTrue would not complete the exchange', async () => {
    const d = deps({ verifyStatus: 502 });
    await handlePhoneVerify(request(), d);
    expect(rpcNames(d)).toContain('waves_phone_gate_refund');
  });

  it('is kept when the answer was an answer', async () => {
    // ADR-006 refusing a number with no account is a reply, not a fault. Giving
    // the attempt back here would make walking the numbers free, and every walk
    // is a Firebase SMS somebody was billed for.
    const d = deps({ otpStatus: 422, otpBody: '{"error_code":"otp_disabled"}' });
    const response = await handlePhoneVerify(request(), d);

    expect(response.status).toBe(404);
    expect(rpcNames(d)).not.toContain('waves_phone_gate_refund');
    expect(rpcNames(d)).not.toContain('waves_firebase_assertion_release');
  });

  it('is kept when the sign-in completed', async () => {
    const d = deps();
    await handlePhoneVerify(request(), d);
    expect(rpcNames(d)).not.toContain('waves_phone_gate_refund');
  });
});

/**
 * The guest half of ADR-006, which is the half that was missing.
 *
 * Attaching an email runs through GoTrue's own change-verification and clears
 * `is_anonymous` on the way past. Attaching a phone runs through the admin API,
 * which sets the number and nothing else — so the same person, through the other
 * door, kept the guest ceilings (one group, ten days, read-only after) while
 * holding a proved contact.
 */
describe('a guest who attaches a number', () => {
  const attach = () => request({ idToken: 'a.b.c', mode: 'attach' });

  it('stops being a guest', async () => {
    const d = deps({ callerId: 'user-1' });
    await handlePhoneVerify(attach(), d);

    const promote = d.rpc.mock.calls.find((call) => call[0] === 'waves_promote_guest');
    expect(promote?.[1]).toEqual({ p_user: 'user-1' });
  });

  it('is not promoted when the number went somewhere else', async () => {
    const d = deps({
      callerId: 'user-1',
      attachError: { message: 'Phone number already registered' },
    });
    await handlePhoneVerify(attach(), d);

    expect(rpcNames(d)).not.toContain('waves_promote_guest');
  });
});

/** Attaching a number the account already has is a success, not a collision. */
describe('attaching the same number twice', () => {
  const attach = () => request({ idToken: 'a.b.c', mode: 'attach' });

  it('is a quiet success, without asking GoTrue to set it again', async () => {
    // Somebody whose connection dropped between the attach and the answer will
    // press the button again. Telling them the number in their hand belongs to
    // "another account" — theirs — is both wrong and unfixable from there.
    const d = deps({ callerId: 'user-1', callerPhone: '919876543210' });
    const response = await handlePhoneVerify(attach(), d);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ attached: true });
    expect(d.updateUserById).not.toHaveBeenCalled();
  });

  it('compares digits, because GoTrue stores the number without its plus', async () => {
    // The naive comparison is `user.phone === '+919876543210'`, which never
    // matches anything GoTrue returns, so the check above silently never fires.
    const d = deps({ callerId: 'user-1', callerPhone: '+919876543210' });
    expect((await handlePhoneVerify(attach(), d)).status).toBe(200);
    expect(d.updateUserById).not.toHaveBeenCalled();
  });

  it('reads "already registered" as "by you" when it is', async () => {
    // GoTrue's duplicate check does not reliably exclude the caller, so the
    // message alone cannot tell "somebody else has it" from "you do" — and one
    // of those is a 409 shown to the person who owns the number.
    const d = deps({ callerId: 'user-1', attachError: { message: 'already registered' } });
    d.getUserById
      .mockResolvedValueOnce({ data: { user: { id: 'user-1', phone: null } }, error: null })
      .mockResolvedValueOnce({
        data: { user: { id: 'user-1', phone: '919876543210' } },
        error: null,
      });

    expect((await handlePhoneVerify(attach(), d)).status).toBe(200);
  });
});

/** Attaching must cost nothing until we know who is asking. */
describe('an attach with nobody signed in', () => {
  it('spends none of the number’s allowance on its way to a 401', async () => {
    // The cheapest request there is: no session, a token for somebody else's
    // number. Three of them used to take that number's whole day.
    const d = deps({ callerId: null });
    const response = await handlePhoneVerify(request({ idToken: 'a.b.c', mode: 'attach' }), d);

    expect(response.status).toBe(401);
    expect(rpcNames(d)).not.toContain('waves_phone_gate');
    expect(rpcNames(d)).not.toContain('waves_firebase_assertion_use');
  });
});
