/**
 * The middleware that turns `Authorization: Bearer …` into a caller.
 *
 * Four things happen here and the order matters:
 *
 *   1. the presented string's HMAC is checked, which costs no round trip and
 *      is where a forgery stops;
 *   2. a one-minute `authenticated` JWT is minted for the person it names;
 *   3. `waves_api_authorize_call` is asked, **as that person**, whether the
 *      token is live, carries the scope this route needs, and has budget left;
 *   4. only then does the route run, against a client that is that person.
 *
 * Step 3 does the scope check rather than this file, on purpose. The token
 * string carries no scope list — the row does — so narrowing an application's
 * permissions takes effect on its next request rather than on its next token.
 * It also does the rate limiting, against two buckets: one per token and one
 * per person. The second is the one that matters. A caller who has spent a
 * token's minute can mint another in a second, so a per-token limit alone is a
 * speed bump; the per-person subject is derived from the session inside the
 * function and cannot be aimed at anybody else.
 */

import type { Context, MiddlewareHandler } from 'hono';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WavesClient } from '@waves/api-client';

import { CredentialKind, sha256Hex, verifyCredential } from './credentials';
import { readConfig, type ApiConfig } from './env';
import { ApiError, fromUnknown } from './errors';
import type { Scope } from './scopes';
import { bearerOf, clientFor, signUserJwt, wavesFor } from './session';
import { isSignatureRejection } from './signing';

export interface Caller {
  readonly profileId: string;
  readonly tokenId: string;
  readonly appId: string | null;
  readonly scopes: readonly string[];
  readonly supabase: SupabaseClient;
  readonly waves: WavesClient;
}

export interface RateSnapshot {
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt: string;
}

export type ApiEnv = {
  Variables: {
    caller: Caller;
    requestId: string;
    rate?: RateSnapshot;
    config: ApiConfig;
  };
};

interface AuthorizeResult {
  allowed: boolean;
  profileId: string;
  appId: string | null;
  scopes: string[];
  limit: number;
  remaining: number;
  retryAfter: number;
  resetAt: string;
}

const CHALLENGE = 'Bearer realm="waves", error="invalid_token"';

/**
 * Require a live API token carrying `scope`.
 *
 * Written as a factory so every route states its scope at the point it is
 * mounted. A route with no scope named would still authenticate, which is why
 * there is no default: forgetting the argument is a type error.
 */
export function requireScope(scope: Scope): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const config = c.get('config') ?? readConfig();
    const presented = bearerOf(c.req.raw);
    if (!presented) {
      throw new ApiError('unauthorized', 'Send an API token in the Authorization header.', {
        'WWW-Authenticate': 'Bearer realm="waves"',
      });
    }

    if (!config.tokenSecret) {
      throw new ApiError(
        'misconfigured',
        'This deployment cannot verify tokens. Set WAVES_API_TOKEN_SECRET.',
      );
    }

    const credential = verifyCredential(config.tokenSecret, presented);
    // A refresh token is a credential for the token endpoint and nothing else;
    // the database refuses it too, and saying so here saves a round trip.
    if (
      !credential ||
      (credential.kind !== CredentialKind.Personal && credential.kind !== CredentialKind.Access)
    ) {
      throw new ApiError('invalid_token', 'That is not a usable API token.', {
        'WWW-Authenticate': CHALLENGE,
      });
    }

    const accessToken = signUserJwt(config, credential.profileId, []);
    const supabase = clientFor(config, accessToken);

    const { data, error } = await supabase.rpc('waves_api_authorize_call', {
      p_token_id: credential.id,
      p_token_hash: sha256Hex(presented),
      p_scope: scope,
    });
    if (error) {
      // A session signed two hundred milliseconds ago cannot legitimately be
      // unverifiable — this process made it. So a JWT-level refusal is a fault
      // in *this deployment's* signing key, and answering 401 would send a
      // developer holding a perfectly good API token to debug the one thing
      // that is not wrong. It is a 500, and it says so.
      if (isSignatureRejection(error)) {
        throw new ApiError(
          'misconfigured',
          'This deployment cannot sign a session the backend will accept. That is a fault on our side, not a problem with your token — the operator can see the detail at /health.',
        );
      }
      const mapped = fromUnknown(error);
      // Every other refusal from the function is about the token, so it earns
      // the challenge header that tells a client to stop retrying with this one.
      throw new ApiError(mapped.code, mapped.message, { 'WWW-Authenticate': CHALLENGE });
    }

    const result = data as AuthorizeResult | null;
    if (!result) {
      throw new ApiError('invalid_token', 'That token is not usable.', {
        'WWW-Authenticate': CHALLENGE,
      });
    }

    const snapshot: RateSnapshot = {
      limit: result.limit,
      remaining: result.remaining,
      resetAt: result.resetAt,
    };
    c.set('rate', snapshot);

    if (!result.allowed) {
      const retryAfter = Math.max(result.retryAfter || 1, 1);
      throw new ApiError('rate_limited', 'Too many requests. Slow down and try again shortly.', {
        'Retry-After': String(retryAfter),
        ...rateHeaders(snapshot),
      });
    }

    c.set('caller', {
      profileId: result.profileId,
      tokenId: credential.id,
      appId: result.appId,
      scopes: result.scopes,
      supabase,
      waves: wavesFor(config, accessToken),
    });

    await next();
  };
}

export function rateHeaders(snapshot: RateSnapshot | undefined): Record<string, string> {
  if (!snapshot) return {};
  // Seconds from now, not a timestamp. The IETF RateLimit-header draft specifies
  // delta-seconds, `Retry-After` on the same 429 is delta-seconds, and two units
  // on one response is how a client ends up sleeping until 1970.
  const reset = Math.max(0, Math.ceil((Date.parse(snapshot.resetAt) - Date.now()) / 1000));
  return {
    'RateLimit-Limit': String(snapshot.limit),
    'RateLimit-Remaining': String(snapshot.remaining),
    'RateLimit-Reset': String(Number.isFinite(reset) ? reset : 60),
  };
}

export function caller(c: Context<ApiEnv>): Caller {
  const value = c.get('caller');
  if (!value) throw new ApiError('unauthorized', 'Send an API token in the Authorization header.');
  return value;
}
