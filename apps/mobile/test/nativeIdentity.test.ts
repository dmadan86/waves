/**
 * Signing in without leaving the app.
 *
 * The browser flow this sits in front of is still there and still correct, so
 * what is worth pinning down here is not "does a token come back" — it is the
 * three-way answer this module gives, because every one of them means something
 * different to the person holding the phone:
 *
 *   * a **credential**, which the caller feeds to `signInWithIdToken`;
 *   * **dismissed**, which is a decision and must leave them exactly where they
 *     were — no error, no browser opening behind their back;
 *   * **unavailable**, which is this build or this phone saying it cannot
 *     present the sheet, and is the one case that must fall through to the
 *     browser rather than surface as a failure.
 *
 * That last one is the whole reason the module exists in this shape. A device
 * with no OAuth client registered for its signing certificate refuses *every*
 * native attempt, for ever; if that read as an error the sign-in button would
 * simply be broken, and the browser flow that would have worked never runs.
 *
 * And the nonce, which is the one piece of cryptography here: Apple is given
 * the SHA-256 and Supabase is given the raw value. Swapping them silently
 * disables the replay protection rather than breaking anything visibly, so it
 * is asserted in both directions.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Failures are filed with the crash reporter on the way past, which pulls the
// native Sentry pipeline; stub it, and assert on it.
const reportHandled = vi.hoisted(() => vi.fn());
vi.mock('@/lib/observability', () => ({ reportHandled }));

const platform = { OS: 'android' };

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return platform.OS;
    },
    select: (o: Record<string, unknown>) => o[platform.OS] ?? o.default,
  },
}));

// Hashing is native; a legible stand-in keeps "which value went where" visible
// in the assertions rather than hidden behind sixty-four hex characters.
vi.mock('expo-crypto', () => ({
  randomUUID: () => 'raw-nonce',
  digestStringAsync: async (_algorithm: string, value: string) => `sha256:${value}`,
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

const {
  appleNativeAvailable,
  appleNativeSignIn,
  googleNativeAvailable,
  googleNativeSignIn,
  setAppleAuthForTests,
  setGoogleSigninForTests,
} = await import('../src/lib/nativeIdentity');

const SIGN_IN_CANCELLED = 'SIGN_IN_CANCELLED';
const SIGN_IN_REQUIRED = 'SIGN_IN_REQUIRED';
const PLAY_SERVICES_NOT_AVAILABLE = 'PLAY_SERVICES_NOT_AVAILABLE';
/** Not in the SDK's `statusCodes`; Android rejects with the bare number. */
const DEVELOPER_ERROR = '10';

interface GoogleState {
  signIn: 'success' | 'no-token' | 'cancelled' | 'throws-cancelled' | 'developer-error' | 'network';
  play: 'present' | 'missing';
}

const google: GoogleState = { signIn: 'success', play: 'present' };
const apple = { signIn: 'success' as 'success' | 'no-token' | 'cancelled' | 'throws' };

const calls = {
  configured: vi.fn(),
  playServices: vi.fn(),
  signIn: vi.fn(),
  appleSignIn: vi.fn(),
};

function withCode(code: string): Error & { code: string } {
  return Object.assign(new Error('refused'), { code });
}

/** Only the surface `nativeIdentity` actually touches. */
function fakeGoogleModule() {
  return {
    GoogleSignin: {
      configure: (params: unknown) => calls.configured(params),
      async hasPlayServices(params: unknown) {
        calls.playServices(params);
        if (google.play === 'missing') throw withCode(PLAY_SERVICES_NOT_AVAILABLE);
        return true;
      },
      async signIn() {
        calls.signIn();
        if (google.signIn === 'throws-cancelled') throw withCode(SIGN_IN_CANCELLED);
        if (google.signIn === 'developer-error') {
          // Exactly what RNGoogleSigninModule rejects with: the bare number, and
          // a message pointing at the library's troubleshooting page.
          throw Object.assign(
            new Error('DEVELOPER_ERROR: Follow troubleshooting instructions at ...'),
            { code: DEVELOPER_ERROR },
          );
        }
        if (google.signIn === 'network') throw new Error('network error');
        if (google.signIn === 'cancelled') return { type: 'cancelled', data: null };
        return {
          type: 'success',
          data: {
            idToken: google.signIn === 'no-token' ? null : 'google-id-token',
            user: { email: 'someone@example.com' },
          },
        };
      },
    },
    isSuccessResponse: (response: { type: string }) => response.type === 'success',
    isErrorWithCode: (error: unknown) =>
      typeof error === 'object' && error !== null && 'code' in error,
    statusCodes: { SIGN_IN_CANCELLED, SIGN_IN_REQUIRED, PLAY_SERVICES_NOT_AVAILABLE },
  };
}

function fakeAppleModule() {
  return {
    AppleAuthenticationScope: { FULL_NAME: 'full-name', EMAIL: 'email' },
    async signInAsync(params: unknown) {
      calls.appleSignIn(params);
      if (apple.signIn === 'cancelled') throw withCode('ERR_REQUEST_CANCELED');
      if (apple.signIn === 'throws') throw new Error('the sheet would not open');
      return {
        identityToken: apple.signIn === 'no-token' ? null : 'apple-identity-token',
        fullName: { givenName: 'Ada', middleName: null, familyName: 'Lovelace' },
      };
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  platform.OS = 'android';
  google.signIn = 'success';
  google.play = 'present';
  apple.signIn = 'success';
  delete process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB;
  delete process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS;
  delete process.env.EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID_WEB;
  delete process.env.EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID_IOS;
  process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB = 'web-client.apps.googleusercontent.com';
  setGoogleSigninForTests(
    fakeGoogleModule() as unknown as Parameters<typeof setGoogleSigninForTests>[0],
  );
  setAppleAuthForTests(fakeAppleModule() as unknown as Parameters<typeof setAppleAuthForTests>[0]);
});

describe('Google, through the phone rather than a browser', () => {
  it('comes back with the identity token the sheet issued', async () => {
    const outcome = await googleNativeSignIn();
    expect(outcome).toEqual({ kind: 'credential', credential: { idToken: 'google-id-token' } });
  });

  it('asks only who they are — not for their Drive', async () => {
    await googleNativeSignIn();
    const [params] = calls.configured.mock.calls[0] as [Record<string, unknown>];
    expect(params.webClientId).toBe('web-client.apps.googleusercontent.com');
    // The default scopes (email and profile) are what a sign-in needs. Naming
    // Drive's scope here would put a file-access consent in front of somebody
    // who only tapped "continue with Google".
    expect(params.scopes).toBeUndefined();
    // A code meant for a server holding a client secret. There is no such
    // server, and asking for one would put a longer-lived grant on a phone.
    expect(params.offlineAccess).toBe(false);
  });

  it('does not interrupt a sign-in with an errand about Play services', async () => {
    await googleNativeSignIn();
    // The update dialog belongs on the backup screen, where somebody asked for
    // Drive. Here the browser behind this serves them without a word.
    expect(calls.playServices).toHaveBeenCalledWith({ showPlayServicesUpdateDialog: false });
  });

  it('treats a dismissed sheet as a decision, not a failure', async () => {
    google.signIn = 'cancelled';
    await expect(googleNativeSignIn()).resolves.toEqual({ kind: 'dismissed' });
    expect(reportHandled).not.toHaveBeenCalled();
  });

  it('treats a cancellation raised as an error the same way', async () => {
    // Android reports this by rejecting rather than resolving.
    google.signIn = 'throws-cancelled';
    await expect(googleNativeSignIn()).resolves.toEqual({ kind: 'dismissed' });
    expect(reportHandled).not.toHaveBeenCalled();
  });

  it('falls back rather than fails when no OAuth client matches this build', async () => {
    google.signIn = 'developer-error';
    // `unavailable`, not an error: every retry until somebody opens the Google
    // Cloud console fails identically, and the browser flow still works.
    await expect(googleNativeSignIn()).resolves.toEqual({ kind: 'unavailable' });
  });

  it('files the status code, because it exists nowhere else afterwards', async () => {
    google.signIn = 'developer-error';
    await googleNativeSignIn();

    expect(reportHandled).toHaveBeenCalledTimes(1);
    const [reported, where] = reportHandled.mock.calls[0] as [Error, string];
    expect(where).toBe('auth.googleNative');
    expect(reported.message).toContain(DEVELOPER_ERROR);
    expect(reported.message).toContain('DEVELOPER_ERROR');
    // The account and the token are the two things that must never ride along.
    expect(reported.message).not.toContain('someone@example.com');
    expect(reported.message).not.toContain('google-id-token');
  });

  it('falls back when Google services are absent, without ever asking', async () => {
    google.play = 'missing';
    await expect(googleNativeSignIn()).resolves.toEqual({ kind: 'unavailable' });
    expect(calls.signIn).not.toHaveBeenCalled();
  });

  it('falls back on an ordinary failure too — the browser may still work', async () => {
    google.signIn = 'network';
    await expect(googleNativeSignIn()).resolves.toEqual({ kind: 'unavailable' });
    expect(reportHandled).toHaveBeenCalledTimes(1);
  });

  it('says unavailable, and quietly, when the build carries no module', async () => {
    setGoogleSigninForTests(null);
    await expect(googleNativeSignIn()).resolves.toEqual({ kind: 'unavailable' });
    // An OTA bundle on an older binary is an ordinary state of the world, not
    // an incident.
    expect(reportHandled).not.toHaveBeenCalled();
  });

  it('says unavailable when the build names no Cloud project', async () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB;
    await expect(googleNativeSignIn()).resolves.toEqual({ kind: 'unavailable' });
    expect(calls.signIn).not.toHaveBeenCalled();
  });

  it('reports a success that carried no token — that is a misconfiguration', async () => {
    google.signIn = 'no-token';
    await expect(googleNativeSignIn()).resolves.toEqual({ kind: 'unavailable' });
    expect(reportHandled).toHaveBeenCalledTimes(1);
  });

  it('reads the Drive client ids when no sign-in-specific ones are set', async () => {
    // One Cloud project, one iOS client per bundle id: a build that already
    // links Drive needs no new environment to sign in natively.
    delete process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB;
    process.env.EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID_WEB = 'drive-web.apps.googleusercontent.com';

    await googleNativeSignIn();
    expect(calls.configured).toHaveBeenCalledWith(
      expect.objectContaining({ webClientId: 'drive-web.apps.googleusercontent.com' }),
    );
  });

  it('names the iOS client on iOS, where the app is matched by bundle id', async () => {
    platform.OS = 'ios';
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS = 'ios-client.apps.googleusercontent.com';

    await googleNativeSignIn();
    expect(calls.configured).toHaveBeenCalledWith(
      expect.objectContaining({ iosClientId: 'ios-client.apps.googleusercontent.com' }),
    );
  });

  describe('whether the native path is offered at all', () => {
    it('is, on a configured Android build carrying the module', () => {
      expect(googleNativeAvailable()).toBe(true);
    });

    it('is not on web, where there is no sheet to present', () => {
      platform.OS = 'web';
      expect(googleNativeAvailable()).toBe(false);
    });

    it('is not on iOS without its own client id', () => {
      platform.OS = 'ios';
      expect(googleNativeAvailable()).toBe(false);
      process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS = 'ios-client.apps.googleusercontent.com';
      expect(googleNativeAvailable()).toBe(true);
    });

    it('is not on a binary that predates the module', () => {
      setGoogleSigninForTests(null);
      expect(googleNativeAvailable()).toBe(false);
    });
  });
});

describe('Apple, and the nonce that binds the token to this request', () => {
  beforeEach(() => {
    platform.OS = 'ios';
  });

  it('hands Apple the hash and keeps the raw value for Supabase', async () => {
    const outcome = await appleNativeSignIn();
    expect(outcome).toMatchObject({
      kind: 'credential',
      credential: { identityToken: 'apple-identity-token', nonce: 'raw-nonce' },
    });
    // The half that goes out is the digest. If these two were swapped nothing
    // would break visibly — Supabase would simply stop being able to check
    // anything, which is the failure worth a test.
    const [params] = calls.appleSignIn.mock.calls[0] as [{ nonce: string }];
    expect(params.nonce).toBe('sha256:raw-nonce');
  });

  it('brings back the name Apple sends exactly once', async () => {
    const outcome = await appleNativeSignIn();
    expect(outcome).toMatchObject({
      credential: { fullName: { givenName: 'Ada', familyName: 'Lovelace' } },
    });
  });

  it('treats a dismissed sheet as a decision, not a failure', async () => {
    apple.signIn = 'cancelled';
    await expect(appleNativeSignIn()).resolves.toEqual({ kind: 'dismissed' });
    expect(reportHandled).not.toHaveBeenCalled();
  });

  it('falls back rather than fails when the sheet will not open', async () => {
    apple.signIn = 'throws';
    await expect(appleNativeSignIn()).resolves.toEqual({ kind: 'unavailable' });
    expect(reportHandled).toHaveBeenCalledTimes(1);
  });

  it('reports a sheet that returned no token', async () => {
    apple.signIn = 'no-token';
    await expect(appleNativeSignIn()).resolves.toEqual({ kind: 'unavailable' });
    expect(reportHandled).toHaveBeenCalledTimes(1);
  });

  it('never presents anything off iOS — that is the browser flow’s job', async () => {
    platform.OS = 'android';
    await expect(appleNativeSignIn()).resolves.toEqual({ kind: 'unavailable' });
    expect(calls.appleSignIn).not.toHaveBeenCalled();
    expect(appleNativeAvailable()).toBe(false);
  });

  it('is not offered on a binary that predates the module', () => {
    setAppleAuthForTests(null);
    expect(appleNativeAvailable()).toBe(false);
  });
});
