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
 */

import { CloudHttpError } from './http';
import type { CloudTokens } from './types';

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
