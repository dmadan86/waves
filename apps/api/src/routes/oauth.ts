/**
 * OAuth 2.1 authorization code with PKCE — how somebody else's program comes to
 * act for a Waves user.
 *
 * The flow is deliberately boring, because every interesting variation of it is
 * a vulnerability somebody has already had. What is worth reading:
 *
 * **`GET /oauth/authorize` never redirects to a caller-supplied address.** It
 * checks the *shape* of the request and sends the browser to this deployment's
 * own consent screen, carrying the parameters along. Whether the client and the
 * redirect are real is decided later, by `waves_api_consent_preview`, under the
 * signed-in user's session. That ordering means an unregistered `redirect_uri`
 * can never be reached — a validator that bounced errors back to it would be an
 * open redirect wearing an OAuth costume.
 *
 * **The consent screen cannot mint a code.** It calls back into
 * `POST /oauth/authorize` with the user's own session; the code is signed here,
 * where the HMAC key lives, and written by an RPC that re-checks the redirect
 * and the scopes against the app's registration. The browser between the two
 * screens is the attacker's ground, so nothing it carries is believed twice.
 *
 * **A code and a refresh token are both single-use, and the database enforces
 * it.** Consumption is an UPDATE guarded on `consumed_at IS NULL`; two clients
 * replaying the same code both run it and exactly one row moves.
 *
 * **The errors here are RFC 6749's shape, not this API's.** `{"error":
 * "invalid_grant", "error_description": …}` with `error` as a *string* is what
 * every OAuth client library in existence parses. Being internally consistent
 * at the cost of being unusable would be the wrong trade, and it is the only
 * place in this service that deviates.
 */

import { Hono } from 'hono';
import type { ApiEnv } from '../server/authorize';
import {
  CredentialKind,
  mintCredential,
  s256,
  sha256Hex,
  verifyCredential,
} from '../server/credentials';
import { publicBaseUrl, readConfig, trimSlash } from '../server/env';
import { ApiError } from '../server/errors';
import { parseScopes, SCOPES, SCOPE_SUMMARY } from '../server/scopes';
import { bearerOf, clientFor, profileFromSession, signUserJwt } from '../server/session';

export const oauth = new Hono<ApiEnv>();

type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'server_error';

class OAuthError extends Error {
  constructor(
    readonly error: OAuthErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Map the database's own refusals onto the vocabulary OAuth clients know. */
function asOAuthError(caught: unknown): OAuthError {
  if (caught instanceof OAuthError) return caught;
  const raw = caught instanceof Error ? caught.message : String(caught);
  const code = /^([A-Z][A-Z0-9_]+):\s*(.+)$/.exec(raw.trim());
  const sentence = code ? (code[2] as string) : 'The request could not be completed.';
  switch (code?.[1]) {
    case 'UNKNOWN_CLIENT':
    case 'BAD_CLIENT_SECRET':
      return new OAuthError('invalid_client', sentence, 401);
    case 'INVALID_GRANT':
      return new OAuthError('invalid_grant', sentence);
    case 'BAD_REDIRECT':
      return new OAuthError('invalid_grant', sentence);
    case 'SCOPE_NOT_ALLOWED':
      return new OAuthError('invalid_scope', sentence);
    case 'NOT_SIGNED_IN':
      return new OAuthError('invalid_grant', sentence, 401);
    default:
      console.error('unhandled oauth error:', raw);
      return new OAuthError('server_error', 'Something went wrong on our side.', 500);
  }
}

function oauthFailure(error: OAuthError): Response {
  return Response.json(
    { error: error.error, error_description: error.message },
    {
      status: error.status,
      headers: {
        // A token endpoint answer is never cacheable: it is a credential.
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        ...(error.error === 'invalid_client' ? { 'WWW-Authenticate': 'Basic realm="waves"' } : {}),
      },
    },
  );
}

// ─────────────────────────────────────────────────────────── discovery ──

oauth.get('/.well-known/oauth-authorization-server', (c) => {
  const base = publicBaseUrl(c.req.raw);
  return c.json({
    // The issuer is this deployment's own address, derived from the request
    // rather than written down, so a self-host describes itself correctly with
    // no configuration (see server/env.ts).
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    revocation_endpoint: `${base}/oauth/revoke`,
    scopes_supported: [...SCOPES],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    // S256 only. `plain` is a challenge an attacker who can read the request can
    // also read the answer to.
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
  });
});

/** The scope catalogue, in words a consent screen or a README can reuse. */
oauth.get('/oauth/scopes', (c) =>
  c.json({
    data: SCOPES.map((scope) => ({ scope, description: SCOPE_SUMMARY[scope] })),
  }),
);

// ─────────────────────────────────────────────────────────── authorize ──

interface AuthorizeRequest {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string;
  state: string | null;
}

function readAuthorizeParams(source: URLSearchParams | Record<string, unknown>): AuthorizeRequest {
  const get = (name: string): string | null => {
    const value =
      source instanceof URLSearchParams ? source.get(name) : (source[name] as string | undefined);
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };

  const responseType = get('response_type');
  if (responseType !== 'code') {
    throw new OAuthError('invalid_request', 'response_type must be "code".');
  }
  const clientId = get('client_id');
  if (!clientId) throw new OAuthError('invalid_request', 'client_id is required.');
  const redirectUri = get('redirect_uri');
  if (!redirectUri) throw new OAuthError('invalid_request', 'redirect_uri is required.');

  const scopes = parseScopes(get('scope'));
  if (!scopes) {
    throw new OAuthError(
      'invalid_scope',
      `scope is a space-separated list from: ${SCOPES.join(' ')}.`,
    );
  }

  if (get('code_challenge_method') !== 'S256') {
    throw new OAuthError('invalid_request', 'code_challenge_method must be "S256".');
  }
  const codeChallenge = get('code_challenge');
  if (!codeChallenge || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    throw new OAuthError(
      'invalid_request',
      'code_challenge is the unpadded base64url SHA-256 of your verifier.',
    );
  }

  return { clientId, redirectUri, scopes, codeChallenge, state: get('state') };
}

/**
 * Send the browser to the consent screen.
 *
 * Nothing is written and nothing is validated against the database here — this
 * endpoint has no session and therefore no rights, which is precisely why it
 * cannot be used to probe whether a client id exists.
 */
oauth.get('/oauth/authorize', (c) => {
  const config = readConfig();
  if (!config.webUrl) {
    return oauthFailure(
      new OAuthError(
        'server_error',
        'This deployment has no consent screen configured. Set WAVES_API_WEB_URL.',
        500,
      ),
    );
  }

  let params: AuthorizeRequest;
  try {
    params = readAuthorizeParams(new URL(c.req.url).searchParams);
  } catch (caught) {
    return oauthFailure(asOAuthError(caught));
  }

  const consent = new URL(`${trimSlash(config.webUrl)}/developers/authorize`);
  consent.searchParams.set('client_id', params.clientId);
  consent.searchParams.set('redirect_uri', params.redirectUri);
  consent.searchParams.set('scope', params.scopes.join(' '));
  consent.searchParams.set('code_challenge', params.codeChallenge);
  if (params.state) consent.searchParams.set('state', params.state);

  return c.redirect(consent.toString(), 302);
});

/**
 * The consent screen saying yes, on behalf of the person looking at it.
 *
 * Authenticated by that person's own Waves session, not by a client credential:
 * the decision being recorded is theirs. The code is signed here and written by
 * an RPC that checks the redirect and the scopes against the registration one
 * more time.
 */
oauth.post('/oauth/authorize', async (c) => {
  const config = readConfig();
  try {
    const sessionToken = bearerOf(c.req.raw);
    if (!sessionToken) throw new OAuthError('invalid_request', 'Sign in to approve this.', 401);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const params = readAuthorizeParams(body);

    const { profileId } = await profileFromSession(config, sessionToken);
    const supabase = clientFor(config, sessionToken);

    const code = mintCredential(config.tokenSecret, CredentialKind.Code, profileId);
    const { error } = await supabase.rpc('waves_api_issue_code', {
      p_code_id: code.id,
      p_code_hash: code.hash,
      p_client_id: params.clientId,
      p_redirect_uri: params.redirectUri,
      p_scopes: params.scopes,
      p_code_challenge: params.codeChallenge,
      p_ttl_seconds: config.authorizationCodeTtlSeconds,
    });
    if (error) throw error;

    // Built only now, from the redirect the RPC has just confirmed is registered
    // for this client.
    const target = new URL(params.redirectUri);
    target.searchParams.set('code', code.token);
    if (params.state) target.searchParams.set('state', params.state);

    return c.json({ redirect_to: target.toString() }, 200, { 'Cache-Control': 'no-store' });
  } catch (caught) {
    if (caught instanceof ApiError) {
      // A stale session and a malformed request are different problems with
      // different fixes — one means "sign in again", the other "fix your call" —
      // and flattening both to `invalid_request` leaves the consent screen
      // sniffing status codes to tell them apart.
      const code: OAuthErrorCode =
        caught.code === 'unauthorized' || caught.code === 'invalid_token'
          ? 'invalid_grant'
          : caught.code === 'misconfigured' || caught.code === 'internal'
            ? 'server_error'
            : 'invalid_request';
      return oauthFailure(new OAuthError(code, caught.message, caught.status));
    }
    return oauthFailure(asOAuthError(caught));
  }
});

// ─────────────────────────────────────────────────────────────── token ──

/**
 * Client credentials, from either place the spec allows them.
 *
 * HTTP Basic is preferred by RFC 6749 and `client_secret_post` is what most
 * libraries actually send, so both are accepted. A public client sends neither
 * and is authenticated by PKCE and its registered redirect alone — which is the
 * most that is ever true of software installed on somebody's phone.
 */
function clientCredentials(
  request: Request,
  form: URLSearchParams,
): { clientId: string; secret: string | null } {
  const header = request.headers.get('authorization');
  const basic = header && /^basic\s+/i.test(header) ? header.replace(/^basic\s+/i, '') : null;
  if (basic) {
    let decoded = '';
    try {
      decoded = Buffer.from(basic, 'base64').toString('utf8');
    } catch {
      throw new OAuthError(
        'invalid_client',
        'That Authorization header is not valid Basic auth.',
        401,
      );
    }
    const split = decoded.indexOf(':');
    if (split < 1) {
      throw new OAuthError(
        'invalid_client',
        'That Authorization header is not valid Basic auth.',
        401,
      );
    }
    return {
      clientId: decodeURIComponent(decoded.slice(0, split)),
      secret: decodeURIComponent(decoded.slice(split + 1)),
    };
  }

  const clientId = form.get('client_id');
  if (!clientId) throw new OAuthError('invalid_client', 'client_id is required.', 401);
  return { clientId, secret: form.get('client_secret') };
}

oauth.post('/oauth/token', async (c) => {
  const config = readConfig();
  try {
    const form = new URLSearchParams(await c.req.text());
    const { clientId, secret } = clientCredentials(c.req.raw, form);
    const secretHash = secret ? sha256Hex(secret) : null;
    const grantType = form.get('grant_type');

    if (grantType === 'authorization_code') {
      return await exchangeCode(c.req.raw, form, clientId, secretHash, config);
    }
    if (grantType === 'refresh_token') {
      return await rotateRefresh(form, clientId, secretHash, config);
    }
    throw new OAuthError(
      'unsupported_grant_type',
      'grant_type is "authorization_code" or "refresh_token".',
    );
  } catch (caught) {
    return oauthFailure(asOAuthError(caught));
  }
});

type Config = ReturnType<typeof readConfig>;

function tokenResponse(body: Record<string, unknown>): Response {
  return Response.json(body, {
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  });
}

async function exchangeCode(
  _request: Request,
  form: URLSearchParams,
  clientId: string,
  secretHash: string | null,
  config: Config,
): Promise<Response> {
  const presented = form.get('code');
  const redirectUri = form.get('redirect_uri');
  const verifier = form.get('code_verifier');
  if (!presented || !redirectUri || !verifier) {
    throw new OAuthError('invalid_request', 'code, redirect_uri and code_verifier are required.');
  }
  // RFC 7636 bounds the verifier; a short one is a challenge that can be
  // brute-forced offline, and the length check is free.
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
    throw new OAuthError('invalid_request', 'code_verifier is 43 to 128 unreserved characters.');
  }

  const code = verifyCredential(config.tokenSecret, presented);
  if (!code || code.kind !== CredentialKind.Code) {
    throw new OAuthError('invalid_grant', 'That is not a code we issued.');
  }
  // The challenge is compared again inside the RPC, in the same statement that
  // spends the code. This is the cheap early exit, not the guarantee.
  if (s256(verifier).length !== 43) {
    throw new OAuthError('invalid_request', 'code_verifier is 43 to 128 unreserved characters.');
  }

  const supabase = clientFor(config, signUserJwt(config, code.profileId, []));
  const access = mintCredential(config.tokenSecret, CredentialKind.Access, code.profileId);
  const refresh = mintCredential(config.tokenSecret, CredentialKind.Refresh, code.profileId);

  const { data, error } = await supabase.rpc('waves_api_consume_code', {
    p_code_id: code.id,
    p_code_hash: sha256Hex(presented),
    p_client_id: clientId,
    p_client_secret_hash: secretHash,
    p_redirect_uri: redirectUri,
    p_code_verifier: verifier,
    p_access_token_id: access.id,
    p_access_hash: access.hash,
    p_access_prefix: access.prefix,
    p_refresh_token_id: refresh.id,
    p_refresh_hash: refresh.hash,
    p_refresh_prefix: refresh.prefix,
    p_access_ttl_seconds: config.accessTokenTtlSeconds,
    p_refresh_ttl_days: config.refreshTokenTtlDays,
  });
  if (error) throw error;

  const result = data as { refreshTokenId: string | null; scopes: string[] } | null;
  if (!result) throw new OAuthError('server_error', 'The code could not be exchanged.', 500);

  return tokenResponse({
    access_token: access.token,
    token_type: 'Bearer',
    expires_in: config.accessTokenTtlSeconds,
    // Only if `offline_access` was granted — the RPC decides, and reporting a
    // refresh token it did not write would strand the client with a dead one.
    ...(result.refreshTokenId ? { refresh_token: refresh.token } : {}),
    scope: result.scopes.join(' '),
  });
}

async function rotateRefresh(
  form: URLSearchParams,
  clientId: string,
  secretHash: string | null,
  config: Config,
): Promise<Response> {
  const presented = form.get('refresh_token');
  if (!presented) throw new OAuthError('invalid_request', 'refresh_token is required.');

  const old = verifyCredential(config.tokenSecret, presented);
  if (!old || old.kind !== CredentialKind.Refresh) {
    throw new OAuthError('invalid_grant', 'That is not a refresh token we issued.');
  }

  const supabase = clientFor(config, signUserJwt(config, old.profileId, []));
  const access = mintCredential(config.tokenSecret, CredentialKind.Access, old.profileId);
  const refresh = mintCredential(config.tokenSecret, CredentialKind.Refresh, old.profileId);

  const { data, error } = await supabase.rpc('waves_api_rotate_refresh', {
    p_refresh_token_id: old.id,
    p_refresh_hash: sha256Hex(presented),
    p_client_id: clientId,
    p_client_secret_hash: secretHash,
    p_new_access_id: access.id,
    p_new_access_hash: access.hash,
    p_new_access_prefix: access.prefix,
    p_new_refresh_id: refresh.id,
    p_new_refresh_hash: refresh.hash,
    p_new_refresh_prefix: refresh.prefix,
    p_access_ttl_seconds: config.accessTokenTtlSeconds,
    p_refresh_ttl_days: config.refreshTokenTtlDays,
  });
  if (error) throw error;

  const result = data as {
    ok: boolean;
    scopes?: string[];
    disconnected?: boolean;
    message?: string;
  } | null;
  if (!result) throw new OAuthError('server_error', 'The token could not be refreshed.', 500);
  // Reuse of an already-rotated refresh token comes back as a verdict rather
  // than an exception, because the function has to *persist* the disconnection
  // it is reporting and a raise would roll that write back with the statement.
  if (result.ok === false || !result.scopes) {
    throw new OAuthError(
      'invalid_grant',
      result.message ?? 'That refresh token is spent, expired or not for this client.',
    );
  }

  return tokenResponse({
    access_token: access.token,
    token_type: 'Bearer',
    expires_in: config.accessTokenTtlSeconds,
    refresh_token: refresh.token,
    scope: result.scopes.join(' '),
  });
}

// ────────────────────────────────────────────────────────────── revoke ──

/**
 * RFC 7009. Answers 200 whether or not anything was revoked, on purpose: a
 * different answer for "that token was already dead" would turn this endpoint
 * into an oracle for checking whether a stolen string is still worth trying.
 */
oauth.post('/oauth/revoke', async (c) => {
  const config = readConfig();
  try {
    const form = new URLSearchParams(await c.req.text());
    const presented = form.get('token');
    if (!presented) throw new OAuthError('invalid_request', 'token is required.');

    const credential = verifyCredential(config.tokenSecret, presented);
    if (credential && credential.kind !== CredentialKind.Code) {
      const supabase = clientFor(config, signUserJwt(config, credential.profileId, []));
      await supabase.rpc('waves_api_revoke_token', { p_token_id: credential.id });
    }
    return c.body(null, 200, { 'Cache-Control': 'no-store' });
  } catch (caught) {
    return oauthFailure(asOAuthError(caught));
  }
});

/** Exported for the tests, which drive the parsing without a network. */
export const __testables = { readAuthorizeParams, clientCredentials, OAuthError };
