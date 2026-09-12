/**
 * otp-send — Supabase's Send SMS Hook, which is where this app decides how a
 * sign-in code reaches somebody.
 *
 * GoTrue normally posts the code to a configured SMS provider itself. With
 * `[auth.hook.send_sms]` pointed here it posts to us instead, handing over the
 * code it generated, and we decide how it travels. Two things come out of owning
 * that step:
 *
 * 1. **A cap we can actually enforce.** The app calls GoTrue directly, so any
 *    per-day limit written into the client is advice a modified client ignores.
 *    Here it is the server, keyed on the number, and there is no other door.
 * 2. **The rail is a setting, not a rewrite.** `OTP_CHANNEL` picks WhatsApp or
 *    SMS and nothing else in the system knows the difference — the app sends the
 *    same `signInWithOtp` and verifies the same `type: 'sms'` either way.
 *
 * WhatsApp is the default, and the reason is worth keeping in view if the
 * channel is ever switched: India is the first market, and A2P SMS there is
 * gated on DLT registration with the operators through TRAI. Unregistered
 * traffic is dropped by the carrier after Twilio has accepted the request and
 * charged for it, so it fails where nothing in this function can see it.
 * WhatsApp business messaging is not A2P SMS and carries none of that paperwork.
 * SMS is the right answer anyway when the registration exists, or outside India
 * where it does not apply — which is why both rails live here rather than one.
 *
 * This is why the Twilio *Verify* provider is switched off in config.toml.
 * Verify mints and checks its own code; inside a send hook that would mean two
 * different codes in play and neither one valid. Owning delivery means owning
 * plain Programmable Messaging.
 *
 * `verify_jwt = false`, and it must stay that way: the caller is GoTrue, which
 * carries no user session. What it carries instead is a standardwebhooks
 * signature over the exact bytes of the body, and — exactly as in
 * `email-events` — that check runs before anything else is read.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { verifyWebhookSignature } from '../_shared/core.js';
import { LIMITS } from '../_shared/rateLimit.ts';

/**
 * Three codes to a number a day, read from the shared `LIMITS` table so there
 * stays one list of every ceiling in the system. The database is what actually
 * enforces it (`waves_phone_gate`, and the `otp_daily_cap` knob it reads); this
 * is here for the sentence shown to whoever ran out.
 */
export const OTP_DAILY_LIMIT = LIMITS['otp-send'].limit;

/**
 * GoTrue reads a refusal from this envelope, not from an HTTP status alone, and
 * shows `message` to the person waiting on the code. It is deliberately not the
 * repo's usual `{code, message}` error shape — the consumer here is GoTrue, not
 * our own client.
 */
function hookError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { http_code: status, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export interface SendSmsHookPayload {
  user?: { id?: string; phone?: string };
  sms?: { otp?: string };
}

export interface OtpSendDeps {
  /** Service-role client. The rate-limit RPC refuses any other caller. */
  service: () => SupabaseClient;
  fetchImpl: typeof fetch;
  env: (key: string) => string | undefined;
  /**
   * Injected so tests need not forge an HMAC. The real implementation is
   * `verifyWebhookSignature` from @waves/core, which CI already checks against
   * Svix's published test vector — there is no second copy of that logic here.
   */
  verify?: typeof verifyWebhookSignature;
}

/**
 * The most body this endpoint will ever buffer.
 *
 * A Send SMS Hook payload is a few hundred bytes — a phone number, a code and
 * some user metadata. 16 KiB is far above anything GoTrue sends and far below
 * anything worth holding in memory.
 */
const MAX_BODY_BYTES = 16 * 1024;

/** How long Twilio gets to answer before the attempt is abandoned. */
const TWILIO_TIMEOUT_MS = 15_000;

/**
 * Read the body, refusing anything oversized before it is all in memory.
 *
 * `verify_jwt = false` here, so anyone on the internet can POST to this
 * endpoint, and the signature cannot be checked until the bytes are in hand —
 * the signature covers exactly those bytes. That ordering is forced, which
 * makes an unbounded `request.text()` a way for an unauthenticated caller to
 * make the isolate buffer whatever it feels like sending. Counting as the
 * stream arrives caps it at the first chunk over the line.
 *
 * `Content-Length` is checked first as a cheap early out; it is absent under
 * chunked encoding and can lie, so the running total is what actually enforces
 * the limit. Returns null when the body is too large.
 */
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

/** E.164, the only shape GoTrue ever hands us and the only one Twilio takes. */
function isE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

/** Which rail the code travels on. */
export type OtpChannel = 'whatsapp' | 'sms';

/**
 * WhatsApp unless the environment says otherwise.
 *
 * Read from one explicit variable rather than inferred from which secrets
 * happen to be present. A deployment that still holds its WhatsApp secrets
 * while an operator adds SMS ones should not quietly change rail because of the
 * order somebody typed things in; the channel is a decision, so it is written
 * down as one.
 */
export function otpChannel(env: (key: string) => string | undefined): OtpChannel {
  return env('OTP_CHANNEL')?.trim().toLowerCase() === 'sms' ? 'sms' : 'whatsapp';
}

/**
 * The SMS text, when the code travels as SMS.
 *
 * Configurable, and it has to be: an SMS to an Indian number must match a
 * template registered on the operators' DLT portal *exactly*, down to the
 * punctuation, or the carrier drops it — silently, after Twilio has accepted the
 * request and charged for it. A body compiled into this file would mean a
 * redeploy every time a registration is amended, and a mismatch nobody can see
 * from here. `{code}` is the only placeholder.
 */
const DEFAULT_SMS_BODY = '{code} is your Waves verification code. It expires in 10 minutes.';

export function smsBody(template: string | undefined, otp: string): string | null {
  const shape = template?.trim() || DEFAULT_SMS_BODY;
  const parts = shape.split('{code}');
  if (parts.length !== 2) return null;
  return parts.join(otp);
}

/**
 * The message Twilio is asked to send, or null when this deployment is not
 * configured to send one.
 *
 * Separated from the sending so the "are we configured" question can be
 * answered before the daily allowance is spent — see the note at the call site.
 *
 * The two rails differ in more than a prefix. WhatsApp must be an approved
 * template referenced by its Content SID, because a business-initiated message
 * is only allowed to be free text inside a 24-hour window a sign-in has no
 * reason to be in. SMS is the free text, and for India its shape is fixed by the
 * DLT registration instead. Either can name a Messaging Service rather than a
 * single sender — which is the usual arrangement for India, since the service is
 * what carries the registered sender ID.
 */
export function sendParams(
  env: (key: string) => string | undefined,
  phone: string,
  otp: string,
): URLSearchParams | null {
  const form = new URLSearchParams();
  const service = env('TWILIO_MESSAGING_SERVICE_SID');

  if (otpChannel(env) === 'sms') {
    const from = env('TWILIO_SMS_FROM');
    if (!service && !from) return null;
    const body = smsBody(env('TWILIO_SMS_BODY'), otp);
    if (!body) return null;
    form.set('To', phone);
    if (service) form.set('MessagingServiceSid', service);
    else form.set('From', from as string);
    form.set('Body', body);
    return form;
  }

  const from = env('TWILIO_WHATSAPP_FROM');
  const contentSid = env('TWILIO_OTP_CONTENT_SID');
  if (!service && !from) return null;
  // Free-form WhatsApp, which Meta allows only inside the 24-hour window opened
  // by the *recipient* messaging the business first. A sign-in has no reason to
  // be in that window — except in Twilio's sandbox, where joining is exactly
  // that message, which is what makes the sandbox testable with no approved
  // template, no Meta business verification and no sender of one's own.
  //
  // Behind its own flag rather than inferred from a missing Content SID: a
  // production deployment that lost that secret would otherwise quietly start
  // sending messages Meta refuses, and the difference between the two would be
  // a typo. Saying `true` here is a decision about which Twilio account this is.
  if (!contentSid && env('TWILIO_WHATSAPP_FREEFORM')?.trim().toLowerCase() !== 'true') return null;

  form.set('To', `whatsapp:${phone}`);
  if (service) form.set('MessagingServiceSid', service);
  else
    form.set(
      'From',
      (from as string).startsWith('whatsapp:') ? (from as string) : `whatsapp:${from}`,
    );

  if (contentSid) {
    form.set('ContentSid', contentSid);
    // The template's one placeholder is the code.
    form.set('ContentVariables', JSON.stringify({ '1': otp }));
    return form;
  }

  const body = smsBody(env('TWILIO_SMS_BODY'), otp);
  if (!body) return null;
  form.set('Body', body);
  return form;
}

/**
 * Supabase issues a hook secret as `v1,whsec_<base64>`, and that whole string is
 * what lands in the environment. `verifyWebhookSignature` strips `whsec_` — the
 * shape Resend uses — but not the `v1,` in front of it, so handing the raw value
 * over base64-decodes the wrong bytes and refuses every genuine request. That
 * fails in the direction nobody notices in review: the function is deployed, the
 * hook is enabled, and every sign-in answers 401.
 *
 * The `v1` here is the secret's own version prefix and is unrelated to the `v1`
 * in the signature header, which the verifier reads separately.
 */
export function hookSecret(raw: string): string {
  return raw.startsWith('v1,') ? raw.slice('v1,'.length) : raw;
}

export async function handleOtpSend(request: Request, deps: OtpSendDeps): Promise<Response> {
  if (request.method !== 'POST') return hookError(405, 'Use POST');

  const secret = deps.env('SEND_SMS_HOOK_SECRET');
  if (!secret) {
    // Refused rather than waved through, on the same reasoning as
    // `email-events`: a hook that accepts unsigned callers because nobody has
    // configured it yet is worse than one that is switched off.
    return hookError(500, 'SEND_SMS_HOOK_SECRET is not set');
  }

  const id = request.headers.get('webhook-id');
  const timestamp = request.headers.get('webhook-timestamp');
  const signature = request.headers.get('webhook-signature');
  if (!id || !timestamp || !signature) return hookError(401, 'Not a signed webhook');

  // The raw text, not a reparse — signing covers the exact bytes.
  const body = await readBoundedText(request, MAX_BODY_BYTES);
  if (body === null) return hookError(413, 'That request body is too large');
  const verify = deps.verify ?? verifyWebhookSignature;
  const ok = await verify({ secret: hookSecret(secret), id, timestamp, body, header: signature });
  if (!ok) return hookError(401, 'That signature does not match');

  let payload: SendSmsHookPayload;
  try {
    payload = JSON.parse(body) as SendSmsHookPayload;
  } catch {
    return hookError(400, 'Body is not JSON');
  }

  const phone = payload.user?.phone?.trim() ?? '';
  const otp = payload.sms?.otp?.trim() ?? '';
  if (!isE164(phone) || !otp) return hookError(400, 'Missing a phone number or a code');

  // Configuration is checked before the quota is spent. A provider outage still
  // burns an attempt below — the gate deliberately runs ahead of the spend — but
  // a deploy that is simply missing its Twilio secrets should not consume all
  // three of somebody's daily codes for a send this function was never capable of
  // making.
  const accountSid = deps.env('TWILIO_ACCOUNT_SID');
  const form = sendParams(deps.env, phone, otp);

  // Twilio takes either the account's own auth token or an API key pair, and
  // the pair is the better credential: it is scoped, it can be revoked on its
  // own, and losing it does not mean rotating the token every other integration
  // shares. The key is preferred when present, with the auth token still
  // accepted so an existing deployment keeps working unchanged.
  //
  // Only the *username* changes. The account SID stays in the URL either way,
  // because an API key identifies who is calling, never which account is being
  // billed — a key without `TWILIO_ACCOUNT_SID` beside it cannot address
  // anything, which is why it is required below regardless.
  const keySid = deps.env('TWILIO_API_KEY_SID');
  const keySecret = deps.env('TWILIO_API_KEY_SECRET');
  const user = keySid && keySecret ? keySid : accountSid;
  const authSecret = keySid && keySecret ? keySecret : deps.env('TWILIO_AUTH_TOKEN');

  if (!accountSid || !user || !authSecret || !form) {
    return hookError(500, 'Code sending is not configured');
  }

  // Counted before the message is sent, matching `receipt-parse`, where the
  // gate always runs ahead of the spend. The cost is that a Twilio outage still
  // burns an attempt; the alternative — send first, count after — lets a script
  // spend the whole day's allowance before the first count lands.
  //
  // Keyed on the number rather than a profile id: `auth.sms.enable_signup` is
  // off, so one number is one account, and the number is the only identity that
  // exists at the moment a code is asked for.
  // `waves_phone_gate`, not the generic limiter: a window that resets at
  // midnight is no answer to a number that spends its whole allowance every day
  // and never once signs in. That shape is SMS pumping — the codes are never
  // read, because nobody is there to read them — and the gate answers it by
  // blocking the number outright rather than letting it start again tomorrow.
  // The daily count, the strike and the block are one call because they have to
  // be: a concurrent second ask would otherwise read a count about to change.
  const { data, error } = await deps.service().rpc('waves_phone_gate', { p_phone: phone });

  if (error) {
    // Fails open, the same trade the shared limiter makes: the only way this
    // happens is the database being unreachable, and refusing every sign-in
    // during a database blip does more damage than the abuse it guards against.
    console.error('otp-send gate check failed, allowing:', error.message);
  } else {
    const decision = data as { allowed?: boolean; reason?: string } | null;
    if (decision && decision.allowed === false) {
      // One sentence for both refusals. A blocked number and a spent one are
      // told the same thing, because the difference is exactly what somebody
      // probing for numbers worth attacking would like to learn — and because a
      // person in either case has the same three doors left.
      console.warn('otp-send refused', decision.reason ?? 'unknown');
      return hookError(
        429,
        `That is ${OTP_DAILY_LIMIT} codes today. Try again tomorrow, or sign in another way.`,
      );
    }
  }

  // A refused connection, a DNS failure or a timeout rejects rather than
  // answering, and an exception escaping here would leave GoTrue with a bare 500
  // and the caller with whatever a stack trace renders as. A network failure and
  // a 500 from Twilio mean the same thing to the person waiting, so they get the
  // same sanitised answer.
  let response: Response;
  try {
    response = await deps.fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${user}:${authSecret}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
        // Well inside the runtime's own idle timeout, so a Twilio call that
        // hangs is abandoned here — where it becomes the sanitised 502 below —
        // rather than holding the isolate until the platform kills it and
        // GoTrue is left with nothing at all.
        signal: AbortSignal.timeout(TWILIO_TIMEOUT_MS),
      },
    );
  } catch (caught) {
    console.error('twilio request failed', caught);
    return hookError(502, 'Could not send the code just now. Try again in a moment.');
  }

  if (!response.ok) {
    // Twilio's own message is logged, never returned: it can name the sender
    // and the account, and this text is shown to whoever asked for the code.
    const detail = await response.text().catch(() => '');
    console.error('twilio send failed', response.status, detail);
    return hookError(502, 'Could not send the code just now. Try again in a moment.');
  }

  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
