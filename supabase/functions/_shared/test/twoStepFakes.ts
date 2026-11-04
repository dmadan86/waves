/**
 * In-memory stand-ins for the two-step handlers: a caller client, a service client whose tables and RPCs behave like
 * the migration's (replay by last_step, 10-miss lock), and App Check tokens signed with a local RSA key.
 */

import { vi } from 'vitest';

import type { TwoStepDeps } from '../twoStep.ts';

export const PROFILE = '11111111-1111-4111-8111-111111111111';
export const SESSION = '22222222-2222-4222-8222-222222222222';
export const PROJECT_NUMBER = '123456789';
export const APP_ID = '1:123456789:android:abc';

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const enc = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

export function bearer(
  claims: Record<string, unknown> = { session_id: SESSION, sub: PROFILE },
): string {
  return `Bearer ${enc({ alg: 'HS256' })}.${enc(claims)}.sig`;
}

export async function rsaKey(kid = 'k1') {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as { n: string; e: string };
  return {
    jwk: { kid, kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', use: 'sig' },
    sign: async (claims: Record<string, unknown>, header: Record<string, unknown> = {}) => {
      const head = enc({ alg: 'RS256', typ: 'JWT', kid, ...header });
      const body = enc(claims);
      const sig = new Uint8Array(
        await crypto.subtle.sign(
          'RSASSA-PKCS1-v1_5',
          pair.privateKey,
          new TextEncoder().encode(`${head}.${body}`),
        ),
      );
      return `${head}.${body}.${b64url(sig)}`;
    },
    privatePem: async () => {
      const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
      return `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`;
    },
  };
}

export function appCheckClaims(nowSeconds: number, overrides: Record<string, unknown> = {}) {
  return {
    iss: `https://firebaseappcheck.googleapis.com/${PROJECT_NUMBER}`,
    aud: [`projects/${PROJECT_NUMBER}`, 'projects/waves-app'],
    sub: APP_ID,
    iat: nowSeconds - 10,
    exp: nowSeconds + 300,
    ...overrides,
  };
}

interface Secret {
  id: string;
  profile_id: string;
  kind: 'phone' | 'authenticator';
  device_id: string | null;
  secret_enc: string;
  active: boolean;
  last_step: number;
  created_at: string;
}

/** The two-step tables and RPCs, as the migration defines them, for one person. */
export function fakeDb() {
  const state = {
    secrets: [] as Secret[],
    sessions: [] as { session_id: string; profile_id: string; kind: string }[],
    failures: 0,
    lockedUntil: 0,
    requests: [] as { session: string; device: string; status: string }[],
    rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  };
  let seq = 0;
  const table = (name: string) => {
    const filters: [string, unknown][] = [];
    let op: 'select' | 'delete' = 'select';
    const rows = () => {
      const all: Record<string, unknown>[] =
        name === 'two_step_secrets'
          ? (state.secrets as unknown as Record<string, unknown>[])
          : (state.sessions as unknown as Record<string, unknown>[]);
      return all.filter((row) => filters.every(([k, v]) => row[k] === v));
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      delete: () => ((op = 'delete'), builder),
      eq: (k: string, v: unknown) => (filters.push([k, v]), builder),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      insert: (row: Record<string, unknown>) => {
        state.secrets.push({
          id: `s${++seq}`,
          device_id: null,
          last_step: 0,
          created_at: new Date().toISOString(),
          ...(row as object),
        } as Secret);
        return Promise.resolve({ error: null });
      },
      then: (resolve: (value: unknown) => void) => {
        if (op === 'delete') {
          const doomed = new Set(rows());
          state.secrets = state.secrets.filter(
            (row) => !doomed.has(row as unknown as Record<string, unknown>),
          );
          return resolve({ error: null });
        }
        return resolve({ data: rows(), error: null });
      },
    };
    return builder;
  };
  const mark = (session: string, kind: string) => {
    if (!state.sessions.some((s) => s.session_id === session)) {
      state.sessions.push({ session_id: session, profile_id: PROFILE, kind });
    }
  };
  const rpcs: Record<string, (a: Record<string, unknown>) => unknown> = {
    waves_two_step_attempt: (a) => {
      if (state.lockedUntil > Date.now()) return { ok: false, reason: 'LOCKED' };
      const secret = state.secrets.find((s) => s.id === a.p_secret_id);
      let ok = false;
      if (secret && typeof a.p_step === 'number') {
        if (a.p_activate && !secret.active) {
          state.secrets = state.secrets.filter((s) => !(s.kind === 'authenticator' && s.active));
          secret.active = true;
          secret.last_step = a.p_step;
          ok = true;
        } else if (!a.p_activate && secret.active && secret.last_step < a.p_step) {
          secret.last_step = a.p_step;
          ok = true;
        }
      }
      if (ok) {
        state.failures = 0;
        if (!a.p_activate) mark(a.p_session as string, a.p_kind as string);
        return { ok: true };
      }
      state.failures += 1;
      if (state.failures >= 10) {
        state.failures = 0;
        state.lockedUntil = Date.now() + 15 * 60 * 1000;
        return { ok: false, reason: 'LOCKED' };
      }
      return { ok: false, reason: 'BAD_CODE' };
    },
    waves_two_step_trust_phone: (a) => {
      const active = state.secrets.filter((s) => s.active);
      if (a.p_mode === 'first' && active.length > 0) return { ok: false, reason: 'HAS_FACTOR' };
      if (a.p_mode === 'code' && !state.sessions.some((s) => s.session_id === a.p_session))
        return { ok: false };
      if (a.p_mode === 'approved') {
        const req = state.requests.find(
          (r) => r.session === a.p_session && r.device === a.p_device && r.status === 'approved',
        );
        if (!req) return { ok: false, reason: 'NOT_APPROVED' };
        req.status = 'used';
      }
      state.secrets = state.secrets.filter((s) => s.kind !== 'phone');
      state.secrets.push({
        id: `s${++seq}`,
        profile_id: PROFILE,
        kind: 'phone',
        device_id: a.p_device as string,
        secret_enc: a.p_secret_enc as string,
        active: true,
        last_step: 0,
        created_at: new Date().toISOString(),
      });
      mark(a.p_session as string, 'phone');
      return { ok: true };
    },
    waves_two_step_request_device: (a) => {
      state.requests.push({
        session: a.p_session as string,
        device: a.p_device as string,
        status: 'pending',
      });
      return 'req-1';
    },
  };
  const service = {
    from: vi.fn((name: string) => table(name)),
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      const fn = rpcs[name];
      return Promise.resolve({ data: fn ? fn(args) : null, error: null });
    }),
  };
  return { state, service };
}

export function caller(user: Record<string, unknown> | null = { id: PROFILE, email: 'a@b.c' }) {
  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) } };
}

export const KEY_B64 = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));

export function deps(
  overrides: Partial<TwoStepDeps> & { db: ReturnType<typeof fakeDb> },
): TwoStepDeps {
  const { db, ...rest } = overrides;
  return {
    asCaller: () => caller(),
    asService: () => db.service,
    env: (name) => ({ TWO_STEP_KEY: KEY_B64 })[name],
    fetchImpl: vi.fn() as unknown as typeof fetch,
    now: () => Date.now(),
    rateLimit: vi.fn().mockResolvedValue(undefined),
    ...rest,
  };
}

export function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://x/fn', {
    method: 'POST',
    headers: { authorization: bearer(), 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
