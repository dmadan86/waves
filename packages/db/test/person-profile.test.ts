/**
 * The person screen's server half: who you are allowed to look at, and what of
 * them you are allowed to see.
 *
 * These run against a bare Postgres with no `auth` schema, which is exactly the
 * shape the self-host stack has too. That means the contact *values* cannot be
 * asserted here — there is no `auth.users` to hold an email or a phone — but
 * everything that decides whether they would be sent can be, and that is the
 * part with teeth: the shared-group gate, the owner's own switch, and the
 * refusal to tell a miss apart from a refusal.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, seedGroup } from './helpers.js';

let client: Client;

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

interface PersonRow {
  person_key: string;
  display_name: string;
  is_ghost: boolean;
  is_you: boolean;
  shared_groups: number;
  email: string | null;
  phone: string | null;
  payment_rail: string | null;
  payment_handle: string | null;
  country_code: string | null;
  contact_withheld: boolean;
}

async function profileOf(viewer: string, key: string): Promise<PersonRow | undefined> {
  return asUser(viewer, async () => {
    const result = await client.query<PersonRow>(`SELECT * FROM waves_person_profile($1)`, [key]);
    return result.rows[0];
  });
}

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client.end();
});

describe('waves_person_profile', () => {
  it('names somebody you share a group with, and counts the groups', async () => {
    const group = await seedGroup(client, { memberCount: 2 });
    const [me, them] = group.profileIds;

    const row = await profileOf(me!, them!);

    expect(row?.display_name).toBe('Member 2');
    expect(row?.is_ghost).toBe(false);
    expect(row?.is_you).toBe(false);
    expect(Number(row?.shared_groups)).toBe(1);
  });

  it('adds up the groups two people are both in', async () => {
    const first = await seedGroup(client, { memberCount: 2, name: 'Goa' });
    const [me, them] = first.profileIds;

    // A second group with the same two people in it.
    const groupId = randomUUID();
    await client.query(
      `INSERT INTO groups (id, name, type, default_currency, created_by)
       VALUES ($1, 'Flat', 'home', 'INR', $2)`,
      [groupId, me],
    );
    for (const profileId of [me, them]) {
      await client.query(
        `INSERT INTO group_members (id, group_id, profile_id, role, joined_via)
         VALUES ($1, $2, $3, 'member', 'invite')`,
        [randomUUID(), groupId, profileId],
      );
    }

    const row = await profileOf(me!, them!);
    expect(Number(row?.shared_groups)).toBe(2);
  });

  it('stops counting a group once it has been deleted', async () => {
    // A delete is a tombstone (ADR-004) and leaves both memberships in place, so
    // "2 groups in common" survived the group itself until this was filtered.
    const first = await seedGroup(client, { memberCount: 2, name: 'Goa' });
    const [me, them] = first.profileIds;

    const groupId = randomUUID();
    await client.query(
      `INSERT INTO groups (id, name, type, default_currency, created_by)
       VALUES ($1, 'Flat', 'home', 'INR', $2)`,
      [groupId, me],
    );
    for (const profileId of [me, them]) {
      await client.query(
        `INSERT INTO group_members (id, group_id, profile_id, role, joined_via)
         VALUES ($1, $2, $3, 'member', 'invite')`,
        [randomUUID(), groupId, profileId],
      );
    }
    expect(Number((await profileOf(me!, them!))?.shared_groups)).toBe(2);

    await client.query(`UPDATE groups SET deleted_at = now() WHERE id = $1`, [groupId]);
    expect(Number((await profileOf(me!, them!))?.shared_groups)).toBe(1);
  });

  it('goes on counting an archived group, because nobody left it', async () => {
    // The one place this parts company with the balance RPCs, which drop an
    // archived group. That question is about which ledgers are live enough to
    // add up and to open; this one is about whether two people know each other,
    // and putting a finished trip away does not make them strangers.
    const group = await seedGroup(client, { memberCount: 2 });
    const [me, them] = group.profileIds;

    await client.query(`UPDATE groups SET archived_at = now() WHERE id = $1`, [group.groupId]);

    expect(Number((await profileOf(me!, them!))?.shared_groups)).toBe(1);
  });

  it('will not show a stranger whose only shared group is deleted', async () => {
    // The count doubles as the permission gate, so filtering tightens the gate
    // too — and correctly: a group that no longer exists must not be the sole
    // reason somebody's name, face and phone number come back.
    const group = await seedGroup(client, { memberCount: 2 });
    const [me, them] = group.profileIds;

    await client.query(`UPDATE groups SET deleted_at = now() WHERE id = $1`, [group.groupId]);

    expect(await profileOf(me!, them!)).toBeUndefined();
  });

  it('returns nothing at all for somebody you share no group with', async () => {
    const mine = await seedGroup(client, { memberCount: 1 });
    const theirs = await seedGroup(client, { memberCount: 1 });

    const row = await profileOf(mine.profileIds[0]!, theirs.profileIds[0]!);

    // Not an empty person, not an error — no row. A stranger's existence is
    // itself the thing being withheld.
    expect(row).toBeUndefined();
  });

  it('gives the same empty answer for a uuid belonging to nobody', async () => {
    const group = await seedGroup(client, { memberCount: 1 });
    const row = await profileOf(group.profileIds[0]!, randomUUID());
    expect(row).toBeUndefined();
  });

  it('marks contact withheld when the owner has chosen nobody', async () => {
    const group = await seedGroup(client, { memberCount: 2 });
    const [me, them] = group.profileIds;

    await client.query(
      `UPDATE profiles SET payment_rail = 'upi', payment_handle = 'priya@upi', country_code = 'IN'
        WHERE id = $1`,
      [them],
    );

    // Default first: allowed, so nothing is being withheld.
    const visible = await profileOf(me!, them!);
    expect(visible?.contact_withheld).toBe(false);
    expect(visible?.payment_rail).toBe('upi');
    expect(visible?.payment_handle).toBe('priya@upi');
    expect(visible?.country_code).toBe('IN');

    await client.query(`UPDATE profiles SET contact_visibility = 'nobody' WHERE id = $1`, [them]);

    const row = await profileOf(me!, them!);
    expect(row?.contact_withheld).toBe(true);
    expect(row?.email).toBeNull();
    expect(row?.phone).toBeNull();
    expect(row?.payment_rail).toBeNull();
    expect(row?.payment_handle).toBeNull();
    expect(row?.country_code).toBeNull();
  });

  it('always shows you to yourself, whatever your own switch says', async () => {
    const group = await seedGroup(client, { memberCount: 1 });
    const me = group.profileIds[0]!;
    await client.query(
      `UPDATE profiles
          SET contact_visibility = 'nobody', payment_rail = 'bank', payment_handle = 'acct-123', country_code = 'IN'
        WHERE id = $1`,
      [me],
    );

    const row = await profileOf(me, me);

    expect(row?.is_you).toBe(true);
    // Your own setting is about other people, so nothing is withheld from you.
    expect(row?.contact_withheld).toBe(false);
    expect(row?.payment_rail).toBe('bank');
    expect(row?.payment_handle).toBe('acct-123');
    expect(row?.country_code).toBe('IN');
  });

  it('resolves a ghost by its membership id and says it is one', async () => {
    const group = await seedGroup(client, { memberCount: 1, ghostCount: 1 });
    const me = group.profileIds[0]!;
    const ghost = await client.query<{ id: string; ghost_name: string }>(
      `SELECT id, ghost_name FROM group_members
        WHERE group_id = $1 AND profile_id IS NULL LIMIT 1`,
      [group.groupId],
    );
    const ghostRow = ghost.rows[0]!;

    const row = await profileOf(me, ghostRow.id);

    expect(row?.is_ghost).toBe(true);
    expect(row?.display_name).toBe(ghostRow.ghost_name);
    // A ghost has no account, so there is no decision to report either way.
    expect(row?.contact_withheld).toBe(false);
  });
});

describe('waves_find_person', () => {
  it('finds nobody when there is no auth schema to search', async () => {
    const group = await seedGroup(client, { memberCount: 1 });
    const rows = await asUser(group.profileIds[0]!, async () => {
      const result = await client.query(`SELECT * FROM waves_find_person('email', $1)`, [
        'someone@example.com',
      ]);
      return result.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('refuses a channel it does not know', async () => {
    const group = await seedGroup(client, { memberCount: 1 });
    await expect(
      asUser(group.profileIds[0]!, () =>
        client.query(`SELECT * FROM waves_find_person('name', 'Priya')`),
      ),
    ).rejects.toThrow(/UNKNOWN_CHANNEL/);
  });

  it('does not spend a lookup on an input that cannot match', async () => {
    const group = await seedGroup(client, { memberCount: 1 });
    const me = group.profileIds[0]!;

    await asUser(me, () => client.query(`SELECT * FROM waves_find_person('phone', '12')`));
    await asUser(me, () => client.query(`SELECT * FROM waves_find_person('email', 'x')`));

    const counted = await client.query<{ lookups: string }>(
      `SELECT lookups FROM person_lookups WHERE profile_id = $1`,
      [me],
    );
    expect(counted.rows).toHaveLength(0);
  });

  it('counts misses and stops at the daily ceiling', async () => {
    const group = await seedGroup(client, { memberCount: 1 });
    const me = group.profileIds[0]!;

    await client.query(
      `INSERT INTO app_config (key, value, description) VALUES ('person_lookup_daily_cap', 2, 'test')
       ON CONFLICT (key) DO UPDATE SET value = 2`,
    );

    // Two misses are allowed, and both are counted — a sweep is made of misses.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await asUser(me, () =>
        client.query(`SELECT * FROM waves_find_person('email', $1)`, [
          `nobody${attempt}@example.com`,
        ]),
      );
    }

    const counted = await client.query<{ lookups: number }>(
      `SELECT lookups FROM person_lookups WHERE profile_id = $1`,
      [me],
    );
    expect(Number(counted.rows[0]?.lookups)).toBe(2);

    await expect(
      asUser(me, () =>
        client.query(`SELECT * FROM waves_find_person('email', 'one-too-many@example.com')`),
      ),
    ).rejects.toThrow(/LOOKUP_RATE_LIMIT/);

    await client.query(`UPDATE app_config SET value = 40 WHERE key = 'person_lookup_daily_cap'`);
  });
});
