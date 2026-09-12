/**
 * What a Firebase ID token has to be before this app will believe somebody is
 * holding a phone number.
 *
 * Every case here is built against a real RSA key pair generated in the test, so
 * a token that should verify actually verifies and a token that should not is
 * rejected for the right reason rather than because it was gibberish. The two
 * that matter most are the ones a careless verifier gets wrong:
 *
 *   * a header claiming `none` or `HS256`, which is how a verifier that trusts
 *     the header is made to skip the signature or to use the public key as a
 *     shared secret;
 *   * a token from a Google or email sign-in that happens to carry a
 *     `phone_number`, which without the provider check would let anybody who can
 *     sign into Firebase at all claim somebody else's number.
 */

import { describe, expect, it, beforeAll } from 'vitest';

import {
  verifyFirebaseIdToken,
  type FirebaseJwk,
  type FirebaseTokenRejection,
} from '../src/auth/firebaseToken';

const PROJECT = 'baaki-43455';
const NOW = 1_800_000_000;
const PHONE = '+447700900123';

let keys: FirebaseJwk[];
let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function generate(kid: string): Promise<{ jwk: FirebaseJwk; privateKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const exported = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as {
    n: string;
    e: string;
  };
  return {
    jwk: { kid, kty: 'RSA', alg: 'RS256', n: exported.n, e: exported.e },
    privateKey: pair.privateKey,
  };
}

beforeAll(async () => {
  const mine = await generate('key-1');
  const theirs = await generate('key-2');
  keys = [mine.jwk];
  privateKey = mine.privateKey;
  otherPrivateKey = theirs.privateKey;
}, 30_000);

/** A token Firebase would have sent, with anything the case needs overridden. */
async function token(
  overrides: {
    header?: Record<string, unknown>;
    claims?: Record<string, unknown>;
    signWith?: CryptoKey;
    signature?: string;
  } = {},
): Promise<string> {
  const header = { alg: 'RS256', kid: 'key-1', typ: 'JWT', ...overrides.header };
  const claims = {
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: 'firebase-uid-1',
    iat: NOW - 30,
    exp: NOW + 3600,
    auth_time: NOW - 30,
    phone_number: PHONE,
    firebase: { sign_in_provider: 'phone', identities: { phone: [PHONE] } },
    ...overrides.claims,
  };
  const body = `${encodeJson(header)}.${encodeJson(claims)}`;
  if (overrides.signature !== undefined) return `${body}.${overrides.signature}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    overrides.signWith ?? privateKey,
    new TextEncoder().encode(body),
  );
  return `${body}.${base64Url(new Uint8Array(signature))}`;
}

async function check(value: string): Promise<ReturnType<typeof verifyFirebaseIdToken>> {
  return verifyFirebaseIdToken({ token: value, keys, projectId: PROJECT, now: NOW });
}

async function rejects(value: string, reason: FirebaseTokenRejection): Promise<void> {
  const result = await check(value);
  expect(result).toEqual({ ok: false, reason });
}

describe('a token Firebase really sent', () => {
  it('yields the number, the uid and when the code was entered', async () => {
    const result = await check(await token());
    expect(result).toEqual({
      ok: true,
      identity: { uid: 'firebase-uid-1', phone: PHONE, signedInAt: NOW - 30 },
    });
  });

  it('is still good a few seconds either side of our clock', async () => {
    // Two machines never agree exactly, and refusing on a second of drift would
    // be a sign-in failure nobody could reproduce.
    expect((await check(await token({ claims: { exp: NOW - 30 } }))).ok).toBe(true);
    expect((await check(await token({ claims: { iat: NOW + 30, auth_time: NOW + 30 } }))).ok).toBe(
      true,
    );
  });
});

describe('the signature', () => {
  it('refuses a token signed by somebody else', async () => {
    await rejects(await token({ signWith: otherPrivateKey }), 'signature');
  });

  it('refuses a token whose claims were edited after signing', async () => {
    // The whole point. A verifier that reads claims first would hand out a
    // session for whatever number the attacker pasted in.
    const real = await token();
    const [header, , signature] = real.split('.');
    const forged = encodeJson({
      iss: `https://securetoken.google.com/${PROJECT}`,
      aud: PROJECT,
      sub: 'firebase-uid-1',
      iat: NOW - 30,
      exp: NOW + 3600,
      auth_time: NOW - 30,
      phone_number: '+919876543210',
      firebase: { sign_in_provider: 'phone' },
    });
    await rejects(`${header}.${forged}.${signature}`, 'signature');
  });

  it('refuses a header that asks for no signature at all', async () => {
    await rejects(await token({ header: { alg: 'none' }, signature: '' }), 'algorithm');
  });

  it('refuses a header that asks for HS256', async () => {
    // Algorithm confusion: the verifier would use the RSA *public* key as an
    // HMAC secret, and the public key is public.
    await rejects(await token({ header: { alg: 'HS256' } }), 'algorithm');
  });

  it('refuses a key it has never heard of', async () => {
    await rejects(await token({ header: { kid: 'key-9' } }), 'unknown-key');
    await rejects(await token({ header: { kid: undefined } }), 'unknown-key');
  });
});

describe('who the token is for', () => {
  it('refuses another project', async () => {
    await rejects(await token({ claims: { aud: 'someone-else' } }), 'audience');
    await rejects(
      await token({ claims: { iss: 'https://securetoken.google.com/someone-else' } }),
      'issuer',
    );
  });

  it('refuses an issuer that merely ends with the project id', async () => {
    await rejects(
      await token({ claims: { iss: `https://evil.example/securetoken.google.com/${PROJECT}` } }),
      'issuer',
    );
  });
});

describe('when it happened', () => {
  it('refuses an expired token', async () => {
    await rejects(await token({ claims: { exp: NOW - 3600 } }), 'expired');
    await rejects(await token({ claims: { exp: undefined } }), 'expired');
  });

  it('refuses a token issued in the future', async () => {
    await rejects(await token({ claims: { iat: NOW + 3600 } }), 'not-yet-valid');
  });

  it('refuses a fresh token that attests to an old sign-in', async () => {
    // An ID token is refreshable, so this shape is ordinary: a Firebase session
    // from last week, refreshed a minute ago. It is a valid token and it is not
    // evidence that anybody is holding that phone today.
    await rejects(await token({ claims: { auth_time: NOW - 86_400 } }), 'stale-sign-in');
    await rejects(await token({ claims: { auth_time: undefined } }), 'stale-sign-in');
  });
});

describe('what it attests to', () => {
  it('refuses a sign-in that was not by phone', async () => {
    // Firebase will mint this happily for a Google sign-in, phone_number claim
    // and all. Without the provider check it would be a way to claim a number
    // by signing in as anybody.
    await rejects(
      await token({ claims: { firebase: { sign_in_provider: 'google.com' } } }),
      'not-a-phone-sign-in',
    );
    await rejects(await token({ claims: { firebase: undefined } }), 'not-a-phone-sign-in');
  });

  it('refuses a token with no number, or one that is not E.164', async () => {
    await rejects(await token({ claims: { phone_number: undefined } }), 'no-phone');
    await rejects(await token({ claims: { phone_number: '07700900123' } }), 'no-phone');
    await rejects(await token({ claims: { phone_number: '+0700900123' } }), 'no-phone');
  });

  it('refuses a token with no subject', async () => {
    await rejects(await token({ claims: { sub: '' } }), 'no-subject');
    await rejects(await token({ claims: { sub: 'x'.repeat(129) } }), 'no-subject');
  });
});

describe('anything that is not a token', () => {
  it.each([
    ['empty', ''],
    ['one part', 'abc'],
    ['two parts', 'abc.def'],
    ['four parts', 'a.b.c.d'],
    ['not base64url', 'a b.c d.e f'],
    ['not JSON', `${base64Url(new TextEncoder().encode('hello'))}.x.y`],
  ])('refuses %s', async (_name, value) => {
    const result = await check(value);
    expect(result.ok).toBe(false);
  });

  it('refuses something far too long to be a token', async () => {
    await rejects('a'.repeat(9000), 'malformed');
  });
});
