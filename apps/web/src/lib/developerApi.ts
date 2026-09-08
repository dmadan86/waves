/**
 * The developer console's line to the public API.
 *
 * Everything else in this app talks to Supabase directly through
 * `@waves/api-client`; this does not, because `apps/api` is a separate service
 * on its own host. What crosses that boundary is the reader's *own* Supabase
 * session token — the same one the rest of the page is already using — because
 * a credential that could mint credentials would make revocation theatre:
 * whoever stole one could simply issue another. So every call here is "the
 * person, in a browser, with a session GoTrue will vouch for".
 *
 * Two rules the pages depend on:
 *
 * **A refusal keeps its sentence.** The API answers `{"error": {code, message,
 * request_id}}`, and OAuth's own endpoints answer RFC 6749's flatter
 * `{"error": "invalid_grant", "error_description": …}`. Both are unpacked into
 * a `DeveloperApiError`, whose `message` is the server's own words about the
 * caller's own request. The pages hand that to `friendlyError` as the
 * *fallback*, so it is still Sentry-logged and still replaced wholesale when
 * the real fault was the network — and an exception that is not one of ours
 * carries no sentence at all, so nothing internal can reach the page.
 *
 * **The address is optional.** A deployment without `NEXT_PUBLIC_WAVES_API_URL`
 * has no developer API, and that is a sentence to render rather than a crash to
 * survive: `apiBase()` returns null and the pages say so plainly.
 */

// ─────────────────────────────────────────────────────────── the shapes ──

/** A personal access token, as `GET /developer/tokens` lists it. */
export interface DeveloperToken {
  id: string;
  name: string;
  kind: string;
  token_prefix: string;
  scopes: string[];
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  app_id: string | null;
}

/** The answer to `POST /developer/tokens` — the one place `token` ever exists. */
export interface CreatedToken {
  id: string;
  name: string;
  scopes: string[];
  token_prefix: string;
  expires_at: string | null;
  token: string;
}

/** A registered application, as `GET /developer/apps` lists it. */
export interface DeveloperApp {
  id: string;
  name: string;
  description: string | null;
  website_url: string | null;
  client_id: string;
  redirect_uris: string[];
  scopes: string[];
  disabled_at: string | null;
  created_at: string;
  /**
   * Whether this client can keep a secret. Derived by the API from the presence
   * of a hash (never the hash itself), and optional here on purpose: a
   * deployment older than that field sends nothing, and the console treats
   * "did not say" as "do not know" rather than as "public".
   */
  confidential?: boolean;
}

/** The answer to `POST /developer/apps`. `client_secret` only for a confidential client. */
export interface CreatedApp {
  id: string;
  name: string;
  client_id: string;
  redirect_uris: string[];
  scopes: string[];
  client_secret?: string;
}

/** One row of `waves_api_connected_apps` — an app acting for the reader. */
export interface Connection {
  app_id: string;
  name: string;
  description: string | null;
  website_url: string | null;
  scopes: string[] | null;
  connected_at: string | null;
  last_used_at: string | null;
}

export interface ScopeInfo {
  scope: string;
  description: string;
}

/** What `GET /developer/consent` hands the consent screen. */
export interface ConsentPreview {
  appId: string;
  name: string;
  description: string | null;
  websiteUrl: string | null;
  ownerName: string | null;
  scopes: string[];
  scope_descriptions: ScopeInfo[];
}

/** The parameters an authorization request carries through the browser. */
export interface ConsentRequest {
  clientId: string;
  redirectUri: string;
  /** The space-separated original, sent back to the server verbatim. */
  scope: string;
  scopes: string[];
  codeChallenge: string;
  state: string | null;
}

// ─────────────────────────────────────────────────────────── the refusal ──

export class DeveloperApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = 'DeveloperApiError';
  }
}

/**
 * The server's sentence, when there is one, and nothing otherwise.
 *
 * A page uses this as `friendlyError`'s fallback: the API writes its refusals
 * for the person who caused them ("that redirect address is not registered for
 * this application"), which is more use than "something went wrong". Anything
 * that is not one of our own errors — a TypeError, a parse failure, a thrown
 * string — returns undefined and the caller's translated fallback stands.
 */
export function serverSentence(caught: unknown): string | undefined {
  if (!(caught instanceof DeveloperApiError)) return undefined;
  const sentence = caught.message.trim();
  return sentence ? sentence : undefined;
}

/** True when the failure was "this deployment has no developer API". */
export function isUnconfigured(caught: unknown): boolean {
  return caught instanceof DeveloperApiError && caught.code === 'unconfigured';
}

/**
 * True when the fix is "sign in again" rather than anything about the request.
 *
 * Three codes mean the same thing from three surfaces: `unauthorized` and
 * `invalid_token` from `/developer/*`, and `invalid_grant` from
 * `POST /oauth/authorize`, which maps a stale session onto RFC 6749's
 * vocabulary rather than flattening it into `invalid_request`. Telling this
 * apart matters most on the consent screen, where "your session expired" and
 * "this application is not allowed to ask for that" would otherwise read as the
 * same refusal.
 */
export function isSignedOut(caught: unknown): boolean {
  if (!(caught instanceof DeveloperApiError)) return false;
  return (
    caught.code === 'unauthorized' ||
    caught.code === 'invalid_token' ||
    caught.code === 'invalid_grant'
  );
}

// ─────────────────────────────────────────────────────────── pure parts ──

/**
 * Where the API lives, with any trailing slash taken off so `${base}/developer`
 * never doubles it. Null means "not configured", which is a state the pages
 * render rather than an error they throw.
 */
export function apiBase(
  raw: string | undefined = process.env.NEXT_PUBLIC_WAVES_API_URL,
): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '');
}

/** Both error shapes this service speaks, reduced to one. */
export function messageFromBody(
  body: unknown,
): { code: string; message: string; requestId: string | null } | null {
  if (!body || typeof body !== 'object') return null;
  const error = (body as { error?: unknown }).error;

  // RFC 6749: `error` is a bare string and the sentence sits beside it.
  if (typeof error === 'string') {
    const description = (body as { error_description?: unknown }).error_description;
    return {
      code: error,
      message: typeof description === 'string' ? description : '',
      requestId: null,
    };
  }

  if (error && typeof error === 'object') {
    const detail = error as { code?: unknown; message?: unknown; request_id?: unknown };
    return {
      code: typeof detail.code === 'string' ? detail.code : 'internal',
      message: typeof detail.message === 'string' ? detail.message : '',
      requestId: typeof detail.request_id === 'string' ? detail.request_id : null,
    };
  }
  return null;
}

/**
 * A textarea of redirect addresses into the list the API wants: one per line,
 * blanks dropped, duplicates collapsed. Order is kept, because the first entry
 * is the one a developer reads as "the" address.
 */
export function splitRedirectUris(text: string): string[] {
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

/**
 * The authorization request, read off the URL the API redirected the browser
 * to.
 *
 * Null when anything is missing or the challenge is not a 43-character
 * base64url digest — the same test `readAuthorizeParams` applies on the server.
 * Checking it here is not a security boundary (the server's check is), it just
 * stops the page offering an Approve button that could only ever fail.
 */
export function readConsentQuery(params: URLSearchParams): ConsentRequest | null {
  const get = (name: string): string | null => {
    const value = params.get(name);
    return value && value.trim() ? value.trim() : null;
  };

  const clientId = get('client_id');
  const redirectUri = get('redirect_uri');
  const scope = get('scope');
  const codeChallenge = get('code_challenge');
  if (!clientId || !redirectUri || !scope || !codeChallenge) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) return null;

  const scopes = scope.split(/[\s+]+/).filter(Boolean);
  if (scopes.length === 0) return null;

  return { clientId, redirectUri, scope, scopes, codeChallenge, state: get('state') };
}

/**
 * A timestamp as a date somebody can read, in their own locale. Empty for null,
 * so a caller can choose "never used" rather than printing a blank.
 */
export function formatDay(locale: string, iso: string | null | undefined): string {
  if (!iso) return '';
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(when);
  } catch {
    // A malformed locale from a header we did not write is not worth a blank page.
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(when);
  }
}

/** Has this token stopped working, and why. */
export function tokenState(
  token: Pick<DeveloperToken, 'revoked_at' | 'expires_at'>,
  now: Date = new Date(),
): 'live' | 'revoked' | 'expired' {
  if (token.revoked_at) return 'revoked';
  if (token.expires_at && new Date(token.expires_at).getTime() <= now.getTime()) return 'expired';
  return 'live';
}

// ───────────────────────────────────────────────────────────── the wire ──

/**
 * The reader's session token, from a client imported at call time rather than
 * at module load.
 *
 * `lib/waves` constructs the Supabase client as a side effect of being imported
 * and throws outright when the public env vars are missing. The parsing above —
 * which is what the tests and the two pages lean on hardest — has no business
 * needing a configured backend just to be read.
 */
async function accessTokenOf(): Promise<string | null> {
  const { supabase } = await import('@/lib/waves');
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = apiBase();
  if (!base) throw new DeveloperApiError('unconfigured', '', 0, null);

  const accessToken = await accessTokenOf();
  if (!accessToken) throw new DeveloperApiError('unauthorized', '', 401, null);

  const response = await fetch(`${base}${path}`, {
    ...init,
    // Nothing here is cacheable: half of it is a credential and the other half
    // is the list of credentials.
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 204) return undefined as T;

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const found = messageFromBody(body);
    throw new DeveloperApiError(
      found?.code ?? 'internal',
      found?.message ?? '',
      response.status,
      found?.requestId ?? null,
    );
  }
  return body as T;
}

const rows = <T>(body: { data?: T[] | null }): T[] => body?.data ?? [];

// ────────────────────────────────────────────────────────────── tokens ──

export async function listTokens(): Promise<DeveloperToken[]> {
  return rows(await request<{ data: DeveloperToken[] }>('/developer/tokens'));
}

export async function createToken(input: {
  name: string;
  scopes: string[];
  expiresInDays?: number | null;
}): Promise<CreatedToken> {
  return request<CreatedToken>('/developer/tokens', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      scopes: input.scopes,
      // Omitted rather than null when there is no expiry: the server reads
      // "absent" and "null" the same way, and absent is the honest one.
      ...(input.expiresInDays ? { expires_in_days: input.expiresInDays } : {}),
    }),
  });
}

export async function revokeToken(tokenId: string): Promise<void> {
  await request<void>(`/developer/tokens/${encodeURIComponent(tokenId)}`, { method: 'DELETE' });
}

// ──────────────────────────────────────────────────────────────── apps ──

export async function listApps(): Promise<DeveloperApp[]> {
  return rows(await request<{ data: DeveloperApp[] }>('/developer/apps'));
}

export async function createApp(input: {
  name: string;
  description: string;
  websiteUrl: string | null;
  redirectUris: string[];
  scopes: string[];
  confidential: boolean;
}): Promise<CreatedApp> {
  return request<CreatedApp>('/developer/apps', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      description: input.description,
      website_url: input.websiteUrl,
      redirect_uris: input.redirectUris,
      scopes: input.scopes,
      confidential: input.confidential,
    }),
  });
}

/** Only what is passed is changed; the secret is never rotated as a side effect. */
export async function updateApp(
  appId: string,
  patch: { disabled?: boolean },
): Promise<DeveloperApp> {
  return request<DeveloperApp>(`/developer/apps/${encodeURIComponent(appId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function rotateSecret(appId: string): Promise<{ client_secret: string }> {
  return request<{ client_secret: string }>(`/developer/apps/${encodeURIComponent(appId)}/secret`, {
    method: 'POST',
  });
}

export async function deleteApp(appId: string): Promise<void> {
  await request<void>(`/developer/apps/${encodeURIComponent(appId)}`, { method: 'DELETE' });
}

// ───────────────────────────────────────────────────────── connections ──

export async function listConnections(): Promise<Connection[]> {
  return rows(await request<{ data: Connection[] }>('/developer/connections'));
}

export async function disconnect(appId: string): Promise<number> {
  const body = await request<{ revoked: number }>(
    `/developer/connections/${encodeURIComponent(appId)}`,
    { method: 'DELETE' },
  );
  return body?.revoked ?? 0;
}

// ───────────────────────────────────────────────────────────── consent ──

/** The scope catalogue the server actually enforces, in its own words. */
export async function listScopes(): Promise<ScopeInfo[]> {
  return rows(await request<{ data: ScopeInfo[] }>('/oauth/scopes'));
}

/**
 * What the consent screen may show, checked against the registration.
 *
 * A failure here is the answer, not a hiccup: an unregistered redirect, an
 * unknown client or an over-wide scope all land in this call, and the screen
 * must refuse rather than render with a warning.
 */
export async function consentPreview(consent: ConsentRequest): Promise<ConsentPreview> {
  const query = new URLSearchParams({
    client_id: consent.clientId,
    redirect_uri: consent.redirectUri,
    scope: consent.scope,
  });
  return request<ConsentPreview>(`/developer/consent?${query.toString()}`);
}

/**
 * Say yes, on behalf of the person looking at the screen.
 *
 * The reply is the address to go to — built by the server from the redirect its
 * own RPC has just re-confirmed is registered, which is why the page navigates
 * to it and never to anything it read off its own URL.
 */
export async function approve(consent: ConsentRequest): Promise<string> {
  const body = await request<{ redirect_to: string }>('/oauth/authorize', {
    method: 'POST',
    body: JSON.stringify({
      response_type: 'code',
      client_id: consent.clientId,
      redirect_uri: consent.redirectUri,
      scope: consent.scope,
      code_challenge_method: 'S256',
      code_challenge: consent.codeChallenge,
      ...(consent.state ? { state: consent.state } : {}),
    }),
  });
  return body.redirect_to;
}
