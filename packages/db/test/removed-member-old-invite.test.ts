/**
 * A removed member needs a NEW invite to come back.
 *
 * Removal used to be just `left_at`, so the removed person tapped the link they
 * still had and was back. Now `waves_remove_member` stamps `removed_at` /
 * `removed_by`, and the two doors that attach a profile through an invite
 * (`waves_join_via_invite`, `waves_request_member_claim`) compare the invite's
 * `created_at` with it. Every statement below fails on the schema before
 * 20261012160000_removed_member_needs_new_invite.
 *
 * Runs inside a transaction that is rolled back, on a stub `auth.users` with an
 * `is_anonymous` column, like join-requires-account.test.ts.
 */

import { randomUUID, createHash } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, expectDenied, seedGroup, type SeededGroup } from './helpers';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client.end();
});

beforeEach(async () => {
  await client.query('BEGIN');
  await client.query(`CREATE SCHEMA IF NOT EXISTS auth`);
  await client.query(`CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)`);
  await client.query(
    `ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_anonymous boolean NOT NULL DEFAULT false`,
  );
});

afterEach(async () => {
  await client.query('ROLLBACK');
});

async function person(name = 'Real'): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO profiles (id, display_name, default_currency) VALUES ($1, $2, 'INR')`,
    [id, name],
  );
  await client.query(`INSERT INTO auth.users (id, is_anonymous) VALUES ($1, false)`, [id]);
  return id;
}

/** A live invite minted `minutesAgo` minutes ago; returns its id. */
async function inviteFor(groupId: string, minutesAgo: number): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO invites (id, group_id, token_hash, expires_at, max_uses, created_at)
     VALUES ($1, $2, $3, now() + interval '1 day', 10, now() - make_interval(mins => $4))`,
    [id, groupId, createHash('sha256').update(randomUUID()).digest('hex'), minutesAgo],
  );
  return id;
}

const useCount = (inviteId: string) =>
  client
    .query(`SELECT use_count FROM invites WHERE id = $1`, [inviteId])
    .then((r) => Number(r.rows[0].use_count));

const join = (inviteId: string, profileId: string) =>
  client
    .query(`SELECT waves_join_via_invite($1, $2) AS verdict`, [inviteId, profileId])
    .then((r) => r.rows[0].verdict as { ok: boolean; reason?: string; member_id?: string });

const memberRow = (groupId: string, profileId: string) =>
  client
    .query(
      `SELECT id, left_at, removed_at, removed_by, role FROM group_members
        WHERE group_id = $1 AND profile_id = $2`,
      [groupId, profileId],
    )
    .then((r) => r.rows[0]);

/** Run as a signed-in user for the length of `run`, inside the open transaction. */
async function as<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  await client.query('SET LOCAL ROLE authenticated');
  try {
    return await run();
  } finally {
    await client.query('RESET ROLE');
  }
}

describe('removed by an admin', () => {
  let g: SeededGroup;
  let admin: string;
  let removed: string;
  let oldInvite: string;
  let newInvite: string;

  beforeEach(async () => {
    g = await seedGroup(client, { memberCount: 1, ghostCount: 1, name: 'Goa' });
    admin = g.profileIds[0] as string;
    removed = await person('Removed');
    oldInvite = await inviteFor(g.groupId, 120);
    const joined = await join(oldInvite, removed);
    expect(joined.ok).toBe(true);
    await as(admin, async () => {
      await client.query(`SELECT waves_remove_member($1)`, [joined.member_id]);
    });
    // The removal happened an hour ago, an admin's fresh invite 30 minutes ago.
    await client.query(
      `UPDATE group_members SET removed_at = now() - interval '60 minutes'
                         WHERE group_id = $1 AND profile_id = $2`,
      [g.groupId, removed],
    );
    newInvite = await inviteFor(g.groupId, 30);
  });

  it('records who removed them and when', async () => {
    const row = await memberRow(g.groupId, removed);
    expect(row.left_at).not.toBeNull();
    expect(row.removed_at).not.toBeNull();
    expect(row.removed_by).toBe(admin);
  });

  it('refuses an invite from before the removal and spends no use', async () => {
    const used = await useCount(oldInvite);
    expect(await join(oldInvite, removed)).toMatchObject({ ok: false, reason: 'REMOVED' });
    expect(await useCount(oldInvite)).toBe(used);
    const row = await memberRow(g.groupId, removed);
    expect(row.left_at).not.toBeNull();
    expect(row.removed_at).not.toBeNull();
  });

  it('lets an invite minted after the removal bring them back and clears the removal', async () => {
    const verdict = await join(newInvite, removed);
    expect(verdict.ok).toBe(true);
    expect(await useCount(newInvite)).toBe(1);
    const row = await memberRow(g.groupId, removed);
    expect(row).toMatchObject({
      left_at: null,
      removed_at: null,
      removed_by: null,
      role: 'member',
    });
    // And once back, the old link is simply "already a member" again.
    expect(await join(oldInvite, removed)).toMatchObject({ ok: true, already_member: true });
  });

  it('refuses a ghost claim through an invite from before the removal', async () => {
    const used = await useCount(oldInvite);
    const { rows } = await client.query(
      `SELECT waves_request_member_claim($1, $2, $3, NULL, $4) AS verdict`,
      [g.groupId, g.memberIds[1], removed, oldInvite],
    );
    expect(rows[0].verdict).toMatchObject({ ok: false, reason: 'REMOVED' });
    expect(await useCount(oldInvite)).toBe(used);
    const claims = await client.query(`SELECT 1 FROM member_claims WHERE requester_id = $1`, [
      removed,
    ]);
    expect(claims.rowCount).toBe(0);
  });

  it('refuses a ghost claim with no invite at all', async () => {
    const { rows } = await client.query(
      `SELECT waves_request_member_claim($1, $2, $3, NULL, NULL) AS verdict`,
      [g.groupId, g.memberIds[1], removed],
    );
    expect(rows[0].verdict).toMatchObject({ ok: false, reason: 'REMOVED' });
  });

  it('files a ghost claim through an invite minted after the removal', async () => {
    const { rows } = await client.query(
      `SELECT waves_request_member_claim($1, $2, $3, NULL, $4) AS verdict`,
      [g.groupId, g.memberIds[1], removed, newInvite],
    );
    expect(rows[0].verdict).toMatchObject({ ok: true, already_pending: false });
    expect(await useCount(newInvite)).toBe(1);
  });

  it('cannot be undone by the removed person editing their own row', async () => {
    // group_members_update_self lets a person update their own row. A filtered
    // UPDATE cannot see a row they have left (the SELECT policy hides it), but an
    // unfiltered one reaches it, so that is the shape tried here.
    const selfEdit = (set: string) =>
      as(removed, async () => {
        await client.query(`SAVEPOINT attempt`);
        try {
          await client.query(`UPDATE group_members SET ${set}`);
        } catch (caught) {
          await client.query(`ROLLBACK TO SAVEPOINT attempt`);
          throw caught;
        }
      });

    expect(await expectDenied(selfEdit('left_at = NULL'))).toMatch(/FORBIDDEN_COLUMN/);
    expect(await expectDenied(selfEdit('removed_at = NULL'))).toMatch(/FORBIDDEN_COLUMN/);
    expect(await expectDenied(selfEdit('removed_by = NULL'))).toMatch(/FORBIDDEN_COLUMN/);
    const row = await memberRow(g.groupId, removed);
    expect(row.left_at).not.toBeNull();
    expect(row.removed_at).not.toBeNull();
  });
});

describe('left by themselves', () => {
  /** A group with one leaver who joined 3h ago and left 1h ago. */
  async function leaverSetup() {
    const g = await seedGroup(client, { memberCount: 1, ghostCount: 1, name: 'Goa' });
    const oldInvite = await inviteFor(g.groupId, 180);
    const leaver = await person('Leaver');
    const first = await join(oldInvite, leaver);
    await client.query(
      `UPDATE group_members SET left_at = now() - interval '60 minutes' WHERE id = $1`,
      [first.member_id],
    );
    return { g, oldInvite, leaver, memberId: first.member_id as string };
  }

  it('is refused with an invite from before they left, and no use is spent', async () => {
    const { g, oldInvite, leaver } = await leaverSetup();
    const used = await useCount(oldInvite);
    expect(await join(oldInvite, leaver)).toMatchObject({ ok: false, reason: 'LEFT' });
    expect(await useCount(oldInvite)).toBe(used);
    expect(await memberRow(g.groupId, leaver)).toMatchObject({ removed_at: null });
    expect((await memberRow(g.groupId, leaver)).left_at).not.toBeNull();
  });

  it('is refused with the group durable link (join_token) minted before they left', async () => {
    const { g, leaver } = await leaverSetup();
    // The durable link is an ordinary invites row, minted by the group's admin.
    await as(g.profileIds[0] as string, () =>
      client.query(`SELECT waves_ensure_group_join_token($1)`, [g.groupId]),
    );
    const linkInvite = (
      await client.query(
        `SELECT id FROM invites WHERE group_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [g.groupId],
      )
    ).rows[0].id as string;
    await client.query(
      `UPDATE invites SET created_at = now() - interval '150 minutes' WHERE id = $1`,
      [linkInvite],
    );
    expect(await join(linkInvite, leaver)).toMatchObject({ ok: false, reason: 'LEFT' });
  });

  it('is refused a ghost claim through an old invite, and none through no invite', async () => {
    const { g, oldInvite, leaver } = await leaverSetup();
    const used = await useCount(oldInvite);
    const claim = (invite: string | null) =>
      client
        .query(`SELECT waves_request_member_claim($1, $2, $3, NULL, $4) AS verdict`, [
          g.groupId,
          g.memberIds[1],
          leaver,
          invite,
        ])
        .then((r) => r.rows[0].verdict);
    expect(await claim(oldInvite)).toMatchObject({ ok: false, reason: 'LEFT' });
    expect(await claim(null)).toMatchObject({ ok: false, reason: 'LEFT' });
    expect(await useCount(oldInvite)).toBe(used);
    const claims = await client.query(`SELECT 1 FROM member_claims WHERE requester_id = $1`, [
      leaver,
    ]);
    expect(claims.rowCount).toBe(0);
  });

  it('rejoins with an invite minted after they left, spending one use', async () => {
    const { g, leaver, memberId } = await leaverSetup();
    const fresh = await inviteFor(g.groupId, 30);
    expect(await join(fresh, leaver)).toMatchObject({ ok: true, member_id: memberId });
    expect(await useCount(fresh)).toBe(1);
    expect(await memberRow(g.groupId, leaver)).toMatchObject({ left_at: null, removed_at: null });
  });

  it('files a ghost claim through an invite minted after they left', async () => {
    const { g, leaver } = await leaverSetup();
    const fresh = await inviteFor(g.groupId, 30);
    const { rows } = await client.query(
      `SELECT waves_request_member_claim($1, $2, $3, NULL, $4) AS verdict`,
      [g.groupId, g.memberIds[1], leaver, fresh],
    );
    expect(rows[0].verdict).toMatchObject({ ok: true, already_pending: false });
  });

  it('does not touch somebody who never was a member: an old invite still joins', async () => {
    const g = await seedGroup(client, { memberCount: 1, name: 'Goa' });
    const old = await inviteFor(g.groupId, 600);
    const newcomer = await person('Newcomer');
    expect(await join(old, newcomer)).toMatchObject({ ok: true });
    expect(await useCount(old)).toBe(1);
  });
});
