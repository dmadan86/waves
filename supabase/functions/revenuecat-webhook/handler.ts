/**
 * revenuecat-webhook — RevenueCat telling Waves what the stores did.
 *
 * The server's only source of truth for a paid plan: the app buys through
 * RevenueCat, RevenueCat posts each subscription event here, and this writes
 * `subscriptions`, which `waves_profile_is_paid`, `waves_my_plan` and the voice
 * quota read. The app's own view of RevenueCat's CustomerInfo is display only.
 *
 * Security is the Authorization header: RevenueCat sends, verbatim, the value
 * configured on the webhook in its dashboard, and it must equal
 * REVENUECAT_WEBHOOK_SECRET (a bare secret or `Bearer <secret>` both work). It
 * is checked before the body is read. `verify_jwt = false` in config.toml: the
 * caller is RevenueCat, which has no Supabase session.
 *
 * Every accepted event answers 200 — including duplicates, unknown users and
 * event types Waves does not use — so RevenueCat stops retrying something that
 * will never change. Only a failure to write answers 5xx, which RevenueCat
 * retries; the database half is atomic, so a retry is safe.
 *
 * `app_user_id` is the Waves profile id (the app calls `Purchases.logIn`).
 */

import { HttpError, json } from '../_shared/auth.ts';
import { mapEvent, type RcEvent } from './logic.ts';

export interface Deps {
  env: (name: string) => string | undefined;
  service: {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
}

/** Constant-time string comparison, so the check leaks nothing through timing. */
export function safeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

/** True when the Authorization header carries the configured secret. */
export function authorized(header: string | null, secret: string): boolean {
  if (!header) return false;
  const value = header.trim();
  const bare = value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : value;
  // Both compared, so neither form is faster to reject than the other.
  const exact = safeEqual(value, secret);
  const bearer = safeEqual(bare, secret);
  return exact || bearer;
}

export async function handleRevenueCatWebhook(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST');

  const secret = deps.env('REVENUECAT_WEBHOOK_SECRET');
  if (!secret) {
    // Refused, not waved through: an unconfigured endpoint must not accept
    // unauthenticated grants. RevenueCat retries once the secret is set.
    throw new HttpError(500, 'MISCONFIGURED', 'REVENUECAT_WEBHOOK_SECRET is not set');
  }
  if (!authorized(request.headers.get('Authorization'), secret)) {
    throw new HttpError(401, 'NOT_AUTHORIZED', 'Bad webhook authorization');
  }

  let body: { event?: RcEvent };
  try {
    body = (await request.json()) as { event?: RcEvent };
  } catch {
    throw new HttpError(400, 'BAD_JSON', 'Body is not JSON');
  }
  const event = body?.event;
  if (!event || typeof event !== 'object' || typeof event.id !== 'string' || !event.id) {
    throw new HttpError(400, 'BAD_EVENT', 'Missing event or event id');
  }

  const mapped = mapEvent(event, {
    ignoreSandbox: deps.env('REVENUECAT_IGNORE_SANDBOX') === 'true',
  });

  const { data, error } = await deps.service.rpc('waves_revenuecat_apply', {
    p_event_id: mapped.eventId,
    p_type: mapped.type || 'UNKNOWN',
    p_app_user_id: mapped.appUserId,
    p_event_at: mapped.eventAt,
    p_action: mapped.action,
  });
  if (error) throw new Error(`waves_revenuecat_apply failed: ${error.message}`);

  const outcome = typeof data === 'string' ? data : 'applied';
  // Metadata only: no prices or store ids in the function log.
  console.log(
    JSON.stringify({
      fn: 'revenuecat-webhook',
      type: mapped.type,
      kind: mapped.action.kind,
      outcome,
    }),
  );
  return json({ ok: true, outcome });
}
