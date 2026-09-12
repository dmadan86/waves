/**
 * phone-verify — turning "Firebase says they hold this number" into a Waves
 * session, without inventing a second identity system and without touching
 * anybody's password.
 *
 * Firebase sends the code and checks it. What reaches us is a signed assertion,
 * and verifying it (`verifyFirebaseIdToken`, in core) is the whole of the trust
 * here. What Firebase cannot do is mint a Supabase session — and Supabase's
 * admin API has no call that mints one either.
 *
 * The obvious workaround, setting a random password and signing in with it, is
 * closed: this app has real password sign-in, and overwriting a password to mint
 * a session would silently break the login of anybody who set one.
 *
 * So the session is minted the only way GoTrue offers — by completing a phone
 * OTP. We ask GoTrue for a code; GoTrue generates one and posts it to the send
 * hook, which is `otp-send`, ours; the hook parks it instead of paying to send
 * an SMS nobody is waiting for; we claim it and verify it. The code exists for
 * about a second, in a service-role-only table, single use.
 *
 * Two rules this function does not get to bend:
 *
 *   * **ADR-006.** A phone number signs somebody back in or attaches to the
 *     account in hand. It never opens a new one, which is why GoTrue is asked
 *     with `create_user: false` and a number nobody owns simply fails. Firebase
 *     having verified the number does not make it an account.
 *   * **The daily gate.** `waves_phone_gate` counts this the same as any other
 *     ask, so the three-a-day ceiling and the block list apply to a Firebase
 *     sign-in exactly as they apply to an SMS one.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { verifyFirebaseIdToken, type FirebaseJwk } from '../_shared/core.js';

/** Where Google publishes the keys that sign Firebase ID tokens. */
const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/** A Send SMS Hook payload is small; so is this. */
const MAX_BODY_BYTES = 8 * 1024;

/** How long Google's keys are reused before they are fetched again. */
const KEY_CACHE_SECONDS = 60 * 60;

export interface PhoneVerifyDeps {
  /** Service-role client: the relay and the gate refuse any other caller. */
  service: () => SupabaseClient;
  fetchImpl: typeof fetch;
  env: (key: string) => string | undefined;
  now?: () => number;
}

interface Session {
  access_token: string;
  refresh_token: string;
}

function fail(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Google's keys, kept for an hour in the isolate that fetched them.
 *
 * Module scope, so it survives between requests on a warm isolate and is simply
 * absent on a cold one — which is the correct behaviour either way, and needs no
 * invalidation beyond the clock. Google rotates these slowly and publishes the
 * new one well before it signs with it.
 */
let cachedKeys: { keys: FirebaseJwk[]; until: number } | null = null;

export async function firebaseKeys(
  fetchImpl: typeof fetch,
  nowSeconds: number,
): Promise<FirebaseJwk[] | null> {
  if (cachedKeys && cachedKeys.until > nowSeconds) return cachedKeys.keys;
  try {
    const response = await fetchImpl(FIREBASE_JWKS_URL, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { keys?: FirebaseJwk[] };
    if (!Array.isArray(body.keys) || body.keys.length === 0) return null;
    cachedKeys = { keys: body.keys, until: nowSeconds + KEY_CACHE_SECONDS };
    return body.keys;
  } catch {
    return null;
  }
}

/** Test seam: a cold isolate is the default state, and tests need it back. */
export function forgetFirebaseKeys(): void {
  cachedKeys = null;
}

async function readBoundedText(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

export async function handlePhoneVerify(
  request: Request,
  deps: PhoneVerifyDeps,
): Promise<Response> {
  if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Use POST');

  const projectId = deps.env('FIREBASE_PROJECT_ID');
  const supabaseUrl = deps.env('SUPABASE_URL');
  const anonKey = deps.env('SUPABASE_ANON_KEY');
  if (!projectId || !supabaseUrl || !anonKey) {
    return fail(500, 'MISCONFIGURED', 'Phone sign-in is not configured');
  }

  const body = await readBoundedText(request, MAX_BODY_BYTES);
  if (body === null) return fail(413, 'TOO_LARGE', 'That request is too large');

  let idToken = '';
  try {
    idToken = String((JSON.parse(body ?? '{}') as { idToken?: unknown }).idToken ?? '');
  } catch {
    return fail(400, 'BAD_REQUEST', 'Body is not JSON');
  }
  if (!idToken) return fail(400, 'BAD_REQUEST', 'Missing idToken');

  const nowSeconds = Math.floor((deps.now?.() ?? Date.now()) / 1000);
  const keys = await firebaseKeys(deps.fetchImpl, nowSeconds);
  if (!keys) return fail(503, 'UPSTREAM', 'Could not check that just now. Try again.');

  const verdict = await verifyFirebaseIdToken({ token: idToken, keys, projectId, now: nowSeconds });
  if (!verdict.ok) {
    // The reason is logged and never returned: "wrong audience" tells somebody
    // probing exactly which knob to turn next.
    console.warn('phone-verify rejected a token:', verdict.reason);
    return fail(401, 'NOT_VERIFIED', 'That sign-in could not be verified');
  }
  const phone = verdict.identity.phone;

  // The same ceiling as every other way of asking, and the same block list.
  const { data: gate, error: gateError } = await deps
    .service()
    .rpc('waves_phone_gate', { p_phone: phone });
  if (gateError) {
    // Closed, not open — and deliberately the opposite of `otp-send`, which lets a
    // send through when the limiter is unreachable. There, failing open keeps
    // everybody's sign-in working through a database blip and the worst case is
    // an uncounted code. Here the gate is the only thing standing between a
    // blocked number and a session, and the exchange below cannot complete
    // without the database anyway, so failing open buys nothing and waives the
    // block for whoever can make this query fail.
    console.error('phone-verify gate check failed, refusing:', gateError.message);
    return fail(503, 'UNAVAILABLE', 'Could not sign you in just now. Try again.');
  }
  if ((gate as { allowed?: boolean } | null)?.allowed === false) {
    return fail(429, 'TOO_MANY', 'That is too many sign-in attempts today. Try again tomorrow.');
  }

  const service = deps.service();
  const auth = `${supabaseUrl}/auth/v1`;

  // Open the exchange *before* asking for the code, or the hook will have sent
  // it by the time there is anywhere to park it.
  // The id says which exchange this is. Two devices signing in on one number at
  // the same moment would otherwise share a single row: the second `open` wipes
  // the first's, and the first then claims a code minted for somebody else or
  // deletes the second's on its way out, sending that person's code to an SMS
  // nobody asked for.
  const { data: exchange, error: openError } = await service.rpc('waves_otp_relay_open', {
    p_phone: phone,
  });
  if (openError || typeof exchange !== 'string') {
    return fail(500, 'INTERNAL', 'Could not sign you in just now');
  }

  try {
    const asked = await deps.fetchImpl(`${auth}/otp`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, create_user: false }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!asked.ok) {
      const detail = await asked.text().catch(() => '');
      // The expected refusal, and not an error: ADR-006 says a phone number is
      // never a way to open an account. Said plainly, because the person can act
      // on it — they have an account under an email, or they are new and should
      // start there.
      if (detail.includes('otp_disabled') || detail.includes('Signups not allowed')) {
        return fail(404, 'NO_ACCOUNT', 'No Waves account uses that number yet');
      }
      console.error('phone-verify could not ask for a code:', asked.status, detail.slice(0, 200));
      return fail(502, 'UPSTREAM', 'Could not sign you in just now');
    }

    const code = (
      await service.rpc('waves_otp_relay_claim', { p_phone: phone, p_exchange: exchange })
    ).data as string | null;
    if (!code) {
      // The hook never parked it: either it is not pointed here, or it decided
      // this was an ordinary send. Either way an SMS may be on its way, and the
      // honest answer is that this route did not work rather than a stuck spinner.
      console.error('phone-verify found no code parked for the exchange');
      return fail(502, 'UPSTREAM', 'Could not sign you in just now');
    }

    const verified = await deps.fetchImpl(`${auth}/verify`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'sms', phone, token: code }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!verified.ok) {
      console.error('phone-verify could not complete the exchange:', verified.status);
      return fail(502, 'UPSTREAM', 'Could not sign you in just now');
    }

    const session = (await verified.json()) as Session;
    if (!session.access_token || !session.refresh_token) {
      return fail(502, 'UPSTREAM', 'Could not sign you in just now');
    }

    // A code was used, so today was a real sign-in and not an attempt nobody
    // ever completed — which is what keeps honest mistyping off the strike list.
    // `rpc` resolves with `{ error }` rather than rejecting, so a `.catch` here
    // would have watched for a failure that never arrives and left a strike
    // standing against somebody who did sign in. Logged rather than fatal: they
    // are through, and refusing a completed sign-in over a bookkeeping row would
    // be the larger harm.
    const { error: clearError } = await service.rpc('waves_phone_verified', { p_phone: phone });
    if (clearError) console.error('phone-verify could not clear the day:', clearError.message);

    return new Response(
      JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } finally {
    // Whatever happened, no live code is left sitting in the relay.
    await service.rpc('waves_otp_relay_close', { p_phone: phone, p_exchange: exchange });
  }
}
