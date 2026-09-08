/**
 * Telling the other party.
 *
 * M4's acceptance criterion (TDR §10) is "initiate UPI settle → payee push with
 * Confirm action → balances update", and until this migration the middle third
 * of it did not exist: `waves_record_settlement` wrote a settlement, an
 * activity row and an agent-audit row, and nothing at all in `notifications`.
 * The kinds were there — `settlement_confirm_request` is in the email claim's
 * whitelist, in the copy table in four languages, and in `TEMPLATE_FOR_KIND` —
 * with no producer anywhere in the database.
 *
 * The transitions were the same story from the other end. ADR-007 makes cancel
 * and dispute "deliberate mirror images, one per party" whose whole purpose is
 * that "neither party can silently erase the other's record"; both moved the
 * status and told nobody.
 *
 * What is pinned here is who hears about what, and — as much — who does not: a
 * settlement the payee recorded themselves asks nobody to confirm anything, a
 * replayed mutation does not buzz twice, and `auto_confirmed` stays the seven-
 * day job's to announce so a phone does not vibrate twice for one event.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, seedGroup, type SeededGroup } from './helpers.js';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client?.end();
});

/** Run something with the request claims of a signed-in person. */
async function asUser<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  // Session-level, not transaction-local: these statements do not run inside a
  // transaction, and `is_local = true` would discard the claim before the RPC
  // ever read it.
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  try {
    return await run();
  } finally {
    await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

interface Notice {
  profile_id: string;
  kind: string;
  payload: Record<string, unknown>;
  dedupe_key: string;
}

/** The one notice this group has, asserted to exist so the reads below are typed. */
async function onlyNotice(groupId: string): Promise<Notice> {
  const notices = await noticesFor(groupId);
  expect(notices).toHaveLength(1);
  return notices[0] as Notice;
}

async function noticesFor(groupId: string): Promise<Notice[]> {
  const { rows } = await client.query(
    `SELECT profile_id, kind, payload, dedupe_key
       FROM notifications WHERE group_id = $1 ORDER BY created_at, kind`,
    [groupId],
  );
  return rows as Notice[];
}

async function record(
  group: SeededGroup,
  actorIndex: number,
  mutationId: string | null = randomUUID(),
): Promise<string> {
  return asUser(group.profileIds[actorIndex] ?? '', async () => {
    const { rows } = await client.query(
      `SELECT waves_record_settlement($1, $2, $3, 42000, 'upi', 'INR', NULL, '[]'::jsonb, $4, 'upi') AS id`,
      [group.groupId, group.memberIds[0], group.memberIds[1], mutationId],
    );
    return String(rows[0].id);
  });
}

describe('recording a settlement asks the payee to confirm', () => {
  it('notifies the payee, with the facts the copy table interpolates', async () => {
    const group = await seedGroup(client, { memberCount: 2, name: 'Goa trip' });
    const settlementId = await record(group, 0);

    const notice = await onlyNotice(group.groupId);
    expect(notice.kind).toBe('settlement_confirm_request');
    // The payee — member 1 — is the one asked. The payer already knows.
    expect(notice.profile_id).toBe(group.profileIds[1]);
    expect(notice.dedupe_key).toBe(`settle_confirm_req:${settlementId}`);

    // `render.ts` reads exactly these keys and formats the amount from minor
    // units, so an amount that arrived as a JSON number would come back as a
    // float and BigInt would throw on it. Text, therefore.
    expect(notice.payload.amount).toBe('42000');
    expect(notice.payload.currency).toBe('INR');
    expect(notice.payload.group).toBe('Goa trip');
    expect(notice.payload.counterparty).toBeTruthy();
    expect(notice.payload.settlementId).toBe(settlementId);
  });

  it('does not ask anybody to confirm a payment the payee recorded', async () => {
    const group = await seedGroup(client, { memberCount: 2 });
    // Member 1 is the payee. "They gave me the cash" is not a request for the
    // payer to confirm anything — the money reached the person who would be
    // doing the confirming.
    await record(group, 1);

    expect(await noticesFor(group.groupId)).toHaveLength(0);
  });

  it('does not buzz twice when the offline queue replays the same mutation', async () => {
    const group = await seedGroup(client, { memberCount: 2 });
    const mutationId = randomUUID();

    const first = await record(group, 0, mutationId);
    const second = await record(group, 0, mutationId);

    // ADR-005: the replay returns the same settlement rather than making a new
    // one, so there is nothing new to be told about.
    expect(second).toBe(first);
    expect(await noticesFor(group.groupId)).toHaveLength(1);
  });

  it('says nothing to a ghost, who has no account to say it to', async () => {
    const group = await seedGroup(client, { memberCount: 1, ghostCount: 1 });
    await asUser(group.profileIds[0] ?? '', async () => {
      await client.query(
        `SELECT waves_record_settlement($1, $2, $3, 500, 'cash', 'INR', NULL, '[]'::jsonb, $4, 'cash')`,
        [group.groupId, group.memberIds[0], group.memberIds[1], randomUUID()],
      );
    });

    // `waves_notify` returns NULL for a null profile rather than failing, which
    // is what keeps settling up with a ghost from erroring.
    expect(await noticesFor(group.groupId)).toHaveLength(0);
  });
});

describe('every transition tells the party that did not make it', () => {
  async function pending(): Promise<{ group: SeededGroup; settlementId: string }> {
    const group = await seedGroup(client, { memberCount: 2, name: 'Goa trip' });
    const settlementId = await record(group, 0);
    // Clear the confirm request so each case below reads only its own notice.
    await client.query(`DELETE FROM notifications WHERE group_id = $1`, [group.groupId]);
    return { group, settlementId };
  }

  it('tells the payer when the payee confirms', async () => {
    const { group, settlementId } = await pending();
    await asUser(group.profileIds[1] ?? '', () =>
      client.query(`SELECT waves_confirm_settlement($1)`, [settlementId]),
    );

    const notice = await onlyNotice(group.groupId);
    expect(notice.kind).toBe('settlement_confirmed');
    expect(notice.profile_id).toBe(group.profileIds[0]);
    expect(notice.payload.group).toBe('Goa trip');
  });

  it('tells the payee when the payer withdraws the claim', async () => {
    const { group, settlementId } = await pending();
    await asUser(group.profileIds[0] ?? '', () =>
      client.query(`SELECT waves_cancel_settlement($1)`, [settlementId]),
    );

    const notice = await onlyNotice(group.groupId);
    expect(notice.kind).toBe('settlement_cancelled');
    // The payee is the one whose pending "did you get it?" just vanished.
    expect(notice.profile_id).toBe(group.profileIds[1]);
  });

  it('tells the payer when the payee says it never arrived', async () => {
    const { group, settlementId } = await pending();
    await asUser(group.profileIds[1] ?? '', () =>
      client.query(`SELECT waves_dispute_settlement($1, 'never arrived')`, [settlementId]),
    );

    const notice = await onlyNotice(group.groupId);
    expect(notice.kind).toBe('settlement_disputed');
    expect(notice.profile_id).toBe(group.profileIds[0]);
  });

  it('leaves auto-confirmation to the job that already announces it', async () => {
    const group = await seedGroup(client, { memberCount: 2 });
    const settlementId = randomUUID();
    await client.query(
      `INSERT INTO settlements
         (id, group_id, from_member_id, to_member_id, currency, amount, method, status, initiated_at)
       VALUES ($1, $2, $3, $4, 'INR', 900, 'upi', 'initiated', now() - interval '8 days')`,
      [settlementId, group.groupId, group.memberIds[0], group.memberIds[1]],
    );

    await client.query(`SELECT waves_auto_confirm_settlements()`);

    // Two notices, both the job's own — one per party, with the wording that
    // says a week went by. The trigger deliberately stays out of it, or there
    // would be a third saying less.
    const notices = await noticesFor(group.groupId);
    expect(notices.map((n) => n.kind)).toEqual(['settlement_confirmed', 'settlement_confirmed']);
    expect(notices.map((n) => n.dedupe_key).sort()).toEqual([
      `auto_confirm:${settlementId}:payee`,
      `auto_confirm:${settlementId}:payer`,
    ]);
  });

  it('does not repeat itself when a settlement is written to without moving', async () => {
    const { group, settlementId } = await pending();
    await client.query(`UPDATE settlements SET note = 'a note' WHERE id = $1`, [settlementId]);

    expect(await noticesFor(group.groupId)).toHaveLength(0);
  });
});
