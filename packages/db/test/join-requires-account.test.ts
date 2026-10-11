/**
 * Joining a shared group needs an account (ADR-006 amendment, 2026-10-11).
 *
 * Every way a profile gets attached to somebody else's group is exercised as an
 * anonymous (guest) user and as a real one:
 *
 *   - waves_join_via_invite        the direct join
 *   - waves_request_member_claim   asking to be a listed-but-unclaimed person
 *   - the group_members trigger    a raw insert, or approving a claim a guest
 *                                  filed before the rule existed
 *
 * and the promise that nobody is removed: a guest who is already in group A
 * keeps using it, and is refused only on group B.
 *
 * The suite runs against a stub `auth.users` with no `is_anonymous` column, so
 * each test adds the column and its users inside a transaction that is rolled
 * back — the same trick the voice-agent quota suite uses. Every statement
 * below fails on the schema before 20261011120000_join_requires_account.
 */

import { randomUUID, createHash } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, seedGroup, type SeededGroup } from './helpers';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client.end();
});

beforeEach(async () => {
  await client.query('BEGIN');
  // Inside the transaction too: a committed stub table would change what every
  // later suite finds in `auth`.
  await client.query(`CREATE SCHEMA IF NOT EXISTS auth`);
  await client.query(`CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)`);
  await client.query(
    `ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_anonymous boolean NOT NULL DEFAULT false`,
  );
});

afterEach(async () => {
  await client.query('ROLLBACK');
});

/** A profile plus its auth.users row, anonymous or not. */
async function person(anonymous: boolean, name = anonymous ? 'Guest' : 'Real'): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO profiles (id, display_name, default_currency) VALUES ($1, $2, 'INR')`,
    [id, name],
  );
  await client.query(`INSERT INTO auth.users (id, is_anonymous) VALUES ($1, $2)`, [id, anonymous]);
  return id;
}

/** A live invite for the group; returns its id. */
async function inviteFor(groupId: string): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO invites (id, group_id, token_hash, expires_at, max_uses)
     VALUES ($1, $2, $3, now() + interval '1 day', 10)`,
    [id, groupId, createHash('sha256').update(randomUUID()).digest('hex')],
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

const memberRows = (groupId: string, profileId: string) =>
  client
    .query(`SELECT 1 FROM group_members WHERE group_id = $1 AND profile_id = $2`, [
      groupId,
      profileId,
    ])
    .then((r) => r.rowCount ?? 0);

describe('waves_join_via_invite', () => {
  let g: SeededGroup;
  let invite: string;

  beforeEach(async () => {
    g = await seedGroup(client, { memberCount: 1, name: 'Goa' });
    invite = await inviteFor(g.groupId);
  });

  it('refuses an anonymous user, adds no member and spends no invite use', async () => {
    const guest = await person(true);
    const verdict = await join(invite, guest);
    expect(verdict).toMatchObject({ ok: false, reason: 'ACCOUNT_REQUIRED' });
    expect(await memberRows(g.groupId, guest)).toBe(0);
    expect(await useCount(invite)).toBe(0);
  });

  it('lets a real user in, as a member, spending one use', async () => {
    const real = await person(false);
    const verdict = await join(invite, real);
    expect(verdict.ok).toBe(true);
    expect(verdict.member_id).toBeTruthy();
    expect(await memberRows(g.groupId, real)).toBe(1);
    expect(await useCount(invite)).toBe(1);
  });

  it('is not callable by a signed-in user directly (service role only)', async () => {
    const real = await person(false);
    await client.query(`SET LOCAL ROLE authenticated`);
    await expect(join(invite, real)).rejects.toThrow(/permission denied/i);
  });
});

describe('waves_request_member_claim', () => {
  it('refuses an anonymous user before any invite use is spent', async () => {
    const g = await seedGroup(client, { memberCount: 1, ghostCount: 1 });
    const invite = await inviteFor(g.groupId);
    const guest = await person(true);
    const { rows } = await client.query(
      `SELECT waves_request_member_claim($1, $2, $3, NULL, $4) AS verdict`,
      [g.groupId, g.memberIds[1], guest, invite],
    );
    expect(rows[0].verdict).toMatchObject({ ok: false, reason: 'ACCOUNT_REQUIRED' });
    expect(await useCount(invite)).toBe(0);
    const claims = await client.query(`SELECT 1 FROM member_claims WHERE requester_id = $1`, [
      guest,
    ]);
    expect(claims.rowCount).toBe(0);
  });

  it('files the request for a real user', async () => {
    const g = await seedGroup(client, { memberCount: 1, ghostCount: 1 });
    const invite = await inviteFor(g.groupId);
    const real = await person(false);
    const { rows } = await client.query(
      `SELECT waves_request_member_claim($1, $2, $3, NULL, $4) AS verdict`,
      [g.groupId, g.memberIds[1], real, invite],
    );
    expect(rows[0].verdict).toMatchObject({ ok: true, already_pending: false });
    expect(await useCount(invite)).toBe(1);
  });
});

describe('the membership trigger (any other writer)', () => {
  it('refuses a raw insert of an anonymous user as an invite join', async () => {
    const g = await seedGroup(client, { memberCount: 1 });
    const guest = await person(true);
    await client.query('SAVEPOINT s');
    await expect(
      client.query(
        `INSERT INTO group_members (group_id, profile_id, joined_via)
         VALUES ($1, $2, 'invite_link')`,
        [g.groupId, guest],
      ),
    ).rejects.toThrow(/ACCOUNT_REQUIRED/);
    await client.query('ROLLBACK TO s');
    expect(await memberRows(g.groupId, guest)).toBe(0);
  });

  it('accepts the same insert for a real user', async () => {
    const g = await seedGroup(client, { memberCount: 1 });
    const real = await person(false);
    await client.query(
      `INSERT INTO group_members (group_id, profile_id, joined_via) VALUES ($1, $2, 'invite_link')`,
      [g.groupId, real],
    );
    expect(await memberRows(g.groupId, real)).toBe(1);
  });

  it('cannot approve a claim a guest filed before the rule onto a placeholder', async () => {
    const g = await seedGroup(client, { memberCount: 1, ghostCount: 1 });
    const guest = await person(true);
    const admin = g.profileIds[0] as string;
    const { rows } = await client.query(
      `INSERT INTO member_claims (group_id, member_id, requester_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [g.groupId, g.memberIds[1], guest],
    );
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: admin, role: 'authenticated' }),
    ]);
    await client.query('SAVEPOINT s');
    await expect(
      client.query(`SELECT waves_decide_member_claim($1, true)`, [rows[0].id]),
    ).rejects.toThrow(/ACCOUNT_REQUIRED/);
    await client.query('ROLLBACK TO s');
    const ghost = await client.query(`SELECT profile_id FROM group_members WHERE id = $1`, [
      g.memberIds[1],
    ]);
    expect(ghost.rows[0].profile_id).toBeNull();
  });
});

describe('a guest who is already in a group keeps it', () => {
  it('can keep using group A but is refused on group B', async () => {
    const a = await seedGroup(client, { memberCount: 1, name: 'A' });
    const b = await seedGroup(client, { memberCount: 1, name: 'B' });
    const inviteB = await inviteFor(b.groupId);

    // Joined A by invite back when that was allowed: the person was a full
    // user at the time of the insert and is a guest now, which is the same row
    // a pre-migration guest has.
    const guest = await person(false, 'Early guest');
    await client.query(
      `INSERT INTO group_members (group_id, profile_id, joined_via) VALUES ($1, $2, 'invite_link')`,
      [a.groupId, guest],
    );
    await client.query(`UPDATE auth.users SET is_anonymous = true WHERE id = $1`, [guest]);

    // Group A: the membership is untouched and still writable.
    await client.query(
      `UPDATE group_members SET left_at = NULL WHERE group_id = $1 AND profile_id = $2`,
      [a.groupId, guest],
    );
    expect(await memberRows(a.groupId, guest)).toBe(1);

    // Group B: refused.
    expect(await join(inviteB, guest)).toMatchObject({ ok: false, reason: 'ACCOUNT_REQUIRED' });
    expect(await memberRows(b.groupId, guest)).toBe(0);
  });

  it('may still create their own group (that is not joining)', async () => {
    const guest = await person(true);
    const id = randomUUID();
    await client.query(
      `INSERT INTO groups (id, name, type, default_currency, created_by)
       VALUES ($1, 'Mine', 'other', 'INR', $2)`,
      [id, guest],
    );
    await client.query(
      `INSERT INTO group_members (group_id, profile_id, role, joined_via)
       VALUES ($1, $2, 'admin', 'creator')`,
      [id, guest],
    );
    expect(await memberRows(id, guest)).toBe(1);
  });

  it('can join once upgraded to a real account (same user id)', async () => {
    const g = await seedGroup(client, { memberCount: 1 });
    const invite = await inviteFor(g.groupId);
    const user = await person(true);
    expect(await join(invite, user)).toMatchObject({ ok: false });
    await client.query(`UPDATE auth.users SET is_anonymous = false WHERE id = $1`, [user]);
    expect((await join(invite, user)).ok).toBe(true);
  });
});
