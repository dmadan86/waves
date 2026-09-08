/**
 * The whole service, assembled.
 *
 * Two surfaces with different rules, on one host:
 *
 *   `/v1/*` and `/oauth/*` are the public API. CORS is wide open, because a
 *   token in a header is the entire authentication story — there is no cookie
 *   to ride along, so a permissive `Access-Control-Allow-Origin` grants a
 *   hostile page nothing it could not have got from `curl`.
 *
 *   `/developer/*` is the console's own surface, authenticated by a browser
 *   session. That *is* ambient authority, so its origin allowlist is closed by
 *   default and comes from `WAVES_API_ALLOWED_ORIGINS`. An unset variable
 *   refuses browser calls rather than allowing them, which follows the admin
 *   console's fail-closed stance: a deployment that has not been configured
 *   should be inert, not open.
 *
 * The error handler is the only path a response takes when something goes
 * wrong, so it is the only place that has to be careful about what leaks.
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';

import { rateHeaders, type ApiEnv } from './server/authorize';
import { readConfig } from './server/env';
import { ApiError, errorBody, fromUnknown } from './server/errors';
import { developer } from './routes/developer';
import { oauth } from './routes/oauth';
import { expenses } from './routes/v1/expenses';
import { groups } from './routes/v1/groups';
import { identity } from './routes/v1/identity';
import { people } from './routes/v1/people';
import { settlements } from './routes/v1/settlements';

const PUBLIC_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, idempotency-key',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Expose-Headers':
    'RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After',
};

export function createApp(): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  app.use('*', async (c, next) => {
    c.set('requestId', randomUUID());
    c.set('config', readConfig());
    await next();
  });

  // CORS, decided per surface before anything else runs so a preflight never
  // reaches a handler that would want a token it is not allowed to send.
  app.use('*', async (c, next) => {
    // `POST /oauth/authorize` is the consent screen recording a decision under
    // the person's own session, so it belongs to the console surface even though
    // it sits under /oauth. The GET beside it is a plain browser redirect with no
    // credential at all and stays public.
    const isConsole =
      c.req.path.startsWith('/developer') ||
      (c.req.path === '/oauth/authorize' && c.req.method !== 'GET');
    const origin = c.req.header('origin');
    const headers = isConsole ? consoleCors(c.get('config').allowedOrigins, origin) : PUBLIC_CORS;

    if (c.req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }
    await next();
    for (const [key, value] of Object.entries(headers)) c.res.headers.set(key, value);
    if (isConsole) c.res.headers.set('Vary', 'Origin');
  });

  // A public API is not a page. Nothing here should be framed, sniffed, or
  // cached by an intermediary that cannot see whose token produced it.
  app.use('*', async (c, next) => {
    await next();
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('X-Frame-Options', 'DENY');
    c.res.headers.set('Referrer-Policy', 'no-referrer');
    c.res.headers.set('Cache-Control', c.res.headers.get('Cache-Control') ?? 'private, no-store');
    c.res.headers.set('X-Request-Id', c.get('requestId'));
    for (const [key, value] of Object.entries(rateHeaders(c.get('rate')))) {
      c.res.headers.set(key, value);
    }
  });

  /**
   * Liveness, and a deployment's own account of itself.
   *
   * Deliberately says which configuration is *missing* rather than what any of
   * it is: "no token secret" is the difference between a deployment that will
   * work and one that will 500 on every call, and somebody standing one up
   * needs to be told which. It names variables, never values.
   */
  app.get('/health', (c) => {
    const config = c.get('config');
    const missing = [
      !config.supabaseUrl && 'WAVES_API_SUPABASE_URL',
      !config.supabaseAnonKey && 'WAVES_API_SUPABASE_ANON_KEY',
      !config.jwtSecret && 'WAVES_API_JWT_SECRET',
      !config.tokenSecret && 'WAVES_API_TOKEN_SECRET',
      !config.webUrl && 'WAVES_API_WEB_URL',
    ].filter((value): value is string => typeof value === 'string');
    return c.json({ status: missing.length === 0 ? 'ok' : 'misconfigured', missing }, 200);
  });

  app.route('/', oauth);
  app.route('/', developer);

  const v1 = new Hono<ApiEnv>();
  v1.route('/', identity);
  v1.route('/', groups);
  v1.route('/', expenses);
  v1.route('/', settlements);
  v1.route('/', people);
  app.route('/v1', v1);

  app.notFound((c) => {
    const error = new ApiError('not_found', 'No endpoint of this API answers there.');
    return c.json(errorBody(error, c.get('requestId')), 404);
  });

  app.onError((caught, c) => {
    const error = fromUnknown(caught);
    for (const [key, value] of Object.entries(error.headers)) c.header(key, value);
    return c.json(errorBody(error, c.get('requestId')), error.status as 400);
  });

  return app;
}

/**
 * The console allowlist. An origin the browser did not send, or one that is not
 * on the list, gets a deliberate non-match rather than a wildcard — the browser
 * then refuses the response itself, which is the check doing its job.
 */
function consoleCors(
  allowed: readonly string[],
  origin: string | undefined,
): Record<string, string> {
  const match = origin && allowed.includes(origin) ? origin : 'null';
  return {
    'Access-Control-Allow-Origin': match,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '600',
  };
}
