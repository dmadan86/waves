/**
 * Everything this service needs to know about the world it is running in.
 *
 * There is not a single domain name in this repository's API code, and that is
 * deliberate rather than tidy. Waves is meant to be re-homed (see MIGRATION.md):
 * somebody self-hosting the whole stack should be able to point the developer
 * API at their own hostname by setting environment variables and nothing else.
 * A literal `api.wavs.co.in` compiled into an OAuth issuer or a metadata
 * document would be a lie on every deployment but one, and the kind of lie that
 * only shows up once a third-party client refuses to connect.
 *
 * So: the public base URL is *derived from the request* unless overridden, and
 * every other address is a variable with no fallback. Where a value is genuinely
 * required and missing, the endpoint that needs it answers a clear
 * `misconfigured` rather than guessing — a guess here means minting tokens for
 * an audience that does not exist.
 */

/** Read the first of several names that has a non-empty value. */
function firstOf(...names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

function intOf(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/** A base URL with any trailing slash removed, so `${base}/v1` is never `//v1`. */
export function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export interface ApiConfig {
  /** The Supabase (or self-hosted GoTrue/PostgREST) gateway this API reads through. */
  readonly supabaseUrl: string;
  /** Public by design: every table is behind RLS, so it grants nothing on its own. */
  readonly supabaseAnonKey: string;
  /**
   * The project's JWT secret. Used for one thing only — signing a short-lived
   * `authenticated` JWT for the person a token names, so PostgREST and the edge
   * functions apply that person's row-level security exactly as they would for
   * the phone. This service holds no service-role key and never mints one.
   */
  readonly jwtSecret: string;
  /**
   * Signs the API's own credentials: personal access tokens, OAuth access and
   * refresh tokens, and authorization codes. Separate from the JWT secret so it
   * can be rotated on its own — rotating the project's JWT secret signs every
   * Waves user out, which is not a thing anyone will do to retire an API key.
   */
  readonly tokenSecret: string;
  /** Where the browser is sent to approve an OAuth request. No default: see above. */
  readonly webUrl: string | undefined;
  /** Origins allowed to call the developer surface from a browser. */
  readonly allowedOrigins: readonly string[];
  /** Overrides the request-derived public base URL when a proxy hides it. */
  readonly publicUrl: string | undefined;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlDays: number;
  readonly authorizationCodeTtlSeconds: number;
  /** How long a minted user JWT lives. Seconds, because a request is seconds. */
  readonly userJwtTtlSeconds: number;
}

export function readConfig(): ApiConfig {
  return {
    supabaseUrl:
      firstOf('WAVES_API_SUPABASE_URL', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL') ?? '',
    supabaseAnonKey:
      firstOf(
        'WAVES_API_SUPABASE_ANON_KEY',
        'SUPABASE_ANON_KEY',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      ) ?? '',
    jwtSecret: firstOf('WAVES_API_JWT_SECRET', 'SUPABASE_JWT_SECRET') ?? '',
    tokenSecret: firstOf('WAVES_API_TOKEN_SECRET') ?? '',
    webUrl: firstOf('WAVES_API_WEB_URL'),
    allowedOrigins: (process.env.WAVES_API_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((value) => trimSlash(value.trim()))
      .filter(Boolean),
    publicUrl: firstOf('WAVES_API_PUBLIC_URL'),
    // An hour is long enough that a client is not refreshing constantly and
    // short enough that a leaked access token is a nuisance rather than an
    // incident. The floor and ceiling stop a typo turning it into either.
    accessTokenTtlSeconds: intOf('WAVES_API_ACCESS_TOKEN_TTL_SECONDS', 3600, 300, 86400),
    refreshTokenTtlDays: intOf('WAVES_API_REFRESH_TOKEN_TTL_DAYS', 90, 1, 365),
    authorizationCodeTtlSeconds: intOf('WAVES_API_AUTHORIZATION_CODE_TTL_SECONDS', 300, 30, 600),
    userJwtTtlSeconds: intOf('WAVES_API_USER_JWT_TTL_SECONDS', 60, 15, 300),
  };
}

/**
 * This service's own address, as the caller reached it.
 *
 * Taken from the request rather than a constant so a fork, a preview
 * deployment and a self-host all describe themselves correctly with no
 * configuration at all. `WAVES_API_PUBLIC_URL` exists for the case the
 * derivation cannot get right: a proxy that rewrites the path prefix, or a
 * deployment reached through a hostname it is never told about.
 */
export function publicBaseUrl(request: Request, config: ApiConfig = readConfig()): string {
  if (config.publicUrl) return trimSlash(config.publicUrl);

  const headers = request.headers;
  const forwardedHost = headers.get('x-forwarded-host') ?? headers.get('host');
  const forwardedProto = headers.get('x-forwarded-proto');
  if (forwardedHost) {
    // Loopback is the one place a developer legitimately runs this without TLS.
    const proto =
      forwardedProto?.split(',')[0]?.trim() ??
      (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(forwardedHost) ? 'http' : 'https');
    return trimSlash(`${proto}://${forwardedHost}`);
  }
  return trimSlash(new URL(request.url).origin);
}
