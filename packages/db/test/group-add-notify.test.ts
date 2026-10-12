/**
 * Tapping the people already on Waves when they are added to a group — and
 * putting them in it as themselves, not as a "Not on Waves yet" ghost.
 *
 * The clone flow's promise is that someone you add — by an email or a number
 * that already belongs to an account — hears about it, the same way they hear
 * about an expense. As with the nudge, the feature lives in the refusals, and
 * those are what is pinned here:
 *
 *   - a genuine match, by email or by number, is notified once;
 *   - adding yourself by your own address does not tap you;
 *   - somebody already in the group is not tapped (they are already inside);
 *   - a re-add — the offline replay or a double-tap — does not tap twice;
 *   - a plain ghost, and a contact matching no account, tap no one at all;
 *   - a match joins as the account itself; a contact add never brings back
 *     someone who left or was removed.
 *
 * The read of `auth.users` is why this file makes sure the stub has the columns
 * the function reads (`phone`, `deleted_at`) — the bare-Postgres test database
 * only guarantees what a given test asked for.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect } from './helpers.js';

let client: Client;

beforeAll(async () => {
  client = await connect();
  await client.query(`CREATE SCHEMA IF NOT EXISTS auth`);
  await client.query(
    `CREATE TABLE IF NOT EXISTS auth.users (
       id uuid PRIMARY KEY,
       email text,
       email_confirmed_at timestamptz
     )`,
  );
  // The function reads these two; another test may have created the stub without
  // them, so add them idempotently rather than assume the shape.
  await client.query(`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text`);
  await client.query(`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz`);
});

afterAll(async () => {
  await client?.end();
});

afterEach(async () => {
  await client.query(`RESET ROLE`);
  await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
});

async function asUser<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  await client.query(`SET ROLE authenticated`);
  try {
    return await run();
  } finally {
    await client.query(`RESET ROLE`);
    await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

interface Person {
  id: string;
  /** Unique — real accounts never share an address, and neither may two tests,
   *  or the `LIMIT 1` match picks a stranger who happens to share the email. */
  email: string;
  /** Bare E.164 digits, the shape `auth.users` stores. */
  phone: string;
}

/** A profile with a Waves account (unique email + number) that can be matched.
 *  The address must be unique across the *whole* database, not just this file:
 *  the suite runs many test files against one shared Postgres at once, and the
 *  phone match would otherwise land on a stranger another file happens to have
 *  inserted. Random digits make that collision vanishingly unlikely. */
async function person(name: string): Promise<Person> {
  const id = randomUUID();
  const email = `${name.toLowerCase()}.${randomUUID().slice(0, 8)}@example.com`;
  const phone = `91${Math.floor(Math.random() * 1e10)
    .toString()
    .padStart(10, '0')}`;
  await client.query(`INSERT INTO profiles (id, display_name) VALUES ($1, $2)`, [id, name]);
  await client.query(
    `INSERT INTO auth.users (id, email, phone, email_confirmed_at) VALUES ($1, $2, $3, now())`,
    [id, email, phone],
  );
  return { id, email, phone };
}

/** A group with `owner` as its creator-member. */
async function group(owner: string): Promise<string> {
  return asUser(owner, async () => {
    const { rows } = await client.query(
      `SELECT waves_create_group('Goa', 'trip', 'INR', NULL, true, NULL, NULL) AS id`,
    );
    return String(rows[0].id);
  });
}

async function addGhost(
  caller: string,
  groupId: string,
  fields: { name?: string | null; email?: string | null; phone?: string | null },
): Promise<string> {
  return asUser(caller, async () => {
    const { rows } = await client.query(
      `SELECT waves_add_ghost_member($1::uuid, $2::text, NULL::uuid, $3::text, $4::text) AS id`,
      [groupId, fields.name ?? null, fields.email ?? null, fields.phone ?? null],
    );
    return String(rows[0].id);
  });
}

async function notificationsFor(profileId: string): Promise<
  {
    kind: string;
    group_id: string | null;
    deep_link: string | null;
    payload: Record<string, unknown>;
  }[]
> {
  const { rows } = await client.query(
    `SELECT kind, group_id, deep_link, payload FROM notifications WHERE profile_id = $1`,
    [profileId],
  );
  return rows;
}

describe('adding someone already on Waves', () => {
  it('taps a match by email, once, about the right group', async () => {
    const owner = await person('Asha');
    const ravi = await person('Ravi');
    const groupId = await group(owner.id);

    await addGhost(owner.id, groupId, { name: 'Ravi', email: ravi.email });

    const notes = await notificationsFor(ravi.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.kind).toBe('group_added');
    expect(notes[0]?.group_id).toBe(groupId);
    expect(notes[0]?.deep_link).toBe(`waves://group/${groupId}`);
    // `counterparty` is the fact the reader's `{actor}` renders from.
    expect(notes[0]?.payload?.counterparty).toBe('Asha');
  });

  it('taps a match by phone', async () => {
    const owner = await person('Asha');
    const mira = await person('Mira');
    const groupId = await group(owner.id);

    // The address book carries the number with its country code and '+'; the
    // account stores it bare. The match must cross that gap.
    await addGhost(owner.id, groupId, { name: 'Mira', phone: `+${mira.phone}` });

    expect(await notificationsFor(mira.id)).toHaveLength(1);
  });

  it('does not tap you for adding yourself', async () => {
    const owner = await person('Asha');
    const groupId = await group(owner.id);

    await addGhost(owner.id, groupId, { name: 'Asha', email: owner.email });

    expect(await notificationsFor(owner.id)).toHaveLength(0);
  });

  it('does not tap someone already in the group', async () => {
    const owner = await person('Asha');
    const ravi = await person('Ravi');
    const groupId = await group(owner.id);
    // Ravi is a real, active member — not a ghost.
    await client.query(
      `INSERT INTO group_members (group_id, profile_id, joined_via) VALUES ($1, $2, 'invite_link')`,
      [groupId, ravi.id],
    );

    await addGhost(owner.id, groupId, { name: 'Ravi', email: ravi.email });

    expect(await notificationsFor(ravi.id)).toHaveLength(0);
  });

  it('does not tap twice when the same contact is re-added', async () => {
    const owner = await person('Asha');
    const ravi = await person('Ravi');
    const groupId = await group(owner.id);

    await addGhost(owner.id, groupId, { name: 'Ravi', email: ravi.email });
    // A second add of the same contact returns the existing member (idempotent),
    // and the dedupe key keeps the inbox to one line.
    await addGhost(owner.id, groupId, { name: 'Ravi', email: ravi.email });

    expect(await notificationsFor(ravi.id)).toHaveLength(1);
  });

  it('taps no one for a plain ghost with no address', async () => {
    const owner = await person('Asha');
    const groupId = await group(owner.id);

    // Scoped to this group: the suite shares one Postgres, so a global count
    // could move under a concurrent test between the two reads.
    const countHere = async (): Promise<number> =>
      (
        await client.query(`SELECT count(*)::int AS n FROM notifications WHERE group_id = $1`, [
          groupId,
        ])
      ).rows[0].n;

    const before = await countHere();
    const memberId = await addGhost(owner.id, groupId, { name: 'Someone from the trip' });
    const after = await countHere();

    expect(memberId).toBeTruthy();
    // A name-only ghost carries no address to match, so nothing was written.
    expect(after).toBe(before);
  });

  it('taps no one for a contact that matches no account', async () => {
    const owner = await person('Asha');
    const groupId = await group(owner.id);

    const countHere = async (): Promise<number> =>
      (
        await client.query(`SELECT count(*)::int AS n FROM notifications WHERE group_id = $1`, [
          groupId,
        ])
      ).rows[0].n;

    const before = await countHere();
    await addGhost(owner.id, groupId, { name: 'Nobody', email: 'nobody@nowhere.example' });
    const after = await countHere();

    expect(after).toBe(before);
  });
});

async function memberRow(memberId: string): Promise<{
  group_id: string;
  profile_id: string | null;
  ghost_name: string | null;
  joined_via: string;
  left_at: Date | null;
}> {
  const { rows } = await client.query(
    `SELECT group_id, profile_id, ghost_name, joined_via, left_at FROM group_members WHERE id = $1`,
    [memberId],
  );
  return rows[0];
}

describe('a contact who is already on Waves joins as themselves', () => {
  it('links a match by phone to the account, not a ghost', async () => {
    const owner = await person('Asha');
    const mira = await person('Mira');
    const groupId = await group(owner.id);

    const memberId = await addGhost(owner.id, groupId, { name: 'Mira', phone: `+${mira.phone}` });

    const row = await memberRow(memberId);
    expect(row.profile_id).toBe(mira.id);
    expect(row.ghost_name).toBeNull();
    expect(row.joined_via).toBe('contact');
  });

  it('links a match by email', async () => {
    const owner = await person('Asha');
    const ravi = await person('Ravi');
    const groupId = await group(owner.id);

    const memberId = await addGhost(owner.id, groupId, { name: 'Ravi', email: ravi.email });

    expect((await memberRow(memberId)).profile_id).toBe(ravi.id);
  });

  it('keeps a contact matching no account a ghost', async () => {
    const owner = await person('Asha');
    const groupId = await group(owner.id);

    const memberId = await addGhost(owner.id, groupId, { name: 'Nobody', phone: '+919000000001' });

    const row = await memberRow(memberId);
    expect(row.profile_id).toBeNull();
    expect(row.ghost_name).toBe('Nobody');
  });

  it('returns the existing row for someone already in the group', async () => {
    const owner = await person('Asha');
    const ravi = await person('Ravi');
    const groupId = await group(owner.id);
    const { rows } = await client.query(
      `INSERT INTO group_members (group_id, profile_id, joined_via) VALUES ($1, $2, 'invite_link') RETURNING id`,
      [groupId, ravi.id],
    );

    const memberId = await addGhost(owner.id, groupId, { name: 'Ravi', phone: `+${ravi.phone}` });

    expect(memberId).toBe(rows[0].id);
    const { rows: count } = await client.query(
      `SELECT count(*)::int AS n FROM group_members WHERE group_id = $1`,
      [groupId],
    );
    expect(count[0].n).toBe(2);
  });

  it('does not bring back someone who was removed: a ghost, and no tap', async () => {
    const owner = await person('Asha');
    const ravi = await person('Ravi');
    const groupId = await group(owner.id);
    await client.query(
      `INSERT INTO group_members (group_id, profile_id, joined_via, left_at, removed_at, removed_by)
       VALUES ($1, $2, 'invite_link', now(), now(), $3)`,
      [groupId, ravi.id, owner.id],
    );

    const memberId = await addGhost(owner.id, groupId, { name: 'Ravi', phone: `+${ravi.phone}` });

    const row = await memberRow(memberId);
    expect(row.profile_id).toBeNull();
    expect(row.ghost_name).toBe('Ravi');
    expect(await notificationsFor(ravi.id)).toHaveLength(0);
  });
});
