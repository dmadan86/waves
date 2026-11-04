/**
 * Company two-step login: what the three two-step functions share.
 *
 * Secrets are AES-256-GCM encrypted with `TWO_STEP_KEY` (base64, 32 bytes) before they touch the database, and only
 * this code decrypts them. Every code check ends in `waves_two_step_attempt`, which does the replay, lockout and
 * session mark atomically under a row lock; this file only works out which secret and step a code matches.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import {
  APP_CHECK_JWKS_URL,
  base32Encode,
  matchTotp,
  TOTP_SECRET_BYTES,
  verifyAppCheckToken,
  type FirebaseJwk,
} from './core.js';
import { HttpError } from './auth.ts';

export interface TwoStepDeps {
  asCaller: (request: Request) => SupabaseClient;
  asService: () => SupabaseClient;
  env: (name: string) => string | undefined;
  fetchImpl: typeof fetch;
  now: () => number;
  /** Counts this call (fail closed); `enforceRateLimit` with the `two-step` bucket in production. */
  rateLimit: (service: SupabaseClient, request: Request, profileId: string) => Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The caller, and the GoTrue session the mark belongs to. No session id, no two-step: fail closed. */
export async function callerSession(
  deps: TwoStepDeps,
  request: Request,
): Promise<{ caller: SupabaseClient; profileId: string; sessionId: string; email: string | null }> {
  const caller = deps.asCaller(request);
  const { data, error } = await caller.auth.getUser();
  if (error || !data?.user) throw new HttpError(401, 'NOT_AUTHENTICATED', 'Sign in first');
  let sessionId: unknown;
  try {
    // Signature already checked by auth.getUser() above.
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const b64 = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    sessionId = JSON.parse(atob(b64)).session_id;
  } catch {
    sessionId = undefined;
  }
  if (typeof sessionId !== 'string' || !UUID.test(sessionId)) {
    throw new HttpError(401, 'NO_SESSION', 'Sign in again to use two-step login');
  }
  return {
    caller,
    profileId: data.user.id as string,
    sessionId,
    email:
      (data.user.email as string | undefined) ?? (data.user.phone as string | undefined) ?? null,
  };
}

// ─────────────────────────────────────────────────────────── secrets ──

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s);
}

function unb64(text: string): Uint8Array {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function buffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function key(env: TwoStepDeps['env']): Promise<CryptoKey> {
  const raw = env('TWO_STEP_KEY');
  let bytes: Uint8Array | null = null;
  try {
    bytes = raw ? unb64(raw) : null;
  } catch {
    bytes = null;
  }
  if (!bytes || bytes.length !== 32)
    throw new HttpError(500, 'MISCONFIGURED', 'TWO_STEP_KEY is not set');
  return crypto.subtle.importKey('raw', buffer(bytes), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** base64(iv || ciphertext+tag). */
export async function sealSecret(env: TwoStepDeps['env'], secret: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), buffer(secret)),
  );
  const out = new Uint8Array(12 + sealed.length);
  out.set(iv);
  out.set(sealed, 12);
  return b64(out);
}

export async function openSecret(
  env: TwoStepDeps['env'],
  sealed: string,
): Promise<Uint8Array | null> {
  const k = await key(env);
  try {
    const bytes = unb64(sealed);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buffer(bytes.slice(0, 12)) },
      k,
      buffer(bytes.slice(12)),
    );
    return new Uint8Array(plain);
  } catch {
    // Tampered or sealed under another key: it proves nothing.
    return null;
  }
}

export function newSecret(): { bytes: Uint8Array; base32: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(TOTP_SECRET_BYTES));
  return { bytes, base32: base32Encode(bytes) };
}

export interface SecretRow {
  id: string;
  kind: 'phone' | 'authenticator';
  device_id: string | null;
  secret_enc: string;
  active: boolean;
  created_at: string;
}

export async function loadSecrets(
  service: SupabaseClient,
  profileId: string,
): Promise<SecretRow[]> {
  const { data, error } = await service
    .from('two_step_secrets')
    .select('id, kind, device_id, secret_enc, active, created_at')
    .eq('profile_id', profileId);
  if (error) throw new HttpError(500, 'INTERNAL', error.message);
  return (data ?? []) as SecretRow[];
}

export async function sessionMarked(
  service: SupabaseClient,
  profileId: string,
  sessionId: string,
): Promise<boolean> {
  const { data, error } = await service
    .from('two_step_sessions')
    .select('session_id')
    .eq('session_id', sessionId)
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error) throw new HttpError(500, 'INTERNAL', error.message);
  return Boolean(data);
}

/**
 * Check a typed code against `candidates` and record the attempt atomically. Every attempt goes to the database, a
 * miss included, so failures count toward the lock even when nothing matched.
 */
export async function attemptCode(
  deps: TwoStepDeps,
  service: SupabaseClient,
  args: {
    profileId: string;
    sessionId: string;
    kind: 'phone' | 'web';
    deviceId: string | null;
    code: string;
    candidates: SecretRow[];
    activate?: boolean;
  },
): Promise<'ok' | 'BAD_CODE' | 'LOCKED'> {
  let secretId: string | null = null;
  let step: number | null = null;
  for (const row of args.candidates) {
    const secret = await openSecret(deps.env, row.secret_enc);
    if (!secret) continue;
    const matched = matchTotp(secret, args.code, deps.now());
    if (matched !== null && secretId === null) {
      secretId = row.id;
      step = matched;
    }
  }
  const { data, error } = await service.rpc('waves_two_step_attempt', {
    p_profile: args.profileId,
    p_secret_id: secretId,
    p_step: step,
    p_session: args.sessionId,
    p_kind: args.kind,
    p_device: args.deviceId,
    p_activate: args.activate ?? false,
  });
  if (error) throw new HttpError(500, 'INTERNAL', error.message);
  const result = data as { ok: boolean; reason?: string };
  if (result.ok) return 'ok';
  return result.reason === 'LOCKED' ? 'LOCKED' : 'BAD_CODE';
}

export function codeRefusal(outcome: 'BAD_CODE' | 'LOCKED'): HttpError {
  return outcome === 'LOCKED'
    ? new HttpError(423, 'LOCKED', 'Too many wrong codes. Try again in 15 minutes.')
    : new HttpError(
        400,
        'BAD_CODE',
        'That code is not right. Check the newest code and try again.',
      );
}

export function readCode(value: unknown): string {
  if (typeof value !== 'string' || !/^\s*\d{3}\s?\d{3}\s*$/.test(value)) {
    throw new HttpError(400, 'BAD_CODE', 'Enter the 6-digit code');
  }
  return value.replace(/\s/g, '');
}

// ──────────────────────────────────────────────────────────── App Check ──

let cachedKeys: { keys: FirebaseJwk[]; until: number } | null = null;

/** Test seam. */
export function forgetAppCheckKeys(): void {
  cachedKeys = null;
}

async function appCheckKeys(deps: TwoStepDeps): Promise<FirebaseJwk[]> {
  const now = Math.floor(deps.now() / 1000);
  if (cachedKeys && cachedKeys.until > now) return cachedKeys.keys;
  const response = await deps.fetchImpl(APP_CHECK_JWKS_URL);
  if (!response.ok)
    throw new HttpError(503, 'APP_CHECK_UNAVAILABLE', 'Please try again in a moment.');
  const body = (await response.json()) as { keys?: FirebaseJwk[] };
  if (!Array.isArray(body.keys))
    throw new HttpError(503, 'APP_CHECK_UNAVAILABLE', 'Please try again in a moment.');
  // Google publishes these for 6 hours; refetch hourly.
  cachedKeys = { keys: body.keys, until: now + 3600 };
  return body.keys;
}

function required(env: TwoStepDeps['env'], name: string): string {
  const value = env(name);
  if (!value) throw new HttpError(500, 'MISCONFIGURED', `${name} is not set`);
  return value;
}

function pemToBytes(pem: string): Uint8Array {
  return unb64(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''));
}

function b64url(bytes: Uint8Array): string {
  return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** An OAuth access token for the Firebase service account (JWT bearer grant). */
async function googleAccessToken(deps: TwoStepDeps): Promise<string> {
  let account: { client_email?: string; private_key?: string };
  try {
    account = JSON.parse(required(deps.env, 'FIREBASE_SERVICE_ACCOUNT')) as typeof account;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, 'MISCONFIGURED', 'FIREBASE_SERVICE_ACCOUNT is not JSON');
  }
  if (!account.client_email || !account.private_key) {
    throw new HttpError(500, 'MISCONFIGURED', 'FIREBASE_SERVICE_ACCOUNT is incomplete');
  }
  const now = Math.floor(deps.now() / 1000);
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64url(
    enc.encode(
      JSON.stringify({
        iss: account.client_email,
        scope:
          'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 600,
      }),
    ),
  );
  const signingKey = await crypto.subtle.importKey(
    'pkcs8',
    buffer(pemToBytes(account.private_key)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      signingKey,
      buffer(enc.encode(`${header}.${claims}`)),
    ),
  );
  const response = await deps.fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${header}.${claims}.${b64url(signature)}`,
  });
  const body = (await response.json().catch(() => ({}))) as { access_token?: string };
  if (!response.ok || !body.access_token) {
    throw new HttpError(503, 'APP_CHECK_UNAVAILABLE', 'Please try again in a moment.');
  }
  return body.access_token;
}

/**
 * The request comes from our genuine app: a limited-use App Check token, signature and claims checked locally, then
 * consumed at Firebase so it can never be replayed. Any doubt is a refusal (fail closed).
 */
export async function requireAppCheck(deps: TwoStepDeps, request: Request): Promise<void> {
  const token = request.headers.get('x-firebase-appcheck');
  const refuse = () =>
    new HttpError(401, 'APP_CHECK_FAILED', 'Update Waves to use two-step login on this phone');
  if (!token) throw refuse();
  const projectNumber = required(deps.env, 'FIREBASE_PROJECT_NUMBER');
  const appIds = required(deps.env, 'FIREBASE_APP_IDS')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const verdict = await verifyAppCheckToken({
    token,
    keys: await appCheckKeys(deps),
    projectNumber,
    appIds,
    now: Math.floor(deps.now() / 1000),
  });
  if (!verdict.ok) {
    console.warn('app check refused:', verdict.reason);
    throw refuse();
  }
  const projectId = required(deps.env, 'FIREBASE_PROJECT_ID');
  const access = await googleAccessToken(deps);
  const response = await deps.fetchImpl(
    `https://firebaseappcheck.googleapis.com/v1beta/projects/${encodeURIComponent(projectId)}:verifyAppCheckToken`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      body: JSON.stringify({ app_check_token: token }),
    },
  );
  if (!response.ok) {
    if (response.status >= 500)
      throw new HttpError(503, 'APP_CHECK_UNAVAILABLE', 'Please try again in a moment.');
    throw refuse();
  }
  const body = (await response.json().catch(() => null)) as { alreadyConsumed?: unknown } | null;
  // Absent means not consumed before (as the Admin SDK reads it); anything but false is a replay.
  if (!body || (body.alreadyConsumed ?? false) !== false) {
    console.warn('app check token replayed');
    throw refuse();
  }
}
