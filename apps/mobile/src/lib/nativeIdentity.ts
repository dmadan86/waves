/**
 * Signing in the way the phone does it, rather than the way a browser does.
 *
 * The flow this replaces sent somebody out of the app entirely: Waves asked
 * Supabase for an `/authorize` URL, a browser tab opened on Supabase's domain,
 * Supabase bounced it on to Google's consent page, and a redirect came back
 * through `waves://auth` carrying a code. It works, and it is still here (see
 * `oauthThroughBrowser` in `lib/auth.tsx`) — but it shows the person a domain
 * that is not ours and not Google's on the way to their own account, and a
 * chrome tab is not what signing into an app is supposed to look like.
 *
 * What replaces it is the sheet the operating system already knows how to
 * present: Play services on Android, `expo-apple-authentication` on iOS. Both
 * end the same way — an **identity token**, a short-lived JWT saying who this
 * is, signed by Google or by Apple. That token is handed to Supabase through
 * `signInWithIdToken`, so the round trip through a browser and through
 * Supabase's own domain simply does not happen. This is the same mechanism the
 * Drive link already uses for authorization (`lib/cloud/nativeGoogle.ts`); the
 * difference is only what is asked for — who you are, rather than access to
 * your files.
 *
 * Three things this module is careful about.
 *
 * **It never decides the sign-in.** It hands back a credential, a dismissal, or
 * "this build/phone cannot do it". Which Supabase call the credential feeds is
 * `lib/auth.tsx`'s business, because that depends on whether somebody is
 * already signed in (ADR-006: a guest is *linked*, never re-signed-in) — and
 * Supabase has no id-token form of `linkIdentity`, so an upgrade cannot use
 * this path at all.
 *
 * **`unavailable` is not a failure.** A build without the native module, a
 * phone without Play services, Apple on Android, a device with no OAuth client
 * registered for its signature: every one of them still has the browser flow,
 * which is why that flow stays. The caller falls through to it, so the person
 * gets a working sign-in and never a message about a mechanism they did not ask
 * for.
 *
 * **Native modules are required lazily.** A JS bundle can reach a binary older
 * than the dependency — an OTA update onto a previous native build is the
 * ordinary way — and a bare top-level import would take the app down at launch
 * rather than costing it one tile on the sign-in screen.
 */

import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';

import { reportHandled } from '@/lib/observability';

/**
 * How a native sheet ended.
 *
 * `dismissed` and `unavailable` are different on purpose and the caller acts on
 * both: somebody who closed the sheet meant to, and must be left where they
 * were; a build that cannot present one gets the browser instead.
 */
export type NativeSignIn<T> =
  | { readonly kind: 'credential'; readonly credential: T }
  | { readonly kind: 'dismissed' }
  | { readonly kind: 'unavailable' };

/** Google's answer: a JWT saying who this is, for Supabase to verify. */
export interface GoogleCredential {
  readonly idToken: string;
}

/** Apple's answer, plus the two things only Apple attaches to it. */
export interface AppleCredential {
  readonly identityToken: string;
  /**
   * The raw nonce. Apple was given its SHA-256 and stamped that into the token;
   * Supabase is given this and checks the hash matches, which is what stops an
   * identity token captured anywhere else from being a valid sign-in here.
   */
  readonly nonce: string;
  /** Sent on the first authorization only — after that Apple never sends it again. */
  readonly fullName: {
    givenName: string | null;
    middleName: string | null;
    familyName: string | null;
  } | null;
}

const dismissed = { kind: 'dismissed' } as const;
const unavailable = { kind: 'unavailable' } as const;

/* -------------------------------------------------------------------------- */
/* Google                                                                      */
/* -------------------------------------------------------------------------- */

type SigninModule = typeof import('@react-native-google-signin/google-signin');

let signinModule: SigninModule | null | undefined;

function loadGoogle(): SigninModule | null {
  if (signinModule !== undefined) return signinModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    signinModule = require('@react-native-google-signin/google-signin') as SigninModule;
  } catch {
    signinModule = null;
  }
  return signinModule;
}

/**
 * Stand a fake SDK in, for tests — the real one is reached through `require`,
 * which is exactly what a test runner cannot satisfy.
 */
export function setGoogleSigninForTests(module: SigninModule | null): void {
  signinModule = module;
}

/**
 * The Cloud project this build signs in against.
 *
 * There is no *sign-in* client id distinct from the Drive one in any real
 * setup: Google allows one iOS client per bundle id, identifies an Android
 * build by its package name and signing certificate rather than by a string in
 * the bundle, and a web client id is an identifier for the project rather than
 * a credential for a browser. So the Drive names are read as a fallback — a
 * build that already links Drive needs no new environment to sign in natively —
 * while the neutral names exist so a build that offers sign-in and no backup
 * does not have to set something called `..._DRIVE_...`.
 *
 * `EXPO_PUBLIC_*` is inlined by Metro at build time, so each name is spelled out
 * statically: a computed `process.env[key]` is not substituted and reads as
 * undefined in a release bundle.
 */
function googleWebClientId(): string | undefined {
  const id =
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB ||
    process.env.EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID_WEB;
  return id && id.length > 0 ? id : undefined;
}

function googleIosClientId(): string | undefined {
  const id =
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS ||
    process.env.EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID_IOS;
  return id && id.length > 0 ? id : undefined;
}

/**
 * Whether Google's own sheet can be presented at all — asked before the tile is
 * even offered a native path, so an unconfigured build falls through to the
 * browser without a round trip that was always going to fail.
 *
 * Android needs only the web client id, because the app itself is identified by
 * its signature. iOS needs its own client id too, since Apple builds are matched
 * by bundle id. Web has neither: there is no native sheet in a page.
 */
export function googleNativeAvailable(): boolean {
  if (Platform.OS === 'web') return false;
  if (!googleWebClientId()) return false;
  if (Platform.OS === 'ios' && !googleIosClientId()) return false;
  return loadGoogle() !== null;
}

/**
 * The status code Play services returns when it will not even put the request
 * to Google: it found no OAuth client registered for this build's package name
 * and signing certificate. The SDK's `statusCodes` does not name it, so it
 * arrives as a bare `'10'` and would otherwise read as an ordinary failure —
 * and it is the opposite of one, because every retry from now until somebody
 * opens the Google Cloud console fails identically.
 *
 * Here it is still only `unavailable`: sign-in falls back to the browser and
 * the person gets in. But it is reported, because a build in that state is
 * silently paying for a sheet nobody will ever see.
 */
const DEVELOPER_ERROR = '10';

/**
 * Present Google's sheet and come back with an identity token.
 *
 * `offlineAccess` stays off. It returns a code meant to be exchanged for a
 * refresh token *by a server holding the client secret*; sign-in wants the
 * identity token the sheet already produces, and a refresh token on the phone
 * would outlive the grant.
 *
 * The Play-services check does not offer to install anything. That dialog is
 * right on the backup screen, where somebody asked for Drive and needs to know
 * why they cannot have it; on the sign-in screen it would interrupt a person
 * who tapped Google with an errand about an unrelated app, when the browser
 * behind this can serve them perfectly well.
 *
 * No custom nonce: the installed SDK's original sign-in API takes none (its
 * `SignInParams` is `loginHint` and nothing else), so there is no value to bind
 * the token to and hash into it. Supabase still checks the signature, the
 * issuer, the expiry and — the part that matters here — that the audience is
 * this project's own client id, which is the check the "Authorized Client IDs"
 * list in the Supabase Google provider exists to satisfy. Apple below does
 * carry a nonce, because its API accepts one.
 */
export async function googleNativeSignIn(): Promise<NativeSignIn<GoogleCredential>> {
  const module = loadGoogle();
  const webClientId = googleWebClientId();
  const iosClientId = googleIosClientId();
  if (!module || !webClientId || Platform.OS === 'web') return unavailable;
  if (Platform.OS === 'ios' && !iosClientId) return unavailable;

  try {
    module.GoogleSignin.configure({
      webClientId,
      offlineAccess: false,
      ...(Platform.OS === 'ios' ? { iosClientId } : {}),
    });
    await module.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: false });
    const response = await module.GoogleSignin.signIn();
    if (!module.isSuccessResponse(response)) return dismissed;

    const idToken = response.data.idToken;
    if (!idToken) {
      // A success with no token means the web client id names a project that
      // did not issue one — a configuration fault, not a network one, and the
      // browser flow is the working path while it stands.
      reportHandled(new Error('Google sign-in returned no identity token'), 'auth.googleNative');
      return unavailable;
    }
    return { kind: 'credential', credential: { idToken } };
  } catch (error) {
    if (isGoogleCancellation(module, error)) return dismissed;
    reportHandled(googleFault(module, error), 'auth.googleNative');
    return unavailable;
  }
}

/** Whether a rejection means "they closed it", which is a decision, not a fault. */
function isGoogleCancellation(module: SigninModule, error: unknown): boolean {
  if (!module.isErrorWithCode(error)) return false;
  return error.code === module.statusCodes.SIGN_IN_CANCELLED;
}

/**
 * The rejection, with its status code kept in the message.
 *
 * The code is the whole diagnosis and it exists nowhere else by the time this
 * has become "we opened a browser instead" — `DEVELOPER_ERROR` in particular is
 * indistinguishable from a dropped connection without it.
 */
function googleFault(module: SigninModule, error: unknown): Error {
  const status = googleStatusOf(module, error);
  const detail = error instanceof Error ? error.message : String(error);
  const named =
    status === DEVELOPER_ERROR ? ' (DEVELOPER_ERROR: no OAuth client for this build)' : '';
  return new Error(`Google native sign-in failed [${status ?? 'no status'}]${named}: ${detail}`);
}

/**
 * The provider's status code, or null when the rejection carried none. The
 * SDK's own guard first, because that is the supported way to read one, and
 * then the field directly, because the guard admits only codes the library
 * knows about and `DEVELOPER_ERROR` is precisely one it does not.
 */
function googleStatusOf(module: SigninModule, error: unknown): string | null {
  if (module.isErrorWithCode(error)) return String(error.code);
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number' ? String(code) : null;
}

/* -------------------------------------------------------------------------- */
/* Apple                                                                       */
/* -------------------------------------------------------------------------- */

type AppleAuthModule = typeof import('expo-apple-authentication');

let appleModule: AppleAuthModule | null | undefined;

function loadApple(): AppleAuthModule | null {
  if (appleModule !== undefined) return appleModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    appleModule = require('expo-apple-authentication') as AppleAuthModule;
  } catch {
    appleModule = null;
  }
  return appleModule;
}

/** Stand a fake module in, for tests. See `setGoogleSigninForTests`. */
export function setAppleAuthForTests(module: AppleAuthModule | null): void {
  appleModule = module;
}

/**
 * Whether Apple's own sheet can be presented — iOS only, and only on a build
 * carrying the module. Everywhere else Apple sign-in still exists; it just goes
 * through the browser, which is what App Store guideline 4.8 asks for on the
 * platforms where the native sheet is not a thing.
 */
export function appleNativeAvailable(): boolean {
  return Platform.OS === 'ios' && loadApple() !== null;
}

/**
 * Present Apple's native sheet and come back with an identity token.
 *
 * The token is bound to this one request with a nonce: Apple is given its
 * SHA-256 and stamps that into the identity token, Supabase is given the raw
 * value and checks the hash matches. Without it, an identity token captured
 * anywhere — another app, a log, an old device — is a valid sign-in here. The
 * two halves must not be swapped: the hash goes out, the raw value stays.
 */
export async function appleNativeSignIn(): Promise<NativeSignIn<AppleCredential>> {
  if (Platform.OS !== 'ios') return unavailable;
  const apple = loadApple();
  if (!apple) return unavailable;

  const nonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  try {
    const credential = await apple.signInAsync({
      requestedScopes: [
        apple.AppleAuthenticationScope.FULL_NAME,
        apple.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) {
      reportHandled(new Error('Apple sign-in returned no identity token'), 'auth.appleNative');
      return unavailable;
    }
    return {
      kind: 'credential',
      credential: {
        identityToken: credential.identityToken,
        nonce,
        fullName: credential.fullName,
      },
    };
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_REQUEST_CANCELED') return dismissed;
    // Anything else — a simulator with no Apple account, a device that refuses
    // the sheet — is a build that cannot use this path right now, and the
    // browser flow behind it can still sign them in.
    reportHandled(error, 'auth.appleNative');
    return unavailable;
  }
}
