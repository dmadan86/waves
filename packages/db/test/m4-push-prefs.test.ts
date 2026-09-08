/**
 * The four switches on the notifications screen, wired to something at last.
 *
 * `profiles.notification_prefs` has carried four push preferences since M4, and
 * `apps/mobile/src/app/settings/notifications.tsx` renders all four under a
 * promise that reads "we will never spam you". `waves_claim_push_notifications`
 * read the column not at all. One of the four worked by accident —
 * `waves_trip_nudges` checks `nudges` before enqueuing, so trip reminders
 * stopped, though a nudge somebody sent by hand did not. The other three
 * silenced nothing whatsoever: turning `involvesMe` off and then being added to
 * a group still buzzed the phone.
 *
 * A switch that does nothing is worse than no switch, so what is pinned here is
 * that each one covers the kinds it claims to, that a security notice is not
 * one of the things a person can turn off by accident, and that a preference
 * somebody has never touched means yes.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect } from './helpers.js';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client?.end();
});

/** A profile with a live device, so the claim has somewhere to send to. */
async function personWithPhone(prefs: Record<string, boolean> | null): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO profiles (id, display_name, country_code, notification_prefs)
     VALUES ($1, 'Ravi', 'IN', COALESCE($2::jsonb, '{}'::jsonb))`,
    [id, prefs === null ? null : JSON.stringify(prefs)],
  );
  await client.query(
    `INSERT INTO push_tokens (profile_id, expo_push_token, platform)
     VALUES ($1, $2, 'android')`,
    [id, `ExponentPushToken[${randomUUID()}]`],
  );
  return id;
}

async function enqueue(profileId: string, kind: string): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO notifications (profile_id, kind, title, body, dedupe_key)
     VALUES ($1, $2, 'title', 'body', $3) RETURNING id`,
    [profileId, kind, `${kind}:${randomUUID()}`],
  );
  return String(rows[0].id);
}

/** Run the claim and report what it decided about one particular row. */
async function claimAndRead(id: string): Promise<{ claimed: boolean; status: string | null }> {
  const { rows: claimed } = await client.query(
    `SELECT id FROM waves_claim_push_notifications(500) WHERE id = $1`,
    [id],
  );
  const { rows: stored } = await client.query(
    `SELECT push_status::text AS status, push_next_retry_at FROM notifications WHERE id = $1`,
    [id],
  );
  return { claimed: claimed.length === 1, status: stored[0]?.status ?? null };
}

// `notifications` is swept clean around every case, the same way
// `device-alert-and-digest.test.ts` does — the two files are the ones that call
// the claim RPCs, which have no way to be scoped to one test's rows.
//
// Before, because the claim is a global sweep with a row limit and a table left
// full by an earlier file would be the reason a row here goes unclaimed: an
// answer about the limit dressed up as an answer about preferences. After, so
// this file hands the next one an empty table rather than its leftovers. Safe
// on both counts because the suite sets `fileParallelism: false` — no other
// file is mid-assertion while this one runs.
beforeEach(async () => {
  await client.query(`DELETE FROM notifications`);
});

afterEach(async () => {
  await client.query(`DELETE FROM notifications`);
});

describe('the mapping from a kind to the switch that governs it', () => {
  it('puts every kind under the switch its screen copy promises', async () => {
    const { rows } = await client.query(
      `SELECT kind, waves_pref_key_for_kind(kind) AS pref
         FROM unnest($1::text[]) AS kind`,
      [
        [
          'group_added',
          'expense_added',
          'ghost_claim_approved',
          'settlement_confirm_request',
          'settlement_confirmed',
          'settlement_cancelled',
          'settlement_disputed',
          'nudge',
          'trip_nudge_morning',
          'digest_weekly',
          'new_device_login',
          'something_invented_next_year',
        ],
      ],
    );
    const map = Object.fromEntries(rows.map((r) => [r.kind, r.pref]));

    expect(map.group_added).toBe('involvesMe');
    expect(map.expense_added).toBe('involvesMe');
    expect(map.ghost_claim_approved).toBe('involvesMe');
    expect(map.settlement_confirm_request).toBe('settlementRequests');
    expect(map.settlement_confirmed).toBe('settlementRequests');
    // The two ADR-007 calls mirror images belong with the rest of settling up;
    // somebody who wants to hear about settlements wants to hear about the ones
    // that came apart most of all.
    expect(map.settlement_cancelled).toBe('settlementRequests');
    expect(map.settlement_disputed).toBe('settlementRequests');
    expect(map.nudge).toBe('nudges');
    expect(map.trip_nudge_morning).toBe('nudges');
    expect(map.digest_weekly).toBe('groupActivityDigest');

    // A security notice is not ledger news, and nobody turning off ledger news
    // means "and stop telling me when my account is opened somewhere".
    expect(map.new_device_login).toBeNull();
    // A kind added later pushes until somebody decides where it belongs, rather
    // than going quiet for a reason nobody can see.
    expect(map.something_invented_next_year).toBeNull();
  });
});

describe('a switch that is off actually silences the push', () => {
  it('drops a group_added when involvesMe is off', async () => {
    const person = await personWithPhone({ involvesMe: false });
    const id = await enqueue(person, 'group_added');

    const result = await claimAndRead(id);
    expect(result.claimed).toBe(false);
    // `suppressed`, not `failed`: this is a decision, and the difference is the
    // whole answer the first time somebody asks why a person got no push.
    expect(result.status).toBe('suppressed');
  });

  it('drops a settlement confirm request when settlementRequests is off', async () => {
    const person = await personWithPhone({ settlementRequests: false });
    const id = await enqueue(person, 'settlement_confirm_request');

    expect((await claimAndRead(id)).claimed).toBe(false);
  });

  it('drops a hand-sent nudge when nudges is off, not only the trip reminders', async () => {
    // `waves_trip_nudges` has always checked this key before enqueuing, which
    // is why trip reminders looked like they honoured it. `waves_nudge_to_settle`
    // never did, so the switch was half a switch.
    const person = await personWithPhone({ nudges: false });
    const id = await enqueue(person, 'nudge');

    expect((await claimAndRead(id)).claimed).toBe(false);
  });

  it('drops a digest when groupActivityDigest is off', async () => {
    const person = await personWithPhone({ groupActivityDigest: false });
    const id = await enqueue(person, 'digest_weekly');

    expect((await claimAndRead(id)).claimed).toBe(false);
  });

  it("does not let one switch silence another switch's kinds", async () => {
    const person = await personWithPhone({ nudges: false });
    const id = await enqueue(person, 'settlement_confirm_request');

    expect((await claimAndRead(id)).claimed).toBe(true);
  });
});

describe('what a switch cannot do', () => {
  it('never silences a new sign-in, whatever is turned off', async () => {
    const person = await personWithPhone({
      involvesMe: false,
      settlementRequests: false,
      nudges: false,
      groupActivityDigest: false,
    });
    const id = await enqueue(person, 'new_device_login');

    expect((await claimAndRead(id)).claimed).toBe(true);
  });

  it('reads an untouched preference as yes', async () => {
    // A profile written before a switch existed must not be read as having
    // turned it off. `DEFAULT_NOTIFICATION_PREFS` has all four true.
    const person = await personWithPhone(null);
    const id = await enqueue(person, 'group_added');

    expect((await claimAndRead(id)).claimed).toBe(true);
  });

  it('leaves an on switch alone', async () => {
    const person = await personWithPhone({ involvesMe: true });
    const id = await enqueue(person, 'group_added');

    const result = await claimAndRead(id);
    expect(result.claimed).toBe(true);
    expect(result.status).toBe('queued');
  });
});

describe('a suppressed push is still a notification', () => {
  it('leaves the email half free to send what the push did not', async () => {
    // The check is at claim time, not at `waves_notify` time, on purpose: the
    // row is the record that something happened, and a nudge with no push is
    // precisely the one the email half exists for (TDR §7.4).
    const person = await personWithPhone({ nudges: false });
    const id = await enqueue(person, 'nudge');
    await claimAndRead(id);

    const { rows } = await client.query(
      `SELECT push_status::text AS push, email_status FROM notifications WHERE id = $1`,
      [id],
    );
    expect(rows[0].push).toBe('suppressed');
    expect(rows[0].email_status).toBeNull();
  });

  it('does not come back on a retry, because a preference does not lapse', async () => {
    const person = await personWithPhone({ involvesMe: false });
    const id = await enqueue(person, 'group_added');
    await claimAndRead(id);

    // The retry branch only picks up `failed` rows with a `push_next_retry_at`.
    expect((await claimAndRead(id)).claimed).toBe(false);
    const { rows } = await client.query(
      `SELECT push_next_retry_at FROM notifications WHERE id = $1`,
      [id],
    );
    expect(rows[0].push_next_retry_at).toBeNull();
  });
});
