/**
 * What the phone sign-in screen says for each way it can fail: the server's own
 * refusal first (localized by code, else its message), then Firebase's.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/backend', () => ({ backend: {} }));
vi.mock('@/lib/firebaseModule', () => ({ loadFirebaseAuth: () => null }));

const { explain, PhoneAuthError, PhoneSignInUnavailable, PhoneVerifyError } =
  await import('@/lib/phoneAuth');
const { phoneSignInMessage } = await import('@/lib/phoneSignInError');

const strings = {
  phoneErrors: {
    invalidNumber: 'bad number',
    tooMany: 'too many codes',
    unavailable: 'not available on this device',
    network: 'offline',
    invalidCode: 'wrong code',
    expired: 'expired',
  },
  phoneServerErrors: {
    tooMany: 'too many today',
    alreadyUsed: 'used',
    notVerified: 'not verified',
    unavailable: 'try later',
    misconfigured: 'switched off',
    phoneTaken: 'taken',
  },
};

const refusal = (status: number, code: string, message: string) => ({
  context: new Response(JSON.stringify({ code, message }), { status }),
});

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('explain', () => {
  it('keeps the server code, message and status, and logs the code', async () => {
    const e = await explain(refusal(429, 'TOO_MANY', 'Try tomorrow.'), 'fallback');
    expect(e).toBeInstanceOf(PhoneVerifyError);
    expect(e).toMatchObject({ serverCode: 'TOO_MANY', message: 'Try tomorrow.', status: 429 });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('phone-verify'), 'TOO_MANY');
  });

  it('falls back when the body is not ours', async () => {
    const e = await explain({ context: new Response('<html>', { status: 502 }) }, 'fallback');
    expect(e).not.toBeInstanceOf(PhoneVerifyError);
    expect(e.message).toBe('fallback');
  });
});

describe('phoneSignInMessage', () => {
  it.each([
    ['TOO_MANY', 'too many today'],
    ['ALREADY_USED', 'used'],
    ['NOT_VERIFIED', 'not verified'],
    ['UNAVAILABLE', 'try later'],
    ['MISCONFIGURED', 'switched off'],
    ['PHONE_TAKEN', 'taken'],
  ])('localizes %s', (code, text) => {
    expect(phoneSignInMessage(new PhoneVerifyError(code, 'server words'), strings)).toBe(text);
  });

  it('shows the server message for a code with no key', () => {
    expect(phoneSignInMessage(new PhoneVerifyError('NO_ACCOUNT', 'No account yet'), strings)).toBe(
      'No account yet',
    );
  });

  it('surfaces Firebase kinds and an unavailable build on the sign-in screen', () => {
    expect(
      phoneSignInMessage(new PhoneAuthError('unavailable', 'auth/app-not-authorized'), strings),
    ).toBe('not available on this device');
    expect(phoneSignInMessage({ code: 'auth/invalid-verification-code' }, strings)).toBe(
      'wrong code',
    );
    expect(phoneSignInMessage(new PhoneSignInUnavailable(), strings)).toBe(
      'not available on this device',
    );
  });

  it('leaves the unnameable to the generic line', () => {
    expect(phoneSignInMessage(new Error('boom'), strings)).toBeNull();
  });
});
