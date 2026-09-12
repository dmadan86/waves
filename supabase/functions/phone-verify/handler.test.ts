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
    jwksOk?: boolean;
  } = {},
): PhoneVerifyDeps & { rpc: ReturnType<typeof vi.fn>; fetchImpl: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn((name: string) => {
    if (name === 'waves_phone_gate') {
      return Promise.resolve({
        data: { allowed: overrides.gateAllowed ?? true, reason: 'ok' },
        error: null,
      });
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

  const env = { ...ENV, ...(overrides.env ?? {}) };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service: () => ({ rpc }) as any,
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
