/**
 * What is left of the OAuth dance once the dance itself moved.
 *
 * This file used to run authorization-code-plus-PKCE in a browser tab and take
 * the redirect back on the app's own `waves://oauthredirect` scheme. Google
 * withdrew that mechanism on Android — a custom scheme can be claimed by any
 * app on the phone, so the redirect was never really addressed to us — and the
 * flow now goes through Play services instead (see `nativeGoogle.ts`), which
 * has no redirect to intercept at all.
 *
 * What survives is the two judgements that flow needed and the new one still
 * does: whether a token is too old to use, and whether a failure means the
 * grant is gone or merely that the network is. Both are decisions about tokens
 * rather than about how they were obtained, which is why they outlived the
 * transport.
 *
 * And one judgement the new flow added: *why* asking for consent failed. The
 * browser flow answered that in the URL it came back on; Play services answers
 * it in a status code, and a code nobody classifies is a code nobody sees.
 */

import { CloudHttpError } from './http';
import type { CloudTokens } from './types';

/**
 * Why an authorization attempt failed, in the only three kinds that lead
 * anywhere different.
 *
 * The distinction that matters is between a fault of the *build* and a fault of
 * the *moment*. "Try again" is the right advice for exactly one of them, and
 * offering it for the others is how somebody ends up tapping a button forty
 * times against a Google Cloud project that has never had a client registered
 * for this app.
 *
 *   * `not-set-up` — this build cannot ask, and no amount of retrying changes
 *     that: no native module, no client id, or Google refusing the request
 *     outright because it recognises neither the package name nor the signing
 *     certificate (`DEVELOPER_ERROR`). Somebody has to open a console.
 *   * `play-services` — the phone cannot ask. Google's own services are absent
 *     or too old, which the person can actually fix.
 *   * `failed` — everything else: a dropped connection, a timeout, a rejection
 *     nobody has seen before. This one really is worth another tap.
 */
export type CloudAuthFault = 'not-set-up' | 'play-services' | 'failed';

/**
 * A failed attempt at consent, carrying enough to choose a sentence.
 *
 * The provider's own status code rides along because it is the entire diagnosis
 * and is meaningless in a user interface — `10` tells whoever is building
 * exactly what is wrong and tells the person holding the phone nothing at all.
 * It reaches the crash report always, and the screen only in development.
 *
 * Nothing identifying is ever put in here: not the access token, not the
 * account, not the client id. A status code and the SDK's own sentence.
 */
export class CloudAuthError extends Error {
  constructor(
    readonly fault: CloudAuthFault,
    /** The provider's status code, when it gave one. `'10'` is DEVELOPER_ERROR. */
    readonly status: string | null,
    detail: string,
  ) {
    super(
      `cloud authorization failed (${fault}${status === null ? '' : `, ${status}`}): ${detail}`,
    );
    this.name = 'CloudAuthError';
  }
}

/**
 * The OAuth error codes that mean the grant is gone and only a new consent will
 * bring it back — a revoked refresh token, a withdrawn consent, a client that
 * is no longer allowed. Anything else (a dead network, a 500 at the token
 * endpoint) is a transport failure that a retry might fix, and must not be
 * mistaken for one.
 */
const DEAD_GRANT_CODES = new Set([
  'invalid_grant',
  'invalid_client',
  'unauthorized_client',
  'invalid_scope',
  'access_denied',
]);

/**
 * Normalise a failed token exchange into the same 401 the resource API
 * produces, or null when the failure was not about the grant.
 *
 * The point is that one predicate — `isAuthFailure` — covers both halves of the
 * provider. Without this, a refusal because the user revoked access in their
 * Google account settings throws an error that nothing recognises, and the
 * caller ends up reporting "nothing is linked" while the dead tokens sit on
 * disk. The screen then offers the wrong remedy for the rest of time.
 */
export function asAuthFailure(error: unknown): CloudHttpError | null {
  // A rejection is not guaranteed to be an object at all, and a thrown
  // TypeError here would replace the failure being classified with a worse one.
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string' || !DEAD_GRANT_CODES.has(code)) return null;
  const description = (error as { description?: unknown }).description;
  return new CloudHttpError(
    401,
    typeof description === 'string' ? `${code}: ${description}` : code,
  );
}

/** A minute's grace, so a token that expires mid-upload is refreshed first. */
const EXPIRY_SKEW_MS = 60_000;

/** True when the access token is missing or about to expire. */
export function isExpired(tokens: CloudTokens): boolean {
  if (!tokens.accessToken) return true;
  // An unknown expiry is treated as expired so a refreshable token is renewed
  // rather than used until the server rejects it.
  if (tokens.expiresAt === null) return tokens.refreshToken !== null;
  return tokens.expiresAt - EXPIRY_SKEW_MS <= Date.now();
}
