/**
 * How a request stops being a token and becomes a person.
 *
 * Every read and every write this API performs happens through the ordinary
 * client — `@waves/api-client`, the same one the browser uses — carrying an
 * `Authorization` header for the person whose token was presented. PostgREST
 * evaluates `waves_current_profile_id()` from that header, so `is_group_member`
 * answers about them, and an expense write reaches the same `expense-write`
 * edge function the phone reaches, with the same membership check and the same
 * server-side share recomputation.
 *
 * That is the whole authorisation story for the developer API: there is no
 * second one. A token cannot see a group its owner cannot, because nothing here
 * ever asks the database a question as anybody else.
 *
 * The JWT this mints lives for about a minute and says only what GoTrue would
 * have said: this subject, the `authenticated` role, this audience. It never
 * carries `service_role`, and this service holds no service-role key to fall
 * back on if it did.
 */

import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createWavesClient, type WavesClient } from '@waves/api-client';

import type { ApiConfig } from './env';
import { ApiError } from './errors';

function base64url(value: string | Buffer): string {
  return Buffer.from(value as string).toString('base64url');
}

/**
 * An HS256 JWT, hand-rolled.
 *
 * Three concatenated base64url segments and an HMAC is the entire standard for
 * this algorithm, and writing it out is both shorter and easier to audit than a
 * dependency — there is exactly one algorithm accepted, so the `alg: none` and
 * algorithm-confusion families have nowhere to land.
 */
export function signUserJwt(
  config: ApiConfig,
  profileId: string,
  scopes: readonly string[],
): string {
  if (!config.jwtSecret) {
    throw new ApiError(
      'misconfigured',
      'This deployment cannot sign a session. Set WAVES_API_JWT_SECRET.',
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      sub: profileId,
      role: 'authenticated',
      aud: 'authenticated',
      iat: now,
      // A minute of clock skew tolerance either way is the difference between a
      // working deployment and one that fails on whichever host drifts.
      nbf: now - 30,
      exp: now + config.userJwtTtlSeconds,
      // Not read by anything today, and present so that a log or an audit row
      // can say the request came through the developer API rather than the app.
      waves_via: 'developer-api',
      waves_scopes: [...scopes],
    }),
  );
  const signature = createHmac('sha256', config.jwtSecret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/**
 * A Supabase client that is this person and no one else.
 *
 * `persistSession` and `autoRefreshToken` are off because there is no session
 * to persist: the token is minted per request and expires before anything could
 * want to refresh it.
 */
export function clientFor(config: ApiConfig, accessToken: string): SupabaseClient {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new ApiError(
      'misconfigured',
      'This deployment is not pointed at a backend. Set WAVES_API_SUPABASE_URL and WAVES_API_SUPABASE_ANON_KEY.',
    );
  }
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function wavesFor(config: ApiConfig, accessToken: string): WavesClient {
  return createWavesClient({ supabase: clientFor(config, accessToken) });
}

/**
 * The bearer token on a request, or null.
 *
 * Case-insensitive on the scheme because RFC 7235 says it is, and clients in
 * the wild send `bearer`.
 */
export function bearerOf(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^bearer\s+(.+)$/i.exec(header.trim());
  return match ? (match[1] as string).trim() : null;
}

/**
 * Who a Waves *session* token belongs to — the developer surface's own auth.
 *
 * Deliberately asks GoTrue rather than verifying the signature here. The
 * developer console is a browser holding a real Supabase session, and that
 * session's token may be signed with a key this service does not have (a
 * project on asymmetric signing keys), or may have been revoked a second ago.
 * Asking the authority costs one hop and is right in both cases.
 */
export async function profileFromSession(
  config: ApiConfig,
  accessToken: string,
): Promise<{ profileId: string; accessToken: string }> {
  const supabase = clientFor(config, accessToken);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    throw new ApiError('unauthorized', 'Sign in to Waves first.', {
      'WWW-Authenticate': 'Bearer',
    });
  }
  return { profileId: data.user.id, accessToken };
}
