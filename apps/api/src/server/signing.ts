/**
 * Whether this deployment can mint a session the backend will actually accept.
 *
 * The API authenticates by signing a ~60-second `authenticated` JWT for the
 * person a token names (see `session.ts`). That only works while the project
 * still accepts tokens signed with its legacy HS256 secret. Supabase projects
 * can migrate to asymmetric signing keys, and once the legacy secret is
 * *revoked* nothing this service signs is acceptable any more — because the
 * private half of an asymmetric key never leaves Supabase, so there is no
 * version of this design that signs ES256 or RS256 instead.
 *
 * That failure is total and it is invisible. Every `/v1` request would answer
 * 401, which is exactly what a bad token looks like, so a developer would spend
 * a day proving their perfectly good key is a perfectly good key. This module
 * exists so that never happens: the condition is detected, named, and reported
 * as a *server* fault.
 *
 * Two things worth knowing before reading the probe:
 *
 * **The JWKS endpoint cannot answer this question.** Supabase's own
 * documentation is explicit that the discovery document returns "the EC public
 * key (the symmetric key is excluded)" — a symmetric secret obviously cannot be
 * published. So a project showing one `ES256` key looks identical whether the
 * legacy secret is in use, previously used, or revoked. Reading JWKS and
 * concluding anything about HS256 is a mistake, and a tempting one.
 *
 * **Only presenting a token settles it.** So that is what `probeSigning` does:
 * it signs one and asks PostgREST. A 200 means accepted, a 401 means the key is
 * not trusted, and nothing has to be inferred from either.
 */

import type { ApiConfig } from './env';
import { signUserJwt } from './session';

export type SigningState =
  /** A token this service signs is accepted. Everything works. */
  | 'ok'
  /** The backend refuses what this service signs. Nothing will work. */
  | 'rejected'
  /** The backend could not be reached, so nothing is known either way. */
  | 'unreachable'
  /** Not enough configuration to even try. */
  | 'unconfigured';

export interface SigningVerdict {
  readonly state: SigningState;
  /** Algorithms the project advertises for verification, best effort. */
  readonly published: readonly string[];
  /** One sentence an operator can act on. Never contains a key or a token. */
  readonly detail: string;
}

/**
 * A subject that is a valid uuid and belongs to nobody.
 *
 * The probe needs a well-formed token, not a real session: `app_config` is
 * readable by any `authenticated` caller under a `USING (true)` policy, so the
 * request succeeds or fails on the signature alone and never on who the subject
 * is. Nothing is written and no account has to exist.
 */
const NOBODY = '00000000-0000-0000-0000-000000000000';

/** Re-probing on every request would put a round trip in front of every call. */
const CACHE_MS = 60_000;

let cached: { at: number; verdict: SigningVerdict } | null = null;

/** Drops the memo. Exported for the tests, which change the environment. */
export function forgetSigningProbe(): void {
  cached = null;
}

async function publishedAlgorithms(config: ApiConfig, fetchImpl: typeof fetch): Promise<string[]> {
  try {
    const response = await fetchImpl(`${config.supabaseUrl}/auth/v1/.well-known/jwks.json`, {
      headers: { apikey: config.supabaseAnonKey },
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { keys?: { alg?: unknown }[] };
    const algorithms = (body.keys ?? [])
      .map((key) => (typeof key.alg === 'string' ? key.alg : null))
      .filter((alg): alg is string => alg !== null);
    return [...new Set(algorithms)];
  } catch {
    // Best effort. The verdict below does not depend on this, and a discovery
    // document that will not load is not itself a reason to refuse traffic.
    return [];
  }
}

export async function probeSigning(
  config: ApiConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<SigningVerdict> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.verdict;

  const verdict = await runProbe(config, fetchImpl);
  cached = { at: now, verdict };
  return verdict;
}

async function runProbe(config: ApiConfig, fetchImpl: typeof fetch): Promise<SigningVerdict> {
  if (!config.supabaseUrl || !config.supabaseAnonKey || !config.jwtSecret) {
    return {
      state: 'unconfigured',
      published: [],
      detail:
        'Set WAVES_API_SUPABASE_URL, WAVES_API_SUPABASE_ANON_KEY and WAVES_API_JWT_SECRET before this can be checked.',
    };
  }

  let token: string;
  try {
    token = signUserJwt(config, NOBODY, []);
  } catch {
    return {
      state: 'unconfigured',
      published: [],
      detail: 'A session could not be signed. Check WAVES_API_JWT_SECRET.',
    };
  }

  const published = await publishedAlgorithms(config, fetchImpl);

  let response: Response;
  try {
    // `app_config` is granted to `authenticated` under a `USING (true)` policy,
    // so this answers on the signature and on nothing else. It is a read of one
    // column of configuration — no ledger row is touched and no row is written.
    response = await fetchImpl(`${config.supabaseUrl}/rest/v1/app_config?select=key&limit=1`, {
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
  } catch (caught) {
    return {
      state: 'unreachable',
      published,
      detail: `The backend could not be reached: ${caught instanceof Error ? caught.message : 'network error'}.`,
    };
  }

  if (response.ok) {
    return {
      state: 'ok',
      published,
      detail: 'The backend accepts the sessions this service signs.',
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      state: 'rejected',
      published,
      detail: describeRejection(published),
    };
  }

  return {
    state: 'unreachable',
    published,
    detail: `The backend answered ${response.status} to the check, so nothing can be concluded.`,
  };
}

function describeRejection(published: readonly string[]): string {
  const asymmetric = published.filter((alg) => alg !== 'HS256');
  const shape =
    asymmetric.length > 0
      ? ` The project advertises ${asymmetric.join(', ')}, whose private key never leaves Supabase, so this service cannot sign for it.`
      : '';
  return (
    'The backend refuses the sessions this service signs. The usual cause is that the project has revoked its legacy HS256 JWT secret, ' +
    "or that WAVES_API_JWT_SECRET is not the project's secret." +
    shape
  );
}

/**
 * Did the backend reject the *signature* rather than the request?
 *
 * The distinction is the whole point. A token this service minted two hundred
 * milliseconds ago cannot legitimately be malformed or expired — it made the
 * thing. So a JWT-level refusal is never the caller's fault and must never be
 * answered 401, or the developer holding a perfectly good API key is sent to
 * debug the one thing that is not wrong.
 */
export function isSignatureRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = 'code' in error ? String((error as { code: unknown }).code) : '';
  // PostgREST's JWT family: PGRST301 covers an unverifiable or expired token,
  // PGRST302 an anonymous request where one was not allowed.
  if (code === 'PGRST301' || code === 'PGRST302') return true;

  const message = 'message' in error ? String((error as { message: unknown }).message) : '';
  return /JWSError|invalid signature|invalid JWT|JWT expired|jwt malformed/i.test(message);
}
