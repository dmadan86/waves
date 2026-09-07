/**
 * Drive authorization, now that Google's browser redirect is gone on Android.
 *
 * The flow this replaces could be reasoned about from the URL: a code came back
 * to `waves://oauthredirect`, was exchanged for a refresh token, and the refresh
 * token renewed itself for as long as the grant stood. None of that exists any
 * more. Play services holds the grant, hands out an access token that lasts
 * about an hour, and says nothing about when it was minted.
 *
 * So the properties worth pinning down are the ones that changed shape:
 *
 *   * a renewal is **silent** — a backup running in the background must never
 *     put a sheet in front of somebody who did not ask for one;
 *   * a grant that is gone reads as **401**, the same thing a Drive call would
 *     say, because that is the one signal the engine acts on;
 *   * a dismissed sheet is **not an error**, because they meant it;
 *   * unlinking tells **Google**, not only this phone's keystore.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
}));

const { googleDrive } = await import('../src/lib/cloud/googleDrive');
const { setSigninModuleForTests } = await import('../src/lib/cloud/nativeGoogle');
const { isConfigured } = await import('../src/lib/cloud/config');
const { CloudHttpError } = await import('../src/lib/cloud/http');

const SIGN_IN_CANCELLED = 'SIGN_IN_CANCELLED';
const SIGN_IN_REQUIRED = 'SIGN_IN_REQUIRED';

interface FakeState {
  /** What the interactive sheet does. */
  signIn: 'success' | 'cancelled' | 'throws-cancelled';
  /** What a silent renewal finds. */
  silent: 'success' | 'nobody' | 'required';
  accessToken: string;
}

const state: FakeState = { signIn: 'success', silent: 'success', accessToken: 'token-1' };
const calls = {
  signIn: vi.fn(),
  signInSilently: vi.fn(),
  getTokens: vi.fn(),
  cleared: vi.fn(),
  revoked: vi.fn(),
  configured: vi.fn(),
};

function cancelled(code: string): Error & { code: string } {
  return Object.assign(new Error('cancelled'), { code });
}

/** Only the surface `nativeGoogle` actually touches. */
function fakeModule() {
  return {
    GoogleSignin: {
      configure: (params: unknown) => calls.configured(params),
      hasPlayServices: async () => true,
      async signIn() {
        calls.signIn();
        if (state.signIn === 'throws-cancelled') throw cancelled(SIGN_IN_CANCELLED);
        if (state.signIn === 'cancelled') return { type: 'cancelled', data: null };
        return { type: 'success', data: { user: { email: 'someone@example.com' } } };
      },
      async signInSilently() {
        calls.signInSilently();
        if (state.silent === 'required') throw cancelled(SIGN_IN_REQUIRED);
        if (state.silent === 'nobody') return { type: 'noSavedCredentialFound', data: null };
        return { type: 'success', data: { user: { email: 'someone@example.com' } } };
      },
      async getTokens() {
        calls.getTokens();
        return { idToken: 'id', accessToken: state.accessToken };
      },
      async clearCachedAccessToken(token: string) {
        calls.cleared(token);
        return null;
      },
      async revokeAccess() {
        calls.revoked();
        return null;
      },
      async signOut() {
        return null;
      },
    },
    isSuccessResponse: (response: { type: string }) => response.type === 'success',
    isErrorWithCode: (error: unknown) =>
      typeof error === 'object' && error !== null && 'code' in error,
    statusCodes: { SIGN_IN_CANCELLED, SIGN_IN_REQUIRED },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.signIn = 'success';
  state.silent = 'success';
  state.accessToken = 'token-1';
  process.env.EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID_WEB = '1234.apps.googleusercontent.com';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setSigninModuleForTests(fakeModule() as any);
});

describe('asking for consent', () => {
  it('hands back a token that expires, and no refresh token to renew it with', async () => {
    const tokens = await googleDrive.connect();
    expect(tokens?.accessToken).toBe('token-1');
    // The absence matters: `isExpired` waits for a refresh when one exists, and
    // there is nothing here that could ever perform it.
    expect(tokens?.refreshToken).toBeNull();
    expect(tokens?.expiresAt).toBeGreaterThan(Date.now());
    // Under an hour, because Google's are an hour and this one is already older
    // than the moment it was asked for.
    expect(tokens?.expiresAt).toBeLessThanOrEqual(Date.now() + 60 * 60_000);
  });

  it('names the project it is asking on behalf of', async () => {
    await googleDrive.connect();
    expect(calls.configured).toHaveBeenCalledWith(
      expect.objectContaining({
        webClientId: '1234.apps.googleusercontent.com',
        scopes: ['https://www.googleapis.com/auth/drive.appdata'],
        // A code meant for a server holding a client secret. There is no such
        // server, and asking for one would put a longer-lived grant on a phone.
        offlineAccess: false,
      }),
    );
  });

  it('treats a dismissed sheet as a decision, not a failure', async () => {
    state.signIn = 'cancelled';
    await expect(googleDrive.connect()).resolves.toBeNull();
  });

  it('treats a cancellation raised as an error the same way', async () => {
    // Android reports this by rejecting rather than resolving.
    state.signIn = 'throws-cancelled';
    await expect(googleDrive.connect()).resolves.toBeNull();
  });
});

describe('renewing an expired token', () => {
  const expired = { accessToken: 'token-1', refreshToken: null, expiresAt: Date.now() - 1_000 };

  it('does it without a sheet', async () => {
    state.accessToken = 'token-2';
    const renewed = await googleDrive.ensureValid(expired);
    expect(renewed.accessToken).toBe('token-2');
    expect(calls.signInSilently).toHaveBeenCalled();
    expect(calls.signIn).not.toHaveBeenCalled();
  });

  it('drops the stale token first, or Android returns it again', async () => {
    await googleDrive.ensureValid(expired);
    expect(calls.cleared).toHaveBeenCalledWith('token-1');
  });

  it('leaves a token that is still good alone', async () => {
    const fresh = { accessToken: 'token-1', refreshToken: null, expiresAt: Date.now() + 600_000 };
    await expect(googleDrive.ensureValid(fresh)).resolves.toBe(fresh);
    expect(calls.getTokens).not.toHaveBeenCalled();
  });

  it('reports a revoked grant as a 401, which is what the engine acts on', async () => {
    state.silent = 'nobody';
    await expect(googleDrive.ensureValid(expired)).rejects.toBeInstanceOf(CloudHttpError);
    await expect(googleDrive.ensureValid(expired)).rejects.toMatchObject({ status: 401 });
  });

  it('says the same when Google wants the person to sign in again', async () => {
    state.silent = 'required';
    await expect(googleDrive.ensureValid(expired)).rejects.toMatchObject({ status: 401 });
  });
});

describe('unlinking', () => {
  it('gives the grant back to Google rather than only forgetting it here', async () => {
    await googleDrive.revoke?.({
      accessToken: 'token-1',
      refreshToken: null,
      expiresAt: Date.now(),
    });
    expect(calls.revoked).toHaveBeenCalled();
    expect(calls.cleared).toHaveBeenCalledWith('token-1');
  });
});

describe('whether the row is offered at all', () => {
  it('is not, on a build that names no project', () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID_WEB;
    expect(isConfigured('gdrive')).toBe(false);
    expect(googleDrive.isConfigured()).toBe(false);
  });

  it('is not, on a build whose binary predates the module', () => {
    setSigninModuleForTests(null);
    // The project is still named; the phone simply cannot ask.
    expect(isConfigured('gdrive')).toBe(true);
    expect(googleDrive.isConfigured()).toBe(false);
  });
});
