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
 * Three rules this function does not get to bend:
 *
 *   * **ADR-006.** A phone number signs somebody back in or attaches to the
 *     account in hand. It never opens a new one, which is why GoTrue is asked
 *     with `create_user: false` and a number nobody owns simply fails. Firebase
 *     having verified the number does not make it an account. The other half of
 *     the same ADR is the in-place upgrade: a guest who attaches a number stops
 *     being a guest, because a proved contact is exactly what the ceilings on an
 *     unclaimed account are waiting for.
 *   * **The daily gate.** `waves_phone_gate` counts this the same as any other
 *     ask, so the three-a-day ceiling and the block list apply to a Firebase
 *     sign-in exactly as they apply to an SMS one. What it does not count is a
 *     failure of ours: a relay that never filled or a GoTrue that answered 502
 *     hands the attempt back, so three of our own bad minutes cannot lock
 *     somebody out for the day.
 *   * **One proof, one use.** The assertion is good for ten minutes, and in that
 *     window the same one could otherwise be presented twice — once to sign in
 *     as the number's owner, again to move that number onto a second account.
 *     The Firebase sign-in behind it is recorded and refused thereafter.
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
  /** The caller's own profile id, from their Supabase session, or null. */
  callerId: (request: Request) => Promise<string | null>;
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

/**
 * Digits and nothing else.
 *
 * GoTrue stores a number without its `+`, so the obvious comparison — the E.164
 * string we were handed against the one on the account — never matches, and the
 * "you already have this number" check silently never fires.
 */
function digitsOf(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

/** Attached just now, already there, spoken for by somebody else, or broken. */
type AttachOutcome = 'attached' | 'already' | 'taken' | 'failed';

/**
 * Put the proved number on the account in hand.
 *
 * Reads the account first, because the same number attached twice must be a
 * quiet success and not an error: somebody whose network dropped between the
 * attach and the answer will press the button again, and telling them the number
 * they are holding is "already on another account" — theirs — is both wrong and
 * unfixable from where they are standing.
 *
 * The duplicate message is then re-checked against the account rather than
 * trusted, because GoTrue's duplicate check does not reliably exclude the
 * caller: "already registered" can mean "by you", and the two cases read
 * identically from here.
 */
async function attachNumber(
  service: SupabaseClient,
  caller: string,
  phone: string,
): Promise<AttachOutcome> {
  const holdsIt = async (): Promise<boolean> => {
    const { data, error } = await service.auth.admin.getUserById(caller);
    if (error) return false;
    return digitsOf(data?.user?.phone) === digitsOf(phone);
  };

  if (await holdsIt()) return 'already';

  const { error } = await service.auth.admin.updateUserById(caller, {
    phone,
    phone_confirm: true,
  });
  if (!error) return 'attached';

  if (/already|registered|duplicate|exists/i.test(error.message)) {
    return (await holdsIt()) ? 'already' : 'taken';
  }
  console.error('phone-verify could not attach the number:', error.message);
  return 'failed';
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
  let mode: 'signin' | 'attach' = 'signin';
  try {
    const parsed = JSON.parse(body ?? '{}') as { idToken?: unknown; mode?: unknown };
    idToken = String(parsed.idToken ?? '');
    // Asked for by name, never inferred from whether an Authorization header
    // happens to be present. `functions.invoke` attaches the current session to
    // every call, so inferring it would mean somebody signed in as one account,
    // signing in by phone as another, silently attaching the second number to
    // the first — a data-losing surprise with no error anywhere.
    //
    // And the names are a closed set, which matters more than it looks. The
    // first version read "anything that is not the word attach" as a sign-in, so
    // `mode: 'Attach'` — a capital letter, a typo, an older client spelling it
    // differently — was silently the *other* mode: somebody asking to add a
    // number to the account in their hand would instead be signed out of it and
    // into whoever owns that number. That is precisely the data-losing surprise
    // the paragraph above exists to prevent, arriving through the spelling.
    if (parsed.mode !== undefined && parsed.mode !== null) {
      if (parsed.mode !== 'attach' && parsed.mode !== 'signin') {
        return fail(400, 'BAD_REQUEST', 'Ask for signin or attach');
      }
      mode = parsed.mode;
    }
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
  const { phone, uid, signedInAt } = verdict.identity;

  const service = deps.service();

  // Attaching needs to know *who* before anything is spent. It used to ask after
  // the gate, which meant a request with no session at all — the easiest request
  // in the world to make — took one of that number's three codes for the day on
  // its way to a 401. Three of those and the number's real owner cannot sign in
  // until tomorrow, from an attacker who never proved anything.
  let caller: string | null = null;
  if (mode === 'attach') {
    caller = await deps.callerId(request);
    if (!caller) return fail(401, 'NOT_AUTHENTICATED', 'Sign in first');
  }

  // One proof, one use. The token stays valid for ten minutes after the code was
  // entered, and nothing until now stopped the same one being presented twice —
  // once to sign in as the number's owner, and again, from a second account, to
  // put that number on it. What is recorded is the Firebase sign-in rather than
  // the token, because an ID token is refreshable: a fresh one minted from the
  // same Firebase session carries the same `auth_time`, so pinning the token
  // would pin nothing at all.
  //
  // Ahead of the gate on purpose. The other order lets somebody holding one
  // captured token spend a number's whole daily allowance by replaying it.
  const { data: firstUse, error: useError } = await service.rpc('waves_firebase_assertion_use', {
    p_uid: uid,
    p_auth_time: signedInAt,
  });
  if (useError) {
    // Closed, for the same reason the gate below is: single use is the only
    // thing standing between one captured proof and an unlimited supply of them.
    console.error('phone-verify could not claim the assertion:', useError.message);
    return fail(503, 'UNAVAILABLE', 'Could not sign you in just now. Try again.');
  }
  if (firstUse !== true) {
    // Said as a thing to do rather than as a diagnosis: to anybody honest this
    // is a screen that got resubmitted, and the answer is the same either way.
    return fail(401, 'ALREADY_USED', 'That code has been used. Ask for a new one.');
  }

  /**
   * Hand back what a failure on our side took.
   *
   * Called only after the gate has actually counted the ask, and only for a
   * failure nobody asking could have avoided — a database that would not answer,
   * a relay that never filled, a GoTrue that returned 502. Firebase has already
   * sent and billed for the SMS by the time this function runs, so the value of
   * the refund is precisely that the *same* code can be typed again: no second
   * message, no second charge.
   *
   * Never after an answer. A number already on another account, a blocked
   * number, a number with no account — those are all replies, and the proof was
   * spent getting them.
   */
  const giveItBack = async (): Promise<void> => {
    const { error } = await service.rpc('waves_firebase_assertion_release', {
      p_uid: uid,
      p_auth_time: signedInAt,
    });
    if (error) console.error('phone-verify could not release the assertion:', error.message);
    const { error: refundError } = await service.rpc('waves_phone_gate_refund', { p_phone: phone });
    if (refundError) console.error('phone-verify could not refund the day:', refundError.message);
  };

  // The same ceiling as every other way of asking, and the same block list.
  const { data: gate, error: gateError } = await service.rpc('waves_phone_gate', {
    p_phone: phone,
  });
  if (gateError) {
    // Closed, not open — and deliberately the opposite of `otp-send`, which lets a
    // send through when the limiter is unreachable. There, failing open keeps
    // everybody's sign-in working through a database blip and the worst case is
    // an uncounted code. Here the gate is the only thing standing between a
    // blocked number and a session, and the exchange below cannot complete
    // without the database anyway, so failing open buys nothing and waives the
    // block for whoever can make this query fail.
    console.error('phone-verify gate check failed, refusing:', gateError.message);
    // The proof goes back, but nothing is refunded: the call that would have
    // counted the ask is the one that just failed, so there is no hit to hand
    // back and a refund here would take away somebody's *earlier* attempt.
    const { error: releaseError } = await service.rpc('waves_firebase_assertion_release', {
      p_uid: uid,
      p_auth_time: signedInAt,
    });
    if (releaseError) {
      console.error('phone-verify could not release the assertion:', releaseError.message);
    }
    return fail(503, 'UNAVAILABLE', 'Could not sign you in just now. Try again.');
  }
  if ((gate as { allowed?: boolean } | null)?.allowed === false) {
    return fail(429, 'TOO_MANY', 'That is too many sign-in attempts today. Try again tomorrow.');
  }

  const auth = `${supabaseUrl}/auth/v1`;

  // Attaching, not signing in: somebody already holding an account has proved a
  // number and wants it on that account. ADR-006's point exactly — the account
  // keeps its id, so every group, expense and balance stays where it is, and the
  // number becomes a second way back to the same place.
  if (mode === 'attach') {
    const attached = await attachNumber(service, caller!, phone);
    if (attached === 'taken') {
      // A number already on another account is the one refusal worth naming: it
      // is not a fault the person can fix by retrying, and silently doing
      // nothing would leave them convinced it had worked. Two devices attaching
      // the same number to two different accounts at the same moment land here
      // too: GoTrue's unique index decides, one comes away holding the number
      // and the other is told plainly that it is spoken for.
      return fail(409, 'PHONE_TAKEN', 'That number is already on another Waves account');
    }
    if (attached === 'failed') {
      await giveItBack();
      return fail(502, 'UPSTREAM', 'Could not add that number just now');
    }

    // ADR-006's in-place upgrade, and the reason it needs saying out loud here.
    // Attaching an email goes through GoTrue's own change-verification, which
    // clears `is_anonymous` on the way past; the admin call above sets the
    // number and nothing else. Without this a guest who added a phone kept the
    // guest ceilings — one group, ten days, read-only after — while holding a
    // proved contact, which is the exact opposite of what the upgrade path
    // promises. The function re-checks the confirmed contact itself, so it
    // cannot be used to lift the ceiling on an account that has not earned it.
    //
    // Logged rather than fatal: the number is on the account either way, and
    // refusing an attachment that worked over a flag would be the larger harm.
    // The flag is in the access token, so the client refreshes its session
    // afterwards and the ceiling lifts on the next read.
    const { error: promoteError } = await service.rpc('waves_promote_guest', { p_user: caller });
    if (promoteError) {
      console.error('phone-verify could not lift the guest ceiling:', promoteError.message);
    }

    const { error: clearedError } = await service.rpc('waves_phone_verified', { p_phone: phone });
    if (clearedError) console.error('phone-verify could not clear the day:', clearedError.message);

    return new Response(JSON.stringify({ attached: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Open the exchange *before* asking for the code, or the hook will have sent
  // it by the time there is anywhere to park it.
  // The id says which exchange this is. Two devices signing in on one number at
  // the same moment would otherwise share a single row: the second `open` wipes
  // the first's, and the first then claims a code minted for somebody else or
  // deletes the second's on its way out, sending that person's code to an SMS
  // nobody asked for.
  //
  // The relay's thirty seconds are left where they are, deliberately. Everything
  // between the open and the claim is bounded by the fifteen-second timeout on
  // the GoTrue call below, so the window is already twice the longest the
  // exchange can legitimately take; widening it would only mean a live code
  // sitting fillable for longer. What a slow GoTrue costs is the attempt, and
  // that is what `giveItBack` is for — the fix is the refund, not a bigger
  // window.
  const { data: exchange, error: openError } = await service.rpc('waves_otp_relay_open', {
    p_phone: phone,
  });
  if (openError) {
    await giveItBack();
    if ((openError.message ?? '').includes('OTP_RELAY_BUSY')) {
      return fail(429, 'TOO_MANY', 'A sign-in code is already being checked for that number. Try again in a moment.');
    }
    return fail(500, 'INTERNAL', 'Could not sign you in just now');
  }
  if (typeof exchange !== 'string') {
    await giveItBack();
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
      await giveItBack();
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
      await giveItBack();
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
      await giveItBack();
      return fail(502, 'UPSTREAM', 'Could not sign you in just now');
    }

    const session = (await verified.json()) as Session;
    if (!session.access_token || !session.refresh_token) {
      await giveItBack();
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
