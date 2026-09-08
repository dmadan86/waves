/**
 * The surface the developer console talks to: keys, applications, and the list
 * of apps a person has connected.
 *
 * Authenticated differently from everything under `/v1`, and that is the point.
 * A caller here holds a *Waves session* — they are signed in to the web app —
 * not an API token, because a token that could mint tokens would make revocation
 * meaningless: whoever stole one could simply issue another. So the only way to
 * create or revoke a credential is to be the person, in a browser, with a
 * session GoTrue will vouch for.
 *
 * The secrets are minted here rather than in the browser, because the HMAC key
 * that signs them lives on this server and nowhere else. They are returned once,
 * in the response to the request that created them; the database gets a SHA-256
 * and there is no endpoint, anywhere, that can produce the plaintext again.
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';

import type { ApiEnv } from '../server/authorize';
import {
  CredentialKind,
  mintClientId,
  mintClientSecret,
  mintCredential,
} from '../server/credentials';
import { readConfig } from '../server/env';
import { ApiError } from '../server/errors';
import { jsonBody } from '../server/request';
import { SCOPES, SCOPE_SUMMARY, validScopeList } from '../server/scopes';
import { bearerOf, clientFor, profileFromSession } from '../server/session';

export const developer = new Hono<ApiEnv>();

const TOKEN_COLUMNS =
  'id, name, kind, token_prefix, scopes, expires_at, last_used_at, revoked_at, created_at, app_id';
const APP_COLUMNS =
  'id, name, description, website_url, client_id, client_secret_hash, redirect_uris, scopes, disabled_at, created_at';

/**
 * An application row as the console sees it.
 *
 * The stored hash never leaves — it is replaced by the one fact the screen
 * needs from it. Without `confidential` the console cannot tell a public client
 * from one with a secret, so it offers "rotate secret" on a mobile app and a
 * developer who clicks it out of curiosity has silently changed the client's
 * type with no way back.
 */
function toApp(row: Record<string, unknown>): Record<string, unknown> {
  const { client_secret_hash: hash, ...rest } = row;
  return { ...rest, confidential: hash !== null && hash !== undefined };
}

/**
 * `null` in a PATCH body means "clear this". The RPC reads null as "leave it
 * alone" — it has to, or omitting a field would wipe it — so an explicit null
 * is translated to the empty string it does treat as a clear. Without this
 * there is no way to remove a website once one has been set.
 */
function clearable(body: Record<string, unknown>, field: string): string | null {
  if (!(field in body)) return null;
  const value = body[field];
  if (value === null) return '';
  return typeof value === 'string' ? value : null;
}

/** Every route here needs the same two things. */
async function session(request: Request) {
  const config = readConfig();
  const token = bearerOf(request);
  if (!token) {
    throw new ApiError('unauthorized', 'Sign in to Waves first.', { 'WWW-Authenticate': 'Bearer' });
  }
  const { profileId } = await profileFromSession(config, token);
  return { config, profileId, supabase: clientFor(config, token) };
}

function readScopes(value: unknown): string[] {
  if (!Array.isArray(value) || !validScopeList(value)) {
    throw new ApiError(
      'invalid_request',
      'scopes is a non-empty list of known scopes, with no repeats.',
      {},
      { scopes: SCOPES.map((scope) => ({ scope, description: SCOPE_SUMMARY[scope] })) },
    );
  }
  return value;
}

function readRedirects(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10) {
    throw new ApiError('invalid_request', 'redirect_uris is a list of 1 to 10 addresses.');
  }
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new ApiError('invalid_request', 'Every redirect_uri is a non-empty string.');
    }
  }
  return (value as string[]).map((entry) => entry.trim());
}

// ─────────────────────────────────────────────────── personal tokens ──

developer.get('/developer/tokens', async (c) => {
  const { supabase, profileId } = await session(c.req.raw);
  // Revoked and expired rows are kept and returned by default: "this key was
  // live until Tuesday" is what somebody investigating needs, and the console
  // shows them tagged rather than actionable. `?state=live` is for a client that
  // only wants the ones that still work.
  const state = c.req.query('state') ?? 'all';
  if (state !== 'all' && state !== 'live') {
    throw new ApiError('invalid_request', 'state is "all" or "live".', {}, { parameter: 'state' });
  }

  let query = supabase
    .from('api_tokens')
    .select(TOKEN_COLUMNS)
    .eq('profile_id', profileId)
    .eq('kind', 'personal')
    .order('created_at', { ascending: false });
  if (state === 'live') {
    query = query
      .is('revoked_at', null)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return c.json({ data: data ?? [] });
});

developer.post('/developer/tokens', async (c) => {
  const { config, profileId, supabase } = await session(c.req.raw);
  const body = await jsonBody(c.req.raw);
  const scopes = readScopes(body.scopes);

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw new ApiError('invalid_request', 'Give the token a name you will recognise.');

  let days: number | null = null;
  if (body.expires_in_days !== undefined && body.expires_in_days !== null) {
    if (!Number.isInteger(body.expires_in_days) || (body.expires_in_days as number) < 1) {
      throw new ApiError('invalid_request', 'expires_in_days is a whole number of days.');
    }
    days = body.expires_in_days as number;
  }

  if (!config.tokenSecret) {
    throw new ApiError(
      'misconfigured',
      'This deployment cannot issue tokens. Set WAVES_API_TOKEN_SECRET.',
    );
  }

  const credential = mintCredential(config.tokenSecret, CredentialKind.Personal, profileId);
  const { data, error } = await supabase.rpc('waves_api_create_token', {
    p_token_id: credential.id,
    p_name: name,
    p_token_hash: credential.hash,
    p_token_prefix: credential.prefix,
    p_scopes: scopes,
    p_days: days,
  });
  if (error) throw error;

  const result = data as { expiresAt: string } | null;
  c.status(201);
  return c.json(
    {
      id: credential.id,
      name,
      scopes,
      token_prefix: credential.prefix,
      expires_at: result?.expiresAt ?? null,
      // The only time this value exists anywhere. The row holds a SHA-256, so
      // there is no second chance and the console has to say so.
      token: credential.token,
    },
    201,
    { 'Cache-Control': 'no-store' },
  );
});

developer.delete('/developer/tokens/:tokenId', async (c) => {
  const { supabase } = await session(c.req.raw);
  const { data, error } = await supabase.rpc('waves_api_revoke_token', {
    p_token_id: c.req.param('tokenId'),
  });
  if (error) throw error;
  if (data !== true) throw new ApiError('not_found', 'No live token of yours has that id.');
  c.status(204);
  return c.body(null);
});

// ──────────────────────────────────────────────────────── applications ──

developer.get('/developer/apps', async (c) => {
  const { supabase, profileId } = await session(c.req.raw);
  const { data, error } = await supabase
    .from('api_apps')
    .select(APP_COLUMNS)
    .eq('owner_profile_id', profileId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return c.json({ data: (data ?? []).map((row) => toApp(row as Record<string, unknown>)) });
});

developer.post('/developer/apps', async (c) => {
  const { supabase } = await session(c.req.raw);
  const body = await jsonBody(c.req.raw);

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw new ApiError('invalid_request', 'Give the application a name.');
  const scopes = readScopes(body.scopes);
  const redirectUris = readRedirects(body.redirect_uris);

  // A confidential client is one that can actually keep a secret — a server. A
  // mobile or single-page app cannot, and asking it to pretend produces a secret
  // published in an app bundle, so the console offers the choice rather than
  // defaulting to the one that looks more secure.
  const confidential = body.confidential !== false;
  const secret = confidential ? mintClientSecret() : null;

  const appId = randomUUID();
  const clientId = mintClientId();
  const { error } = await supabase.rpc('waves_api_register_app', {
    p_app_id: appId,
    p_name: name,
    p_description: typeof body.description === 'string' ? body.description : '',
    p_website_url: typeof body.website_url === 'string' ? body.website_url : null,
    p_redirect_uris: redirectUris,
    p_scopes: scopes,
    p_client_id: clientId,
    p_client_secret_hash: secret?.hash ?? null,
  });
  if (error) throw error;

  return c.json(
    {
      id: appId,
      name,
      client_id: clientId,
      redirect_uris: redirectUris,
      scopes,
      // Shown once, like a token. Rotating is a separate, deliberate call.
      ...(secret ? { client_secret: secret.secret } : {}),
    },
    201,
    { 'Cache-Control': 'no-store' },
  );
});

developer.patch('/developer/apps/:appId', async (c) => {
  const { supabase } = await session(c.req.raw);
  const body = await jsonBody(c.req.raw);

  const { error } = await supabase.rpc('waves_api_update_app', {
    p_app_id: c.req.param('appId'),
    p_name: typeof body.name === 'string' ? body.name : null,
    p_website_url: clearable(body, 'website_url'),
    p_description: clearable(body, 'description'),
    p_redirect_uris: body.redirect_uris === undefined ? null : readRedirects(body.redirect_uris),
    p_scopes: body.scopes === undefined ? null : readScopes(body.scopes),
    // Never rotated as a side effect of another edit: "leave it alone" and
    // "make this a public client" would otherwise share the value null.
    p_client_secret_hash: null,
    p_disabled: typeof body.disabled === 'boolean' ? body.disabled : null,
  });
  if (error) throw error;

  const { data } = await supabase
    .from('api_apps')
    .select(APP_COLUMNS)
    .eq('id', c.req.param('appId'))
    .limit(1);
  const row = (data ?? [])[0];
  if (!row) throw new ApiError('not_found', 'No application of yours has that id.');
  return c.json(toApp(row as Record<string, unknown>));
});

/**
 * Rotate a client secret.
 *
 * On a client that has one, this is a rotation. On a public client it is a
 * *conversion* — it becomes confidential and every deployed copy that
 * authenticated with PKCE alone starts failing — so that has to be asked for
 * explicitly rather than happening because somebody pressed a button labelled
 * "new secret".
 */
developer.post('/developer/apps/:appId/secret', async (c) => {
  const { config, supabase } = await session(c.req.raw);
  const existing = await supabase
    .from('api_apps')
    .select('client_secret_hash')
    .eq('id', c.req.param('appId'))
    .limit(1);
  if (existing.error) throw existing.error;
  const current = (existing.data ?? [])[0];
  if (!current) throw new ApiError('not_found', 'No application of yours has that id.');
  if (current.client_secret_hash === null && c.req.query('convert') !== 'true') {
    throw new ApiError(
      'unprocessable',
      'This is a public client. Giving it a secret changes its type and breaks every copy already installed — pass ?convert=true if that is what you mean.',
    );
  }
  if (!config.tokenSecret) {
    throw new ApiError(
      'misconfigured',
      'This deployment cannot issue secrets. Set WAVES_API_TOKEN_SECRET.',
    );
  }
  const secret = mintClientSecret();
  const { error } = await supabase.rpc('waves_api_update_app', {
    p_app_id: c.req.param('appId'),
    p_name: null,
    p_description: null,
    p_website_url: null,
    p_redirect_uris: null,
    p_scopes: null,
    p_client_secret_hash: secret.hash,
    p_disabled: null,
  });
  if (error) throw error;
  return c.json({ client_secret: secret.secret }, 200, { 'Cache-Control': 'no-store' });
});

developer.delete('/developer/apps/:appId', async (c) => {
  const { supabase } = await session(c.req.raw);
  const { error } = await supabase.rpc('waves_api_delete_app', {
    p_app_id: c.req.param('appId'),
  });
  if (error) throw error;
  c.status(204);
  return c.body(null);
});

// ───────────────────────────────────────── what this person has connected ──

developer.get('/developer/connections', async (c) => {
  const { supabase } = await session(c.req.raw);
  const { data, error } = await supabase.rpc('waves_api_connected_apps');
  if (error) throw error;
  return c.json({ data: data ?? [] });
});

developer.delete('/developer/connections/:appId', async (c) => {
  const { supabase } = await session(c.req.raw);
  // Withdrawing access is not the same as deleting the application: the person
  // doing it is usually not the developer who owns it.
  const { data, error } = await supabase.rpc('waves_api_revoke_app_access', {
    p_app_id: c.req.param('appId'),
  });
  if (error) throw error;
  return c.json({ revoked: Number(data ?? 0) });
});

/**
 * What the consent screen needs to render, checked against the registration.
 *
 * A GET so the browser can ask before showing anything, and it deliberately
 * refuses — rather than rendering with a warning — when the redirect is not one
 * the application registered. A consent screen that displayed an unregistered
 * address would be teaching people to approve a delivery the developer never
 * asked for.
 */
developer.get('/developer/consent', async (c) => {
  const { supabase } = await session(c.req.raw);
  const clientId = c.req.query('client_id');
  const redirectUri = c.req.query('redirect_uri');
  const scope = c.req.query('scope');
  if (!clientId || !redirectUri || !scope) {
    throw new ApiError('invalid_request', 'client_id, redirect_uri and scope are all required.');
  }
  const scopes = scope.split(/[\s+]+/).filter(Boolean);

  const { data, error } = await supabase.rpc('waves_api_consent_preview', {
    p_client_id: clientId,
    p_redirect_uri: redirectUri,
    p_scopes: scopes,
  });
  if (error) throw error;

  const preview = data as Record<string, unknown> | null;
  if (!preview) throw new ApiError('not_found', 'No application has that client id.');
  // Renamed rather than spread. The RPC hands back camelCase jsonb, and passing
  // it through untouched would put `appId` and `websiteUrl` beside
  // `scope_descriptions` in an API whose whole surface is snake_case.
  return c.json({
    app_id: preview.appId,
    name: preview.name,
    description: preview.description,
    website_url: preview.websiteUrl,
    owner_name: preview.ownerName,
    scopes,
    // The words a person reads, resolved here so the screen never has to invent
    // a description for a scope it has not heard of.
    scope_descriptions: scopes.map((entry) => ({
      scope: entry,
      description: SCOPE_SUMMARY[entry as (typeof SCOPES)[number]] ?? entry,
    })),
  });
});
