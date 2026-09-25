/**
 * notify-fanout — taps people on the shoulder about what is already in their
 * inbox (TDR §7.1).
 *
 * The inbox is written the moment something happens, by whichever job or RPC
 * caused it. This function is only the delivery half, and it is deliberately
 * dumb: claim, render, send, record. Everything that could be got wrong lives
 * somewhere it can be tested without a phone —
 *
 *   * claiming and closing out: `waves_claim_push_notifications`, which is an
 *     UPDATE rather than a SELECT so two overlapping runs cannot both send the
 *     same reminder;
 *   * building the messages and reading the tickets: `@waves/core`, including
 *     the mapping from a flat reply back to which device said what.
 *
 * Nobody signed in can call this. It reads other people's inboxes, which is the
 * service role's business and no one else's.
 *
 * The push half lives here as a pure function over injected boundaries (the
 * service client, an env reader, `fetch`, and the email half) so it can be
 * tested without Deno or a network. `index.ts` is the thin `Deno.serve` shell.
 */

import {
  buildPushBatch,
  chunk,
  EXPO_RECEIPT_CHUNK,
  isPushMisconfigured,
  readPushReceipts,
  readPushTickets,
  type ExpoReceipt,
  type ExpoTicket,
  type PushProblem,
  type PushTicketRef,
} from '../_shared/core.js';
import { errorResponse, HttpError, json, type SupabaseClient } from '../_shared/auth.ts';
import {
  buildFor,
  factsOf,
  pause,
  emailSendable,
  sendEmail,
  SEND_SPACING_MS,
  type EmailableRow,
  type EmailResult,
} from '../_shared/email.ts';

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_ENDPOINT = 'https://exp.host/--/api/v2/push/getReceipts';

/**
 * Kept well under what one run could manage, because Resend allows two requests
 * a second and this function shares its clock with the push half. Twenty-five
 * every five minutes is three hundred an hour, which is more mail than this app
 * has any business sending.
 */
const EMAIL_BATCH = 25;

interface ClaimedRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  deep_link: string | null;
  payload: Record<string, unknown>;
  locale: string;
  tokens: string[];
}

interface ReceiptSummary {
  readonly checked: number;
  readonly revoked: number;
  readonly problems?: readonly PushProblem[];
  readonly error?: string;
}

interface EmailSummary {
  readonly claimed: number;
  readonly sent: number;
  readonly failed: number;
  readonly retry: number;
  readonly skipped?: number;
  readonly error?: string;
}

/** The side-effecting boundaries `index.ts` injects and tests mock. */
export interface NotifyFanoutDeps {
  asService(): SupabaseClient;
  env(name: string): string | undefined;
  fetchImpl: typeof fetch;
  dispatchEmail(service: SupabaseClient): Promise<EmailSummary>;
}

export async function handlePushFanout(
  request: Request,
  deps: NotifyFanoutDeps,
): Promise<Response> {
  try {
    // A plain comparison against the service key rather than a JWT check: this
    // is machine-to-machine, the caller is a scheduler, and the key never
    // leaves the server on either side.
    const expected = deps.env('SUPABASE_SERVICE_ROLE_KEY');
    if (!expected || request.headers.get('Authorization') !== `Bearer ${expected}`) {
      throw new HttpError(401, 'NOT_AUTHORISED', 'This endpoint is not for clients');
    }

    const service = deps.asService();

    const { data, error } = await service.rpc('waves_claim_push_notifications', { p_limit: 200 });
    if (error) throw new HttpError(500, 'CLAIM_FAILED', error.message);

    const rows = (data ?? []) as ClaimedRow[];
    if (rows.length === 0) {
      // Nobody to buzz does not mean nobody to write to. Somebody with no
      // device at all is exactly the person the email half exists for.
      return json({
        claimed: 0,
        sent: 0,
        receipts: await checkReceipts(service, deps.fetchImpl),
        email: await deps.dispatchEmail(service),
      });
    }

    const batch = buildPushBatch(
      rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        deepLink: row.deep_link,
        facts: factsOf(row.payload ?? {}),
        locale: row.locale,
        tokens: row.tokens,
      })),
    );

    const delivered: string[] = [];
    const failed: string[] = [];
    const revoke: string[] = [];
    const acceptedTickets: PushTicketRef[] = [];
    const problems = new Map<string, number>();

    const messageChunks = chunk(batch.messages);
    const targetChunks = chunk(batch.targets);

    for (const [index, messages] of messageChunks.entries()) {
      const targets = targetChunks[index] ?? [];
      let tickets: ExpoTicket[] = [];

      try {
        const response = await deps.fetchImpl(EXPO_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(messages),
        });
        const parsed = (await response.json()) as { data?: ExpoTicket[] };
        tickets = parsed.data ?? [];
      } catch (unreachable) {
        // Expo being down is not a reason to lose the notification. An empty
        // ticket list marks the whole chunk failed, and the row stays in the
        // inbox where the person will still see it.
        console.error('expo push unreachable:', (unreachable as Error).message);
      }

      const outcome = readPushTickets(targets, tickets);
      delivered.push(...outcome.delivered);
      failed.push(...outcome.failed);
      revoke.push(...outcome.revoke);
      acceptedTickets.push(...outcome.tickets);
      for (const problem of outcome.problems) {
        problems.set(problem.error, (problems.get(problem.error) ?? 0) + problem.count);
      }
    }

    const summary: PushProblem[] = [...problems]
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count || a.error.localeCompare(b.error));

    // Said loudly, because the alternative is a graph of failures that looks
    // like a country with its phones off. `MismatchSenderId` means the FCM key
    // Expo holds is not the one this binary was built with; `InvalidCredentials`
    // means Expo has no usable key at all. Both are fixed in a console, by us,
    // and neither announces itself anywhere else. See README, "Turning on push".
    if (isPushMisconfigured(summary)) {
      console.error(
        'push credentials look wrong — nobody is receiving notifications:',
        JSON.stringify(summary),
      );
    } else if (summary.length > 0) {
      console.warn('push problems:', JSON.stringify(summary));
    }

    const { error: finishError } = await service.rpc('waves_finish_push', {
      p_delivered: delivered,
      p_failed: failed,
      p_revoke: revoke,
    });
    if (finishError) throw new HttpError(500, 'FINISH_FAILED', finishError.message);

    // Kept so a later run can ask how each device's last message fared. Not
    // worth failing the run over: the push already went, and the next message
    // to the device records a fresh ticket.
    if (acceptedTickets.length > 0) {
      const { error: ticketError } = await service.rpc('waves_record_push_tickets', {
        p_tickets: acceptedTickets.map(({ token, ticketId }) => ({ token, ticket_id: ticketId })),
      });
      if (ticketError) console.error('could not record push tickets:', ticketError.message);
    }

    return json({
      claimed: rows.length,
      sent: delivered.length,
      failed: failed.length,
      revoked: revoke.length,
      problems: summary,
      misconfigured: isPushMisconfigured(summary),
      receipts: await checkReceipts(service, deps.fetchImpl),
      email: await deps.dispatchEmail(service),
    });
  } catch (error) {
    return errorResponse(error, { fn: 'notify-fanout' });
  }
}

/**
 * Ask Expo how earlier sends fared, and revoke the devices that are gone.
 *
 * A ticket at send time only says Expo took the message; an uninstalled app
 * usually shows up afterwards, as a `DeviceNotRegistered` receipt. Without this
 * a dead token is sent to forever and its owner's notifications read "sent".
 *
 * It cannot throw, for the same reason as the email half: the push this run
 * sent already happened, and a receipt check having a bad minute should not
 * turn that into a 500. Claimed tickets are cleared either way — a device that
 * is really gone refuses its next message too, and gets revoked then.
 */
export async function checkReceipts(
  service: SupabaseClient,
  fetchImpl: typeof fetch,
): Promise<ReceiptSummary> {
  try {
    const { data, error } = await service.rpc('waves_claim_push_receipts', {
      p_limit: EXPO_RECEIPT_CHUNK,
    });
    if (error) return { checked: 0, revoked: 0, error: error.message };

    const pending = ((data ?? []) as { token: string; ticket_id: string }[]).map((row) => ({
      token: row.token,
      ticketId: row.ticket_id,
    }));
    if (pending.length === 0) return { checked: 0, revoked: 0 };

    const response = await fetchImpl(EXPO_RECEIPTS_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ids: pending.map((ticket) => ticket.ticketId) }),
    });
    const parsed = (await response.json()) as { data?: Record<string, ExpoReceipt> };
    const outcome = readPushReceipts(pending, parsed.data ?? {});

    if (outcome.revoke.length > 0) {
      const { error: revokeError } = await service.rpc('waves_finish_push', {
        p_delivered: [],
        p_failed: [],
        p_revoke: outcome.revoke,
      });
      if (revokeError) return { checked: pending.length, revoked: 0, error: revokeError.message };
    }
    if (outcome.problems.length > 0) {
      console.warn('push receipt problems:', JSON.stringify(outcome.problems));
    }

    return {
      checked: pending.length,
      revoked: outcome.revoke.length,
      ...(outcome.problems.length > 0 ? { problems: outcome.problems } : {}),
    };
  } catch (unexpected) {
    console.error('push receipt check failed:', (unexpected as Error).message);
    return { checked: 0, revoked: 0, error: (unexpected as Error).message };
  }
}

/**
 * The email half of step 5 in TDR §7.1, run after the push half and never
 * instead of it.
 *
 * It cannot throw. Resend having a bad minute is not a reason for the fanout to
 * return a 500 — the push it already sent happened, the rows it already closed
 * are closed, and a scheduler reading an error would tell us the wrong thing
 * about which half is broken.
 */
export async function dispatchEmail(service: SupabaseClient): Promise<EmailSummary> {
  const empty: EmailSummary = { claimed: 0, sent: 0, failed: 0, retry: 0 };

  try {
    // No key configured is a deployment that has not turned email on, not a
    // fault. Claiming rows first would mark them queued and then strand them.
    // An empty reason is "email is simply not turned on here" — silent and not a
    // fault. Anything else is a misconfiguration, and it is reported rather than
    // read as "off", which is how mail stops for a week before anybody asks.
    const sendable = emailSendable();
    if (!sendable.ok) {
      return sendable.reason ? { ...empty, error: sendable.reason } : empty;
    }

    const { data, error } = await service.rpc('waves_claim_email_notifications', {
      p_limit: EMAIL_BATCH,
    });
    if (error) return { ...empty, error: error.message };

    const rows = (data ?? []) as EmailableRow[];
    if (rows.length === 0) return empty;

    const results: EmailResult[] = [];
    let skipped = 0;

    for (const [index, row] of rows.entries()) {
      const built = await buildFor(row);
      if (!built) {
        // A kind SQL claimed and `@waves/core` will not mail. The two lists
        // disagreeing is a bug, but stranding the row is not the way to find
        // out about it.
        console.error(`no email template for kind ${row.kind}`);
        results.push({ id: row.id, status: 'failed', template: 'unknown', error: 'NO_TEMPLATE' });
        skipped += 1;
        continue;
      }

      if (index > 0) await pause(SEND_SPACING_MS);
      results.push(await sendEmail(built));
    }

    const { error: finishError } = await service.rpc('waves_finish_email', { p_results: results });
    if (finishError) console.error('could not record email results:', finishError.message);

    const count = (status: EmailResult['status']): number =>
      results.filter((result) => result.status === status).length;

    return {
      claimed: rows.length,
      sent: count('sent'),
      failed: count('failed'),
      retry: count('retry'),
      ...(skipped > 0 ? { skipped } : {}),
      ...(finishError ? { error: finishError.message } : {}),
    };
  } catch (unexpected) {
    console.error('email dispatch failed:', (unexpected as Error).message);
    return { ...empty, error: (unexpected as Error).message };
  }
}
