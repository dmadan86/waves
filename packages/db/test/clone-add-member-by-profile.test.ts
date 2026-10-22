/**
 * Duplicating a group keeps the people who are on Waves as themselves.
 *
 * The clone re-adds each source member through `waves_add_ghost_member`. A
 * member who joined the source by link has no address on their row, so by
 * name alone the copy got a "Not on Waves yet" placeholder of a person who is
 * on Waves. `p_profile_id` names the account instead. What is pinned:
 *
 *   - a co-member named by profile joins the copy as themselves, once, and is
 *     told (`group_added`) — the same tap a contact match gets;
 *   - a placeholder from the source stays a placeholder with its address;
 *   - a profile the caller shares no group with is ignored (a ghost, no tap):
 *     the argument is not a door to strangers, nor an oracle for ids;
 *   - someone who left or was removed from the copy is not walked back in;
 *   - naming yourself returns your own row;
 *   - the old five-argument shape still resolves (the overload was replaced,
 *     not duplicated).
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

/** A real account: a profile with an `auth.users` row (unique address). */
async function person(name: string): Promise<string> {
  const id = randomUUID();
  await client.query(`INSERT INTO profiles (id, display_name) VALUES ($1, $2)`, [id, name]);
  await client.query(
    `INSERT INTO auth.users (id, email, phone, email_confirmed_at) VALUES ($1, $2, $3, now())`,
    [id, `${name.toLowerCase()}.${id.slice(0, 8)}@example.com`, null],
  );
  return id;
}

async function group(owner: string, name = 'Goa'): Promise<string> {
  return asUser(owner, async () => {
    const { rows } = await client.query(
      `SELECT waves_create_group($1, 'trip', 'INR', NULL, true, NULL, NULL) AS id`,
      [name],
    );
    return String(rows[0].id);
  });
}

/** A real, active member who came in by link: no address on the row. */
async function join(groupId: string, profileId: string): Promise<void> {
  await client.query(
    `INSERT INTO group_members (group_id, profile_id, joined_via) VALUES ($1, $2, 'invite_link')`,
    [groupId, profileId],
  );
}

async function add(
  caller: string,
  groupId: string,
  fields: { name: string; email?: string | null; profileId?: string | null },
): Promise<{
  id: string;
  profile_id: string | null;
  ghost_name: string | null;
  joined_via: string | null;
  invite_email: string | null;
}> {
  const id = await asUser(caller, async () => {
    const { rows } = await client.query(
      `SELECT waves_add_ghost_member(
         p_group_id => $1::uuid, p_name => $2::text, p_email => $3::text, p_profile_id => $4::uuid
       ) AS id`,
      [groupId, fields.name, fields.email ?? null, fields.profileId ?? null],
    );
    return String(rows[0].id);
  });
  const { rows } = await client.query(
    `SELECT id, profile_id, ghost_name, joined_via, invite_email FROM group_members WHERE id = $1`,
    [id],
  );
  return rows[0];
}

async function taps(profileId: string, groupId: string): Promise<number> {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM notifications
      WHERE profile_id = $1 AND group_id = $2 AND kind = 'group_added'`,
    [profileId, groupId],
  );
  return rows[0].n;
}

describe('duplicating a group: members named by account', () => {
  it('re-adds a co-member on Waves as themselves, a placeholder as a placeholder', async () => {
    const madan = await person('Madan');
    const matt = await person('Matt');
    const source = await group(madan);
    await join(source, matt);
    const copy = await group(madan, 'Goa copy');

    // What the clone sends for the source's two non-creator members: Matt by
    // profile (no address on his row), Renny by name and address.
    const asMatt = await add(madan, copy, { name: 'Matt', profileId: matt });
    const asRenny = await add(madan, copy, { name: 'Renny', email: 'renny@example.com' });

    expect(asMatt).toMatchObject({ profile_id: matt, ghost_name: null, joined_via: 'contact' });
    expect(asRenny).toMatchObject({
      profile_id: null,
      ghost_name: 'Renny',
      joined_via: 'ghost',
      invite_email: 'renny@example.com',
    });
    expect(await taps(matt, copy)).toBe(1);

    // The offline replay or a double tap: the same row, one tap.
    const again = await add(madan, copy, { name: 'Matt', profileId: matt });
    expect(again.id).toBe(asMatt.id);
    expect(await taps(matt, copy)).toBe(1);
  });

  it('ignores a profile the caller shares no group with', async () => {
    const madan = await person('Madan');
    const stranger = await person('Sam');
    const copy = await group(madan);

    const row = await add(madan, copy, { name: 'Sam', profileId: stranger });

    expect(row).toMatchObject({ profile_id: null, ghost_name: 'Sam' });
    expect(await taps(stranger, copy)).toBe(0);
  });

  it('does not walk back in someone who left the copy', async () => {
    const madan = await person('Madan');
    const matt = await person('Matt');
    const source = await group(madan);
    await join(source, matt);
    const copy = await group(madan, 'Goa copy');
    await client.query(
      `INSERT INTO group_members (group_id, profile_id, joined_via, left_at)
       VALUES ($1, $2, 'invite_link', now())`,
      [copy, matt],
    );

    const row = await add(madan, copy, { name: 'Matt', profileId: matt });

    expect(row).toMatchObject({ profile_id: null, ghost_name: 'Matt' });
    expect(await taps(matt, copy)).toBe(0);
  });

  it('answers your own row for yourself', async () => {
    const madan = await person('Madan');
    const copy = await group(madan);

    const row = await add(madan, copy, { name: 'Madan', profileId: madan });

    expect(row.profile_id).toBe(madan);
    expect(await taps(madan, copy)).toBe(0);
  });

  it('still resolves the five-argument call every other caller makes', async () => {
    const madan = await person('Madan');
    const copy = await group(madan);

    const id = await asUser(madan, async () => {
      const { rows } = await client.query(
        `SELECT waves_add_ghost_member($1::uuid, 'Ravi', NULL::uuid, NULL::text, NULL::text) AS id`,
        [copy],
      );
      return String(rows[0].id);
    });
    const { rows } = await client.query(`SELECT ghost_name FROM group_members WHERE id = $1`, [id]);
    expect(rows[0].ghost_name).toBe('Ravi');
  });
});
