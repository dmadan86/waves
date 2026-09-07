/**
 * Google authorization the only way Android still allows it.
 *
 * The browser flow this file replaces asked Google for a code and had it
 * redirected back to `waves://oauthredirect`. Google has since withdrawn that
 * mechanism outright — "custom URI schemes are no longer supported on Android
 * and Chrome apps", because any other app can claim the same scheme and catch
 * the redirect. There is no client id that makes it work again; the consent
 * page is refused before the person ever sees it.
 *
 * What replaces it is Google's own sheet, presented by Play services. There is
 * no redirect at all, so there is nothing for another app to intercept: the
 * token is handed to *this* app because the OS knows which app asked, matching
 * the package name and the signing certificate against an OAuth client
 * registered for exactly that pair. That check is why no Android client id is
 * written down anywhere in this repo — the identity is the signature, not a
 * string in the bundle — and why a debug-signed build and a release-signed
 * build need separate clients registered.
 *
 * What is lost: a refresh token of our own. Play services keeps the grant and
 * hands out an access token good for about an hour, so renewing one is asking
 * it again rather than presenting a refresh token. That ask is silent while the
 * consent stands, which is what lets a backup run without interrupting anybody
 * — and what stops working the moment somebody revokes access in their Google
 * account, which is exactly the behaviour that setting is supposed to have.
 */

import { Platform } from 'react-native';

import { clientId, webClientId } from './config';
import type { CloudTokens } from './types';

type SigninModule = typeof import('@react-native-google-signin/google-signin');

/**
 * The native module, or null on a build that does not carry it.
 *
 * Required lazily behind a catch, like every other native module here: a JS
 * bundle can reach a binary older than the dependency (an OTA update onto a
 * previous native build is the ordinary way this happens), and a bare import
 * would take the whole app down at launch rather than disabling one row in
 * settings.
 */
let cached: SigninModule | null | undefined;

function load(): SigninModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('@react-native-google-signin/google-signin') as SigninModule;
  } catch {
    cached = null;
  }
  return cached;
}

/** True when this build can present Google's sheet at all. */
export function nativeAuthAvailable(): boolean {
  return Platform.OS !== 'web' && load() !== null;
}

/**
 * Stand a fake SDK in, for tests.
 *
 * The real one is reached through `require` so that a bundle running on an
 * older binary degrades instead of crashing — and `require` is exactly what a
 * test runner cannot satisfy, so without this seam every path below would be
 * untestable except the one where the module is missing.
 */
export function setSigninModuleForTests(module: SigninModule | null): void {
  cached = module;
  configured = false;
}

/**
 * Google's access tokens last an hour and the SDK does not say when this one
 * was minted. Five minutes are given back so a token cannot expire between the
 * check and the upload that follows it.
 */
const ACCESS_TOKEN_TTL_MS = 55 * 60_000;

/** The one scope this app ever asks Google for. */
const SCOPES = ['https://www.googleapis.com/auth/drive.appdata'];

let configured = false;

/**
 * Hand the SDK its client ids and the scope, once.
 *
 * `webClientId` is required even though no browser is involved and no server of
 * ours is called: it names the Google Cloud project the consent belongs to. The
 * iOS client id is separate because Apple builds are matched by bundle id
 * rather than by signature.
 *
 * `offlineAccess` stays off deliberately. Turning it on returns a code meant to
 * be exchanged for a refresh token *by a server holding the client secret*;
 * this app has no such server, and a refresh token on the phone would outlive
 * the grant the person thinks they gave.
 */
function configure(module: SigninModule): void {
  if (configured) return;
  module.GoogleSignin.configure({
    webClientId: webClientId(),
    scopes: SCOPES,
    offlineAccess: false,
    ...(Platform.OS === 'ios' ? { iosClientId: clientId('gdrive') } : {}),
  });
  configured = true;
}

/** The module, configured — or a thrown failure the caller turns into a sentence. */
function ready(): SigninModule {
  const module = load();
  if (!module) throw new Error('the Google authorization module is missing from this build');
  configure(module);
  return module;
}

function tokensFrom(accessToken: string): CloudTokens {
  return {
    accessToken,
    // Play services holds the grant; there is no refresh token to keep, and
    // pretending otherwise would have `isExpired` wait for a refresh that could
    // never happen.
    refreshToken: null,
    expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS,
  };
}

/**
 * Ask for the scope, presenting Google's sheet.
 *
 * Resolves to null when the person dismissed it — a decision, not a failure,
 * and the screen must not report an error they made on purpose.
 */
export async function nativeAuthorize(): Promise<CloudTokens | null> {
  const module = ready();
  try {
    // Play services can be absent (an emulator built without Google APIs) or
    // too old. Checking first turns that into one clear failure rather than an
    // opaque one from inside the sheet.
    await module.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await module.GoogleSignin.signIn();
    if (!module.isSuccessResponse(response)) return null;
    // `signIn` reports who they are; the token to call Drive with is a separate
    // question, and this is the call that answers it.
    const tokens = await module.GoogleSignin.getTokens();
    return tokensFrom(tokens.accessToken);
  } catch (error) {
    if (isCancellation(module, error)) return null;
    throw error;
  }
}

/**
 * A token good to use now, for a grant that already stands.
 *
 * No sheet: `getTokens` renews silently while the consent holds. The old token
 * is dropped from Play services' cache first, because without that Android
 * happily hands back the same expired string and the next Drive call fails with
 * the 401 this was meant to avoid.
 *
 * Null means the grant is gone — revoked in their Google account, or the
 * account removed from the phone — and the caller turns that into the same
 * "link it again" the screen already knows how to say.
 */
export async function nativeReauthorize(previous: CloudTokens): Promise<CloudTokens | null> {
  const module = ready();
  await forget(module, previous.accessToken);
  try {
    const restored = await module.GoogleSignin.signInSilently();
    // Not `isSuccessResponse`: a silent attempt answers with its own
    // "nobody is signed in" case, which that guard does not accept.
    if (restored.type !== 'success') return null;
    const tokens = await module.GoogleSignin.getTokens();
    return tokensFrom(tokens.accessToken);
  } catch (error) {
    // Sign-in required, cancelled, anything the SDK raises when it cannot do
    // this without asking: the grant is not usable now, and asking belongs to
    // the person tapping Connect rather than to a backup running behind them.
    if (isGone(module, error)) return null;
    throw error;
  }
}

/** Drop a token from Play services' cache. Best effort: a failure changes nothing. */
async function forget(module: SigninModule, accessToken: string): Promise<void> {
  if (Platform.OS !== 'android' || !accessToken) return;
  await module.GoogleSignin.clearCachedAccessToken(accessToken).catch(() => undefined);
}

/**
 * Give the grant back on unlink, so "disconnect" means it in Google's account
 * settings and not only in this app's keystore.
 *
 * Returns false when this build cannot do it, so the caller can fall back to
 * revoking over HTTP rather than quietly leaving the grant standing.
 */
export async function nativeRevoke(tokens: CloudTokens): Promise<boolean> {
  const module = load();
  if (!module) return false;
  await forget(module, tokens.accessToken);
  await module.GoogleSignin.revokeAccess();
  await module.GoogleSignin.signOut().catch(() => undefined);
  return true;
}

/**
 * Whether a rejection means "they closed it", which every caller treats as a
 * cancel rather than an error. The code is read through the library's own type
 * guard, because a rejection is not guaranteed to be an object at all.
 */
function isCancellation(module: SigninModule, error: unknown): boolean {
  if (!module.isErrorWithCode(error)) return false;
  return error.code === module.statusCodes.SIGN_IN_CANCELLED;
}

/** Whether a silent renewal failed because there is nothing to renew. */
function isGone(module: SigninModule, error: unknown): boolean {
  if (!module.isErrorWithCode(error)) return false;
  return (
    error.code === module.statusCodes.SIGN_IN_REQUIRED ||
    error.code === module.statusCodes.SIGN_IN_CANCELLED
  );
}
