/**
 * Group settings and membership changes reach the activity feed
 * (20261024100000_group_changes_activity).
 *
 * Every path that moves a group setting is covered by the one trigger on
 * `groups`, so the tests go through the doors the app actually uses: a bare
 * UPDATE as `authenticated` (what `/sync`'s `group.update` and a member's
 * "leave" are), and the RPCs behind rates, the convert flag and membership.
 * What is pinned is what a reader would notice if it broke: the right row for
 * the right change, who did it, nothing for a bookkeeping write, nothing twice
 * for the archive cron, and a stamped `updated_seq` so the row syncs.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, seedGroup } from './helpers.js';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client?.end();
});

/** Session-scoped claims, so the writes survive the call and can be read back. */
async function asProfile<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  try {
    return await run();
  } finally {
    await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

/** The same, through PostgREST's role, for the bare table writes the app makes. */
async function asUser<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  return asProfile(profileId, async () => {
    await client.query(`SET ROLE authenticated`);
    try {
      return await run();
    } finally {
      await client.query(`RESET ROLE`);
    }
  });
}

interface Row {
  verb: string;
  object_type: string;
  object_id: string | null;
  actor_member_id: string | null;
  payload: Record<string, unknown>;
  updated_seq: string;
}

async function feed(groupId: string, verbs?: string[]): Promise<Row[]> {
  const { rows } = await client.query<Row>(
    `SELECT verb, object_type, object_id, actor_member_id, payload, updated_seq::text
       FROM activity_log
      WHERE group_id = $1 AND ($2::text[] IS NULL OR verb = ANY ($2))
      ORDER BY updated_seq, created_at`,
    [groupId, verbs ?? null],
  );
  return rows;
}

function id(value: string | undefined, what: string): string {
  if (!value) throw new Error(`the seed produced no ${what}`);
  return value;
}

describe('a setting changed through a plain UPDATE', () => {
  it('writes one group_updated row per field, with the actor and from/to', async () => {
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 2 });
    const admin = id(profileIds[0], 'admin');

    await asUser(admin, () =>
      client.query(`UPDATE groups SET name = 'Goa 2026' WHERE id = $1`, [groupId]),
    );

    const rows = await feed(groupId, ['group_updated']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      verb: 'group_updated',
      object_type: 'group',
      object_id: groupId,
      actor_member_id: memberIds[0],
      payload: { field: 'name', from: 'Goa trip', to: 'Goa 2026' },
    });
  });

  it('says nothing for a bookkeeping write', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 1 });
    const admin = id(profileIds[0], 'admin');
    const before = (await feed(groupId)).length;

    // The same value again, and the two columns the stamp triggers move.
    await asUser(admin, () =>
      client.query(`UPDATE groups SET name = name, time_zone = time_zone WHERE id = $1`, [groupId]),
    );
    await client.query(`UPDATE groups SET updated_seq = updated_seq + 1 WHERE id = $1`, [groupId]);
    await client.query(`UPDATE groups SET updated_at = now() WHERE id = $1`, [groupId]);

    expect((await feed(groupId)).length).toBe(before);
  });

  it('turns a multi-column patch into one row per thing the reader would notice', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 1 });
    const admin = id(profileIds[0], 'admin');

    // Type, both dates, the tag and all three cover columns in one PATCH (the
    // shape `/sync` sends from the settings screen).
    await asUser(admin, () =>
      client.query(
        `UPDATE groups
            SET type = 'home', start_date = '2026-10-21', end_date = '2026-10-23',
                custom_tag = 'Holiday', cover_emoji = '🏠', cover_color = 'mint'
          WHERE id = $1`,
        [groupId],
      ),
    );

    const rows = await feed(groupId, ['group_updated']);
    const fields = rows.map((row) => row.payload.field).sort();
    expect(fields).toEqual(['cover', 'dates', 'tag', 'type']);

    const dates = rows.find((row) => row.payload.field === 'dates')?.payload;
    expect(dates).toMatchObject({
      from: { start: null, end: null },
      to: { start: '2026-10-21', end: '2026-10-23' },
    });
    expect(rows.find((row) => row.payload.field === 'type')?.payload).toMatchObject({
      from: 'trip',
      to: 'home',
    });
    expect(rows.find((row) => row.payload.field === 'tag')?.payload).toMatchObject({
      from: null,
      to: 'Holiday',
    });
    expect(rows.find((row) => row.payload.field === 'cover')?.payload).toMatchObject({
      to: { emoji: '🏠', color: 'mint', photo: false },
    });
  });

  it('logs the simplify switch, the description and the currency', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 1 });
    const admin = id(profileIds[0], 'admin');

    await asUser(admin, () =>
      client.query(
        `UPDATE groups SET simplify_debts = false, description = 'Beach week' WHERE id = $1`,
        [groupId],
      ),
    );
    // No bills yet, so the currency is still free to change.
    await asUser(admin, () =>
      client.query(`UPDATE groups SET default_currency = 'USD' WHERE id = $1`, [groupId]),
    );

    const rows = await feed(groupId, ['group_updated']);
    expect(rows.map((row) => row.payload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'simplify', from: true, to: false }),
        expect.objectContaining({ field: 'description', from: null, to: 'Beach week' }),
        expect.objectContaining({ field: 'currency', from: 'INR', to: 'USD' }),
      ]),
    );
  });
});

describe('the archive', () => {
  it('is logged with the person who did it, and again when it is undone', async () => {
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 1 });
    const admin = id(profileIds[0], 'admin');

    await asUser(admin, () =>
      client.query(`UPDATE groups SET archived_at = now() WHERE id = $1`, [groupId]),
    );
    await asUser(admin, () =>
      client.query(`UPDATE groups SET archived_at = NULL WHERE id = $1`, [groupId]),
    );

    const rows = await feed(groupId, ['group_updated']);
    expect(rows.map((row) => row.payload)).toEqual([
      { field: 'archived', from: false, to: true },
      { field: 'archived', from: true, to: false },
    ]);
    expect(rows.every((row) => row.actor_member_id === memberIds[0])).toBe(true);
  });

  it('is not written twice when the cron archives a stale group', async () => {
    const { groupId } = await seedGroup(client, { memberCount: 1 });
    // Make it look eighteen months quiet, then run the job as the server does.
    await client.query(`UPDATE groups SET created_at = now() - interval '2 years' WHERE id = $1`, [
      groupId,
    ]);
    const { rows } = await client.query<{ n: number }>(
      `SELECT waves_auto_archive_stale_groups(now(), interval '1 year') AS n`,
    );
    expect(rows[0]?.n).toBeGreaterThanOrEqual(1);

    const after = await feed(groupId);
    expect(after.filter((row) => row.verb === 'auto_archived')).toHaveLength(1);
    expect(after.filter((row) => row.verb === 'group_updated')).toHaveLength(0);
  });
});

describe('currencies and rates', () => {
  it('logs a currency added, re-rated and removed through the rate RPC', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 1 });
    const admin = id(profileIds[0], 'admin');

    await asProfile(admin, async () => {
      await client.query(`SELECT waves_set_group_fx_rate($1, 'USD', 84, 1, 'manual')`, [groupId]);
      await client.query(`SELECT waves_set_group_fx_rate($1, 'USD', 85, 1, 'manual')`, [groupId]);
      // Same value again: a re-save is not a change.
      await client.query(`SELECT waves_set_group_fx_rate($1, 'USD', 85, 1, 'manual')`, [groupId]);
      await client.query(`SELECT waves_set_group_fx_rate($1, 'USD', NULL, NULL, 'manual')`, [
        groupId,
      ]);
    });

    const rows = await feed(groupId, ['group_updated']);
    expect(rows.map((row) => row.payload)).toEqual([
      expect.objectContaining({ field: 'fx', change: 'added', currency: 'USD' }),
      expect.objectContaining({
        field: 'fx',
        change: 'rate',
        currency: 'USD',
        from: { num: '84', den: '1' },
        to: { num: '85', den: '1' },
      }),
      expect.objectContaining({ field: 'fx', change: 'removed', currency: 'USD' }),
    ]);
  });

  it('logs the convert switch with the group currency it converts to', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 1 });
    const admin = id(profileIds[0], 'admin');

    await asProfile(admin, () =>
      client.query(`SELECT waves_set_group_convert($1, true)`, [groupId]),
    );

    const rows = await feed(groupId, ['group_updated']);
    expect(rows.map((row) => row.payload)).toEqual([
      { field: 'convert', from: false, to: true, currency: 'INR' },
    ]);
  });
});

describe('people', () => {
  it('logs a placeholder added by hand, naming them', async () => {
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 1 });
    const admin = id(profileIds[0], 'admin');

    await asProfile(admin, () =>
      client.query(`SELECT waves_add_ghost_member($1, 'Deepak', NULL, NULL, NULL)`, [groupId]),
    );

    const rows = await feed(groupId, ['member_added']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      object_type: 'member',
      actor_member_id: memberIds[0],
      payload: { name: 'Deepak', placeholder: true },
    });
  });

  it('does not log the seed creator, a join, or an imported placeholder', async () => {
    const { groupId } = await seedGroup(client, { memberCount: 2 });
    // A join link's membership is written with joined_via = 'invite_link';
    // invite-accept writes `joined` itself. An import batch's placeholder is
    // covered by that batch's one `imported` row.
    const { rows: joiner } = await client.query<{ id: string }>(
      `INSERT INTO profiles (id, display_name, default_currency)
       VALUES (gen_random_uuid(), 'Joiner', 'INR') RETURNING id`,
    );
    await client.query(
      `INSERT INTO group_members (group_id, profile_id, joined_via) VALUES ($1, $2, 'invite_link')`,
      [groupId, joiner[0]!.id],
    );
    const { rows: batch } = await client.query<{ id: string }>(
      `INSERT INTO import_batches (id, group_id, source) VALUES (gen_random_uuid(), $1, 'splitwise') RETURNING id`,
      [groupId],
    );
    await client.query(
      `INSERT INTO group_members (group_id, ghost_name, joined_via, import_batch_id)
       VALUES ($1, 'Imported Ghost', 'ghost', $2)`,
      [groupId, batch[0]!.id],
    );

    expect(await feed(groupId, ['member_added'])).toHaveLength(0);
  });

  it('logs a promotion and a demotion', async () => {
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 2 });
    const admin = id(profileIds[0], 'admin');
    const other = id(memberIds[1], 'member');

    await asProfile(admin, async () => {
      await client.query(`SELECT waves_set_member_role($1, 'admin')`, [other]);
      await client.query(`SELECT waves_set_member_role($1, 'member')`, [other]);
    });

    const rows = await feed(groupId, ['member_role_changed']);
    expect(rows.map((row) => row.payload)).toEqual([
      { name: 'Member 2', from: 'member', to: 'admin' },
      { name: 'Member 2', from: 'admin', to: 'member' },
    ]);
    expect(rows[0]?.actor_member_id).toBe(memberIds[0]);
    expect(rows[0]?.object_id).toBe(other);
  });

  it('tells a removal apart from somebody leaving, and credits the right person', async () => {
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 3 });
    const admin = id(profileIds[0], 'admin');
    const leaver = id(profileIds[1], 'leaver');

    await asProfile(admin, () =>
      client.query(`SELECT waves_remove_member($1)`, [id(memberIds[2], 'removed')]),
    );
    // Leaving is the app's own bare UPDATE of left_at.
    await asUser(leaver, () =>
      client.query(`UPDATE group_members SET left_at = now() WHERE id = $1`, [memberIds[1]]),
    );

    const removed = await feed(groupId, ['member_removed']);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({
      object_id: memberIds[2],
      actor_member_id: memberIds[0],
      payload: { name: 'Member 3' },
    });

    const left = await feed(groupId, ['member_left']);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({
      object_id: memberIds[1],
      actor_member_id: memberIds[1],
      payload: { name: 'Member 2' },
    });
  });
});

describe('sync', () => {
  it('stamps each row past the group cursor, so a pull after the change sees it', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 1 });
    const admin = id(profileIds[0], 'admin');
    const { rows: before } = await client.query<{ seq: string }>(
      `SELECT updated_seq::text AS seq FROM groups WHERE id = $1`,
      [groupId],
    );
    const cursor = BigInt(before[0]?.seq ?? '0');

    await asUser(admin, () =>
      client.query(`UPDATE groups SET name = 'Later' WHERE id = $1`, [groupId]),
    );

    const rows = await feed(groupId, ['group_updated']);
    expect(rows).toHaveLength(1);
    expect(BigInt(rows[0]!.updated_seq)).toBeGreaterThan(cursor);
    // And the group row itself was carried past the activity row's stamp, so a
    // client pulling by the group's cursor gets both.
    const { rows: after } = await client.query<{ seq: string }>(
      `SELECT updated_seq::text AS seq FROM groups WHERE id = $1`,
      [groupId],
    );
    expect(BigInt(after[0]!.seq)).toBeGreaterThanOrEqual(BigInt(rows[0]!.updated_seq));
  });

  it('says nothing about a group being deleted beyond group_deleted', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 1 });
    const admin = id(profileIds[0], 'admin');

    await asProfile(admin, () => client.query(`SELECT waves_delete_group($1)`, [groupId]));

    const rows = await feed(groupId);
    expect(rows.filter((row) => row.verb === 'group_updated')).toHaveLength(0);
    expect(rows.some((row) => row.verb === 'group_deleted')).toBe(true);
  });
});
