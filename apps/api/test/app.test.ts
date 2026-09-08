/**
 * The service as a caller meets it: headers, refusals, and what a stranger can
 * reach without a token.
 *
 * Driven through the real Hono app with real `Request` objects, because most of
 * what is worth pinning here happens in middleware — an error envelope that
 * changed shape, a CORS header that turned permissive on the console surface, a
 * 401 that lost its `WWW-Authenticate` — and none of it is visible from the
 * route handlers. No database: everything below is refused, described or served
 * before any query would happen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';

const app = createApp();

function get(path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(new Request(`https://api.example.test${path}`, init));
}

beforeEach(() => {
  vi.stubEnv('WAVES_API_SUPABASE_URL', 'https://backend.example.test');
  vi.stubEnv('WAVES_API_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('WAVES_API_JWT_SECRET', 'jwt-secret');
  vi.stubEnv('WAVES_API_TOKEN_SECRET', 'token-secret');
  vi.stubEnv('WAVES_API_WEB_URL', 'https://app.example.test');
  vi.stubEnv('WAVES_API_ALLOWED_ORIGINS', 'https://app.example.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the shape of a refusal', () => {
  it('nests the error so it can never be mistaken for a resource', async () => {
    const response = await get('/v1/nothing-here');
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string; request_id: string } };
    expect(body.error.code).toBe('not_found');
    // Every response carries an id, and the same one is in the header, so a
    // developer reporting "this call failed" and a log line can be joined up.
    expect(body.error.request_id).toBe(response.headers.get('X-Request-Id'));
  });

  it('asks for a token when none was sent, in the way a client can act on', async () => {
    const response = await get('/v1/me');
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain('Bearer');
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
  });

  it('refuses a token that is not one of ours before it ever reaches the database', async () => {
    const response = await get('/v1/me', {
      headers: { Authorization: 'Bearer wavs_pat_obviously-not-signed' },
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_token');
    expect(response.headers.get('WWW-Authenticate')).toContain('invalid_token');
  });

  it('will not take a refresh token as an API credential', async () => {
    // A refresh token is a credential for the token endpoint and nothing else.
    // The database refuses it too; this is the cheaper half of the same rule.
    const { mintCredential, CredentialKind } = await import('../src/server/credentials');
    const refresh = mintCredential(
      'token-secret',
      CredentialKind.Refresh,
      '33333333-3333-4333-8333-333333333333',
    );
    const response = await get('/v1/me', {
      headers: { Authorization: `Bearer ${refresh.token}` },
    });
    expect(response.status).toBe(401);
  });
});

describe('cross-origin rules differ by surface, on purpose', () => {
  it('lets any page call the public API, because a header is the whole auth story', async () => {
    const response = await get('/v1/groups', {
      method: 'OPTIONS',
      headers: { Origin: 'https://somebody-elses-site.test' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    // No credentials header: a wildcard origin and cookies together would be a
    // browser error, and there is nothing here that wants a cookie anyway.
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('lets the console through only from an allowlisted origin', async () => {
    const allowed = await get('/developer/tokens', {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.example.test' },
    });
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.test');

    const stranger = await get('/developer/tokens', {
      method: 'OPTIONS',
      headers: { Origin: 'https://attacker.test' },
    });
    // Deliberately a non-match rather than an error: the browser then refuses
    // the response itself, which is the check doing its job.
    expect(stranger.headers.get('Access-Control-Allow-Origin')).toBe('null');
  });

  it('fails closed when no origins are configured', async () => {
    vi.stubEnv('WAVES_API_ALLOWED_ORIGINS', '');
    const response = await get('/developer/tokens', {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.example.test' },
    });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('null');
  });
});

describe('what a stranger can read', () => {
  it('describes the OAuth server at its own address, whatever that is', async () => {
    // Derived from the request rather than a constant, which is what lets a
    // self-host describe itself correctly with no configuration at all.
    const response = await get('/.well-known/oauth-authorization-server', {
      headers: { host: 'api.somebody-elses-waves.test' },
    });
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.issuer).toBe('https://api.somebody-elses-waves.test');
    expect(body.authorization_endpoint).toBe(
      'https://api.somebody-elses-waves.test/oauth/authorize',
    );
    // S256 only. `plain` is a challenge whose answer is in the request.
    expect(body.code_challenge_methods_supported).toEqual(['S256']);
  });

  it('honours an explicit public URL when a proxy hides the real one', async () => {
    vi.stubEnv('WAVES_API_PUBLIC_URL', 'https://api.configured.test/');
    const response = await get('/.well-known/oauth-authorization-server');
    const body = (await response.json()) as { issuer: string };
    expect(body.issuer).toBe('https://api.configured.test');
  });

  it('publishes the scope catalogue with the words a consent screen shows', async () => {
    const response = await get('/oauth/scopes');
    const body = (await response.json()) as { data: { scope: string; description: string }[] };
    const write = body.data.find((entry) => entry.scope === 'expenses.write');
    expect(write?.description).toMatch(/expenses/i);
    expect(body.data.some((entry) => entry.scope === 'offline_access')).toBe(true);
  });

  it('says which configuration is missing without saying what any of it is', async () => {
    vi.stubEnv('WAVES_API_TOKEN_SECRET', '');
    const response = await get('/health');
    const body = (await response.json()) as { status: string; missing: string[] };
    expect(body.status).toBe('misconfigured');
    expect(body.missing).toContain('WAVES_API_TOKEN_SECRET');
    // Names, never values.
    expect(JSON.stringify(body)).not.toContain('jwt-secret');
  });
});

describe('the OAuth authorize redirect', () => {
  it("sends the browser to this deployment's own consent screen, never the client's address", async () => {
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: 'wavs_app_00000000000000000000000000000000',
      redirect_uri: 'https://client.example.test/cb',
      scope: 'groups.read expenses.read',
      code_challenge_method: 'S256',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      state: 'xyz',
    });
    const response = await get(`/oauth/authorize?${query}`);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.origin).toBe('https://app.example.test');
    expect(location.pathname).toBe('/developers/authorize');
    expect(location.searchParams.get('state')).toBe('xyz');
  });

  it("answers a malformed request in RFC 6749's shape, not this API's", async () => {
    // An OAuth client library parses `error` as a string. Being internally
    // consistent here at the cost of being unusable would be the wrong trade.
    const response = await get('/oauth/authorize?response_type=token&client_id=x');
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; error_description: string };
    expect(typeof body.error).toBe('string');
    expect(body.error).toBe('invalid_request');
  });

  it('refuses a plain PKCE challenge outright', async () => {
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: 'wavs_app_00000000000000000000000000000000',
      redirect_uri: 'https://client.example.test/cb',
      scope: 'groups.read',
      code_challenge_method: 'plain',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    });
    const response = await get(`/oauth/authorize?${query}`);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_request');
  });

  it('refuses a scope the catalogue has never heard of instead of quietly dropping it', async () => {
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: 'wavs_app_00000000000000000000000000000000',
      redirect_uri: 'https://client.example.test/cb',
      scope: 'groups.read admin.everything',
      code_challenge_method: 'S256',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    });
    const response = await get(`/oauth/authorize?${query}`);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_scope');
  });

  it('says so plainly when no consent screen is configured', async () => {
    vi.stubEnv('WAVES_API_WEB_URL', '');
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: 'wavs_app_00000000000000000000000000000000',
      redirect_uri: 'https://client.example.test/cb',
      scope: 'groups.read',
      code_challenge_method: 'S256',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    });
    const response = await get(`/oauth/authorize?${query}`);
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error_description: string };
    expect(body.error_description).toContain('WAVES_API_WEB_URL');
  });
});

describe('the token endpoint', () => {
  it('refuses a grant type it does not implement', async () => {
    const response = await get('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=password&client_id=wavs_app_00000000000000000000000000000000',
    });
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('unsupported_grant_type');
  });

  it('never lets a token response be cached', async () => {
    const response = await get('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=password&client_id=wavs_app_00000000000000000000000000000000',
    });
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  it('refuses a code verifier too short to be worth challenging', async () => {
    const response = await get('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: 'wavs_app_00000000000000000000000000000000',
        code: 'wavs_ac_anything',
        redirect_uri: 'https://client.example.test/cb',
        code_verifier: 'short',
      }).toString(),
    });
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_request');
  });
});

describe('revocation', () => {
  it('answers the same way whether or not anything was revoked', async () => {
    // A different answer for "already dead" would turn this into an oracle for
    // checking whether a stolen string is still worth trying.
    const response = await get('/oauth/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'token=wavs_pat_not-a-real-one',
    });
    expect(response.status).toBe(200);
  });
});

describe('what the database says, and what a stranger is told about it', () => {
  it("turns a malformed id into the caller's mistake, not ours", async () => {
    // PostgREST raises 22P02 for `not-a-uuid`, which carries no `CODE:` prefix
    // and would otherwise be swallowed as an internal fault and answered 500 on
    // every id-taking route in the API.
    const { fromUnknown } = await import('../src/server/errors');
    const mapped = fromUnknown({ code: '22P02', message: 'invalid input syntax for type uuid' });
    expect(mapped.status).toBe(400);
    // And the database's own sentence does not travel: it names our columns.
    expect(mapped.message).not.toContain('uuid');
  });

  it("forwards a refusal the server chose to make, in the server's own words", async () => {
    const { fromUnknown } = await import('../src/server/errors');
    const mapped = fromUnknown(new Error('NOT_A_MEMBER: you are not a member of this group'));
    expect(mapped.status).toBe(403);
    expect(mapped.message).toBe('you are not a member of this group');
  });

  it('says nothing at all about a refusal it does not recognise', async () => {
    const { fromUnknown } = await import('../src/server/errors');
    const mapped = fromUnknown(new Error('relation "api_tokens" does not exist'));
    expect(mapped.status).toBe(500);
    expect(mapped.message).not.toContain('api_tokens');
  });
});

describe('rate-limit headers', () => {
  it('report the reset in seconds, the same unit as Retry-After', async () => {
    // Two units on one response is how a client ends up sleeping until 1970.
    const { rateHeaders } = await import('../src/server/authorize');
    const headers = rateHeaders({
      limit: 300,
      remaining: 12,
      resetAt: new Date(Date.now() + 30_000).toISOString(),
    });
    expect(Number(headers['RateLimit-Reset'])).toBeGreaterThan(25);
    expect(Number(headers['RateLimit-Reset'])).toBeLessThanOrEqual(30);
  });
});
