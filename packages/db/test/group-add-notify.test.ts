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

  it('keeps a ghost, and taps no one, when the account is not findable by that channel', async () => {
    const owner = await person('Asha');
    const mira = await person('Mira');
    const groupId = await group(owner.id);
    await client.query(`UPDATE profiles SET discoverable_by_phone = false WHERE id = $1`, [
      mira.id,
    ]);

    const memberId = await addGhost(owner.id, groupId, { name: 'Mira', phone: `+${mira.phone}` });

    const row = await memberRow(memberId);
    expect(row.profile_id).toBeNull();
    expect(row.ghost_name).toBe('Mira');
    expect(await notificationsFor(mira.id)).toHaveLength(0);
  });
});

describe('adding from contacts: the other ways it goes', () => {
  /** Every row in the group, so a test can say "no second copy was made". */
  async function membersIn(groupId: string): Promise<number> {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM group_members WHERE group_id = $1`,
      [groupId],
    );
    return rows[0].n;
  }

  it('matches a number however the address book spaced it', async () => {
    const owner = await person('Asha');
    const mira = await person('Mira');
    const groupId = await group(owner.id);
    const digits = mira.phone;
    const spaced = `+${digits.slice(0, 2)} ${digits.slice(2, 7)}-${digits.slice(7)}`;

    const memberId = await addGhost(owner.id, groupId, { name: 'Mira', phone: spaced });

    expect((await memberRow(memberId)).profile_id).toBe(mira.id);
  });

  it('matches an email whatever its case', async () => {
    const owner = await person('Asha');
    const ravi = await person('Ravi');
    const groupId = await group(owner.id);

    const memberId = await addGhost(owner.id, groupId, {
      name: 'Ravi',
      email: `  ${ravi.email.toUpperCase()} `,
    });

    expect((await memberRow(memberId)).profile_id).toBe(ravi.id);
  });

  it('prefers the email when the email and the number belong to two accounts', async () => {
    const owner = await person('Asha');
    const ravi = await person('Ravi');
    const mira = await person('Mira');
    const groupId = await group(owner.id);

    const memberId = await addGhost(owner.id, groupId, {
      name: 'Ravi',
      email: ravi.email,
      phone: `+${mira.phone}`,
    });

    expect((await memberRow(memberId)).profile_id).toBe(ravi.id);
    expect(await notificationsFor(mira.id)).toHaveLength(0);
  });

  it('links by email when the number is hidden but the email is not', async () => {
    const owner = await person('Asha');
    const mira = await person('Mira');
    const groupId = await group(owner.id);
    await client.query(`UPDATE profiles SET discoverable_by_phone = false WHERE id = $1`, [
      mira.id,
    ]);

    const memberId = await addGhost(owner.id, groupId, {
      name: 'Mira',
      email: mira.email,
      phone: `+${mira.phone}`,
    });

    expect((await memberRow(memberId)).profile_id).toBe(mira.id);
  });

  it('keeps a ghost when the account hides its email', async () => {
    const owner = await person('Asha');
    const ravi = await person('Ravi');
    const groupId = await group(owner.id);
    await client.query(`UPDATE profiles SET discoverable_by_email = false WHERE id = $1`, [
      ravi.id,
    ]);

    const memberId = await addGhost(owner.id, groupId, { name: 'Ravi', email: ravi.email });

    expect((await memberRow(memberId)).profile_id).toBeNull();
    expect(await notificationsFor(ravi.id)).toHaveLength(0);
  });

  it('keeps a ghost for a deleted account', async () => {
    const owner = await person('Asha');
    const gone = await person('Gone');
    const groupId = await group(owner.id);
    await client.query(`UPDATE auth.users SET deleted_at = now() WHERE id = $1`, [gone.id]);

    const memberId = await addGhost(owner.id, groupId, { name: 'Gone', phone: `+${gone.phone}` });

    expect((await memberRow(memberId)).profile_id).toBeNull();
    expect(await notificationsFor(gone.id)).toHaveLength(0);
  });

  it('keeps a ghost for an account with no profile yet', async () => {
    const owner = await person('Asha');
    const groupId = await group(owner.id);
    const id = randomUUID();
    const phone = `91${Math.floor(Math.random() * 1e10)
      .toString()
      .padStart(10, '0')}`;
    await client.query(`INSERT INTO auth.users (id, phone) VALUES ($1, $2)`, [id, phone]);

    const memberId = await addGhost(owner.id, groupId, { name: 'Half', phone: `+${phone}` });

    expect((await memberRow(memberId)).profile_id).toBeNull();
  });

  it('returns your own row when you pick yourself, not a ghost of you', async () => {
    const owner = await person('Asha');
    const groupId = await group(owner.id);
    const before = await membersIn(groupId);
    const { rows } = await client.query(
      `SELECT id FROM group_members WHERE group_id = $1 AND profile_id = $2`,
      [groupId, owner.id],
    );

    const byPhone = await addGhost(owner.id, groupId, { name: 'Me', phone: `+${owner.phone}` });
    const byEmail = await addGhost(owner.id, groupId, { name: 'Me', email: owner.email });

    expect(byPhone).toBe(rows[0].id);
    expect(byEmail).toBe(rows[0].id);
    expect(await membersIn(groupId)).toBe(before);
  });

  it('returns your own row even when you hide your number from others', async () => {
    const owner = await person('Asha');
    const groupId = await group(owner.id);
    await client.query(`UPDATE profiles SET discoverable_by_phone = false WHERE id = $1`, [
      owner.id,
    ]);
    const before = await membersIn(groupId);

    await addGhost(owner.id, groupId, { name: 'Me', phone: `+${owner.phone}` });

    expect(await membersIn(groupId)).toBe(before);
  });

  it('does not bring back someone who left on their own', async () => {
    const owner = await person('Asha');
    const ravi = await person('Ravi');
    const groupId = await group(owner.id);
    await client.query(
      `INSERT INTO group_members (group_id, profile_id, joined_via, left_at)
       VALUES ($1, $2, 'invite_link', now())`,
      [groupId, ravi.id],
    );

    const memberId = await addGhost(owner.id, groupId, { name: 'Ravi', phone: `+${ravi.phone}` });

    expect((await memberRow(memberId)).profile_id).toBeNull();
    expect(await notificationsFor(ravi.id)).toHaveLength(0);
  });

  it('adding the same contact again returns the linked member, once', async () => {
    const owner = await person('Asha');
    const mira = await person('Mira');
    const groupId = await group(owner.id);

    const first = await addGhost(owner.id, groupId, { name: 'Mira', phone: `+${mira.phone}` });
    const before = await membersIn(groupId);
    const again = await addGhost(owner.id, groupId, { name: 'Mira M', email: mira.email });

    expect(again).toBe(first);
    expect(await membersIn(groupId)).toBe(before);
    expect(await notificationsFor(mira.id)).toHaveLength(1);
  });

  it('an offline replay with the same member id links once and taps once', async () => {
    const owner = await person('Asha');
    const mira = await person('Mira');
    const groupId = await group(owner.id);
    const memberId = randomUUID();
    const replay = (): Promise<string> =>
      asUser(owner.id, async () => {
        const { rows } = await client.query(
          `SELECT waves_add_ghost_member($1::uuid, 'Mira', $2::uuid, NULL, $3::text) AS id`,
          [groupId, memberId, `+${mira.phone}`],
        );
        return String(rows[0].id);
      });

    expect(await replay()).toBe(memberId);
    expect(await replay()).toBe(memberId);
    expect((await memberRow(memberId)).profile_id).toBe(mira.id);
    expect(await notificationsFor(mira.id)).toHaveLength(1);
  });

  it('the linked person can open the group straight away', async () => {
    const owner = await person('Asha');
    const mira = await person('Mira');
    const groupId = await group(owner.id);

    await addGhost(owner.id, groupId, { name: 'Mira', phone: `+${mira.phone}` });

    const seen = await asUser(mira.id, async () => {
      const { rows } = await client.query(`SELECT id FROM groups WHERE id = $1`, [groupId]);
      return rows.length;
    });
    expect(seen).toBe(1);
  });

  it('a ghost cannot open the group: nobody gets in without a match', async () => {
    const owner = await person('Asha');
    const mira = await person('Mira');
    const groupId = await group(owner.id);
    await client.query(`UPDATE profiles SET discoverable_by_phone = false WHERE id = $1`, [
      mira.id,
    ]);

    await addGhost(owner.id, groupId, { name: 'Mira', phone: `+${mira.phone}` });

    const seen = await asUser(mira.id, async () => {
      const { rows } = await client.query(`SELECT id FROM groups WHERE id = $1`, [groupId]);
      return rows.length;
    });
    expect(seen).toBe(0);
  });

  it('refuses somebody who is not in the group', async () => {
    const owner = await person('Asha');
    const stranger = await person('Stranger');
    const mira = await person('Mira');
    const groupId = await group(owner.id);

    await expect(
      addGhost(stranger.id, groupId, { name: 'Mira', phone: `+${mira.phone}` }),
    ).rejects.toThrow(/NOT_A_MEMBER/);
    expect(await notificationsFor(mira.id)).toHaveLength(0);
  });

  it('refuses a number with no country code instead of guessing', async () => {
    const owner = await person('Asha');
    const groupId = await group(owner.id);

    await expect(
      addGhost(owner.id, groupId, { name: 'Local', phone: '9876543210' }),
    ).rejects.toThrow(/PHONE_NEEDS_COUNTRY_CODE/);
  });
});
