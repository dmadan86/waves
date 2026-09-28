/**
 * contact-unlink — taking the phone number or the email off your own account.
 *
 * Two rules, and neither is this function's to enforce alone:
 *
 *   * **Seven days, both ways.** A contact comes off only once it has been on
 *     for a week, and after it comes off nothing new goes on that channel for a
 *     week. Somebody holding an unlocked, stolen phone could otherwise swap the
 *     owner's number or address for their own in one sitting.
 *   * **Never the last way in.** No confirmed email, no confirmed phone and no
 *     Google or Apple identity is an account nobody can open again.
 *
 * Both are checked, and the channel cleared, inside `waves_unlink_contact`, in
 * one transaction with the account's row locked — two unlinks racing from two
 * devices would otherwise each see the other channel still there and together
 * leave nothing. The "nothing new for a week" half is a trigger on
 * `auth.users`, so it holds for every way a contact can be added, not only the
 * ones that come through here.
 *
 * What this function adds is *who*: the account is read off the caller's own
 * JWT, never the body, so a request can only ever unlink from the account it is
 * signed in as. The database function is service-role only for the same reason
 * — it takes the account as an argument.
 *
 * The response shapes are a contract with the app, which shows `message` as is
 * and formats its own date from `unlockAt`.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { HttpError } from '../_shared/auth.ts';
import { enforceRateLimit } from '../_shared/rateLimit.ts';

/** `{"channel":"phone"}` is about twenty bytes; this is generous. */
const MAX_BODY_BYTES = 4 * 1024;

export type Channel = 'phone' | 'email';

export interface ContactUnlinkDeps {
  /** Service-role client: `waves_unlink_contact` refuses any other caller. */
  service: () => SupabaseClient;
  /** The caller's own profile id, from their Supabase session, or null. */
  callerId: (request: Request) => Promise<string | null>;
}

/** What `waves_unlink_contact` answers with. A refusal is data, not an error. */
interface UnlinkResult {
  unlinked?: boolean;
  refused?: 'NOT_LINKED' | 'TOO_SOON' | 'LAST_SIGN_IN';
  unlock_at?: string;
}

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fail(status: number, code: string, message: string): Response {
  return reply(status, { code, message });
}

const NOUN: Record<Channel, string> = { phone: 'number', email: 'email' };

/** The body, or null for anything that is not `{ channel: 'phone' | 'email' }`. */
async function readChannel(request: Request): Promise<Channel | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(text) as { channel?: unknown } | null;
    // A closed set, matched exactly. 'Phone' is not a channel, and guessing
    // which one somebody meant is not a thing to do on a call that removes one.
    const channel = parsed?.channel;
    return channel === 'phone' || channel === 'email' ? channel : null;
  } catch {
    return null;
  }
}

export async function handleContactUnlink(
  request: Request,
  deps: ContactUnlinkDeps,
): Promise<Response> {
  if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Use POST');

  const caller = await deps.callerId(request);
  if (!caller) return fail(401, 'NOT_AUTHENTICATED', 'Sign in first');

  const channel = await readChannel(request);
  if (!channel) return fail(400, 'BAD_REQUEST', 'Say which to unlink: phone or email.');

  const service = deps.service();

  try {
    await enforceRateLimit(service, request, 'contact-unlink', caller);
  } catch (error) {
    if (error instanceof HttpError) {
      return new Response(JSON.stringify({ code: error.code, message: error.message }), {
        status: error.status,
        headers: { 'Content-Type': 'application/json', ...error.headers },
      });
    }
    // The limiter fails open on its own; anything else it throws is a bug in
    // it, and not a reason to refuse somebody.
    console.error('contact-unlink rate limit check threw, allowing:', error);
  }

  let data: unknown;
  try {
    const answer = await service.rpc('waves_unlink_contact', {
      p_user: caller,
      p_channel: channel,
    });
    if (answer.error) {
      console.error('contact-unlink could not unlink:', answer.error.message);
      return fail(500, 'FAILED', `Could not unlink your ${NOUN[channel]} just now. Try again.`);
    }
    data = answer.data;
  } catch (error) {
    console.error('contact-unlink could not reach the database:', error);
    return fail(500, 'FAILED', `Could not unlink your ${NOUN[channel]} just now. Try again.`);
  }

  const result = (data ?? {}) as UnlinkResult;
  if (result.unlinked === true) return reply(200, { unlinked: true });

  switch (result.refused) {
    case 'NOT_LINKED':
      return fail(
        409,
        'NOT_LINKED',
        channel === 'phone'
          ? 'There is no number on your account to unlink.'
          : 'There is no email on your account to unlink.',
      );
    case 'TOO_SOON': {
      const unlockAt = new Date(result.unlock_at ?? '');
      if (Number.isNaN(unlockAt.getTime())) break;
      return reply(409, {
        code: 'TOO_SOON',
        message: `You added this ${NOUN[channel]} recently. You can unlink it 7 days after adding it.`,
        unlockAt: unlockAt.toISOString(),
      });
    }
    case 'LAST_SIGN_IN':
      return fail(
        409,
        'LAST_SIGN_IN',
        `This ${NOUN[channel]} is the only way into your account. Add another way to sign in first.`,
      );
  }

  console.error('contact-unlink got an answer it does not know:', JSON.stringify(data));
  return fail(500, 'FAILED', `Could not unlink your ${NOUN[channel]} just now. Try again.`);
}
