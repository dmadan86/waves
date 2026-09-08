/**
 * The one failure this service cannot be allowed to have quietly.
 *
 * If the project revokes its legacy HS256 secret, every session this API signs
 * becomes unacceptable and every `/v1` request answers 401 — which is precisely
 * what a bad API token looks like. A developer would then spend a day proving
 * that their perfectly good key is a perfectly good key, and nothing in the
 * response would ever point at the real cause.
 *
 * So the cases below are all about *telling the two apart*: a token we minted
 * milliseconds ago cannot legitimately be unverifiable, so a JWT-level refusal
 * is always a fault on this side, and it has to read as one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readConfig, type ApiConfig } from '../src/server/env';
import { forgetSigningProbe, isSignatureRejection, probeSigning } from '../src/server/signing';

function config(): ApiConfig {
  return readConfig();
}

/** A fetch that answers the JWKS document and the PostgREST probe separately. */
function backend(options: { probeStatus: number; algorithms?: string[] }): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('jwks.json')) {
      return new Response(
        JSON.stringify({ keys: (options.algorithms ?? ['ES256']).map((alg) => ({ alg })) }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(options.probeStatus === 200 ? '[]' : '{"message":"JWSError"}', {
      status: options.probeStatus,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  forgetSigningProbe();
  vi.stubEnv('WAVES_API_SUPABASE_URL', 'https://backend.example.test');
  vi.stubEnv('WAVES_API_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('WAVES_API_JWT_SECRET', 'jwt-secret');
  vi.stubEnv('WAVES_API_TOKEN_SECRET', 'token-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
  forgetSigningProbe();
});

describe('probing whether the backend will take what we sign', () => {
  it('settles the question by presenting a token, not by reading configuration', async () => {
    const verdict = await probeSigning(config(), backend({ probeStatus: 200 }));
    expect(verdict.state).toBe('ok');
  });

  it('calls a refusal what it is, and names the likely cause', async () => {
    const verdict = await probeSigning(config(), backend({ probeStatus: 401 }));
    expect(verdict.state).toBe('rejected');
    expect(verdict.detail).toMatch(/legacy HS256/i);
    // The operator needs to know the shape of the wall they have hit: an
    // asymmetric key's private half never leaves Supabase, so there is no
    // version of this service that signs for it.
    expect(verdict.detail).toMatch(/ES256/);
  });

  it('does not conclude anything from the published algorithms alone', async () => {
    // This is the trap the whole module exists to avoid. Supabase excludes
    // symmetric keys from the discovery document by design, so a project
    // showing one ES256 key looks identical whether the legacy secret is in
    // use, previously used, or revoked. Same JWKS, opposite verdicts — the
    // probe is what separates them.
    const accepted = await probeSigning(config(), backend({ probeStatus: 200 }));
    forgetSigningProbe();
    const refused = await probeSigning(config(), backend({ probeStatus: 401 }));

    expect(accepted.published).toEqual(['ES256']);
    expect(refused.published).toEqual(['ES256']);
    expect(accepted.state).not.toBe(refused.state);
  });

  it('says it does not know rather than guessing when the backend is unreachable', async () => {
    const offline = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch;
    const verdict = await probeSigning(config(), offline);
    // "Cannot reach it" is not "it refused us". Reporting a refusal here would
    // send an operator to rotate a key over a network blip.
    expect(verdict.state).toBe('unreachable');
  });

  it('asks for the configuration it needs instead of probing without it', async () => {
    vi.stubEnv('WAVES_API_JWT_SECRET', '');
    const verdict = await probeSigning(config(), backend({ probeStatus: 200 }));
    expect(verdict.state).toBe('unconfigured');
    expect(verdict.detail).toContain('WAVES_API_JWT_SECRET');
  });

  it('does not put a round trip in front of every request', async () => {
    const fetchImpl = vi.fn(backend({ probeStatus: 200 }));
    await probeSigning(config(), fetchImpl as unknown as typeof fetch);
    const afterFirst = fetchImpl.mock.calls.length;
    await probeSigning(config(), fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls.length).toBe(afterFirst);
  });

  it('reads no ledger row and writes nothing', async () => {
    const seen: string[] = [];
    const recorder = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(`${init?.method ?? 'GET'} ${String(input)}`);
      return new Response('[]', { status: 200 });
    }) as unknown as typeof fetch;
    await probeSigning(config(), recorder);

    for (const call of seen) {
      expect(call.startsWith('GET ')).toBe(true);
      // `app_config` is configuration under a `USING (true)` policy, so the
      // request answers on the signature and on nothing else — no group, no
      // expense, and no account that has to exist.
      expect(call).not.toMatch(/expenses|groups|settlements|profiles/);
    }
    expect(seen.some((call) => call.includes('app_config'))).toBe(true);
  });
});

describe('telling a deployment fault from a bad token', () => {
  it('recognises the JWT family PostgREST answers with', () => {
    expect(
      isSignatureRejection({ code: 'PGRST301', message: 'JWSError JWSInvalidSignature' }),
    ).toBe(true);
    expect(isSignatureRejection({ code: 'PGRST302' })).toBe(true);
    expect(
      isSignatureRejection({ message: 'invalid JWT: unable to parse or verify signature' }),
    ).toBe(true);
  });

  it('leaves an ordinary refusal alone', () => {
    // These are the caller's problem and must keep their own status codes.
    expect(isSignatureRejection({ message: 'NOT_A_MEMBER: you are not in that group' })).toBe(
      false,
    );
    expect(isSignatureRejection({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isSignatureRejection(null)).toBe(false);
    expect(isSignatureRejection('nope')).toBe(false);
  });
});
