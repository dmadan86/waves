/**
 * A Free account may start ten groups; Pro has no ceiling.
 *
 * What is pinned: the eleventh create is refused with FREE_GROUP_LIMIT and the
 * tenth is not; a paid row lifts the ceiling; a pair (two live members) and a
 * deleted group do not count while an archived one does; joining somebody
 * else's groups never counts; the direct-insert door is shut too; and
 * `waves_my_group_cap` reports the same numbers the refusal is based on.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect } from './helpers';

let client: Client;

beforeAll(async () => {
  client = await connect();
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

async function person(name: string): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO profiles (id, display_name, default_currency) VALUES ($1, $2, 'INR')`,
    [id, name],
  );
  return id;
}

/** Create a group through the RPC, as the person would. */
async function create(owner: string, name = 'Trip'): Promise<string> {
  return asUser(owner, async () => {
    const { rows } = await client.query(
      `SELECT waves_create_group($1, 'trip', 'INR', NULL, true, NULL, NULL, NULL, NULL) AS id`,
      [name],
    );
    return String(rows[0].id);
  });
}

async function expectRefused(owner: string): Promise<void> {
  await expect(create(owner, 'One too many')).rejects.toThrow(/FREE_GROUP_LIMIT/);
}

async function createMany(owner: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1)
    ids.push(await create(owner, `Group ${index + 1}`));
  return ids;
}

async function cap(owner: string): Promise<Record<string, unknown>> {
  return asUser(owner, async () => {
    const { rows } = await client.query(`SELECT waves_my_group_cap() AS cap`);
    return rows[0].cap as Record<string, unknown>;
  });
}

async function addGhost(groupId: string, name: string): Promise<void> {
  await client.query(
    `INSERT INTO group_members (id, group_id, ghost_name, joined_via) VALUES ($1, $2, $3, 'ghost')`,
    [randomUUID(), groupId, name],
  );
}

async function grantPro(profileId: string): Promise<void> {
  await client.query(
    `INSERT INTO subscriptions (profile_id, tier, period, status, current_period_end, store)
     VALUES ($1, 'pro', 'monthly', 'active', now() + interval '30 days', 'play')`,
    [profileId],
  );
}

describe('the Free ceiling on starting groups', () => {
  it('is ten: the tenth create succeeds, the eleventh is refused by name', async () => {
    const me = await person('Free Fiona');
    const ids = await createMany(me, 10);
    expect(ids).toHaveLength(10);

    await expectRefused(me);

    const status = await cap(me);
    expect(status).toMatchObject({ limit: 10, created: 10, paid: false, canCreate: false });
  });

  it('counts what the status reports, so a screen can stop before the form', async () => {
    const me = await person('Counting Carl');
    expect(await cap(me)).toMatchObject({ limit: 10, created: 0, paid: false, canCreate: true });
    await createMany(me, 3);
    expect(await cap(me)).toMatchObject({ created: 3, canCreate: true });
  });

  it('does not apply to Pro', async () => {
    const me = await person('Paid Priya');
    await grantPro(me);
    const ids = await createMany(me, 11);
    expect(ids).toHaveLength(11);
    expect(await cap(me)).toMatchObject({ paid: true, canCreate: true });
  });

  it('lifts the moment a Free account at the ceiling pays', async () => {
    const me = await person('Upgrading Uma');
    await createMany(me, 10);
    await expectRefused(me);
    await grantPro(me);
    await expect(create(me, 'Eleventh')).resolves.toBeTruthy();
  });

  it('leaves pairs out: a group of exactly two live members is the one-to-one ledger', async () => {
    const me = await person('Pairing Pat');
    const ids = await createMany(me, 10);
    // Turn three of them into pairs (me + one ghost): they stop counting.
    for (const id of ids.slice(0, 3)) await addGhost(id, 'Friend');
    expect(await cap(me)).toMatchObject({ created: 7, canCreate: true });
    await expect(create(me, 'Room for more')).resolves.toBeTruthy();

    // A third member makes it a group again.
    await addGhost(ids[0]!, 'Another');
    expect(await cap(me)).toMatchObject({ created: 9 });
  });

  it('leaves a deleted group out and keeps an archived one', async () => {
    const me = await person('Archiving Ana');
    const ids = await createMany(me, 10);
    await expectRefused(me);

    await client.query(`UPDATE groups SET archived_at = now() WHERE id = $1`, [ids[0]]);
    expect(await cap(me)).toMatchObject({ created: 10, canCreate: false });
    await expectRefused(me);

    await client.query(`UPDATE groups SET deleted_at = now() WHERE id = $1`, [ids[1]]);
    expect(await cap(me)).toMatchObject({ created: 9, canCreate: true });
    await expect(create(me, 'After a delete')).resolves.toBeTruthy();
  });

  it('never counts the groups somebody else started, however many I am in', async () => {
    const me = await person('Joining Jo');
    const host = await person('Hosting Hal');
    await grantPro(host);
    const theirs = await createMany(host, 12);
    for (const id of theirs) {
      await client.query(
        `INSERT INTO group_members (id, group_id, profile_id, role, joined_via)
         VALUES ($1, $2, $3, 'member', 'link')`,
        [randomUUID(), id, me],
      );
    }
    expect(await cap(me)).toMatchObject({ created: 0, canCreate: true });
    await expect(create(me, 'My own')).resolves.toBeTruthy();
  });

  it('shuts the direct-insert door an edited client could try', async () => {
    const me = await person('Direct Dan');
    await createMany(me, 10);
    await expect(
      asUser(me, () =>
        client.query(
          `INSERT INTO groups (id, name, type, default_currency, created_by)
           VALUES ($1, 'Sneaky', 'other', 'INR', $2)`,
          [randomUUID(), me],
        ),
      ),
    ).rejects.toThrow(/FREE_GROUP_LIMIT/);
  });

  it('reads the ceiling from app_config, so it can be tuned without a release', async () => {
    const me = await person('Tuned Tia');
    await createMany(me, 2);
    await client.query(`UPDATE app_config SET value = 2 WHERE key = 'free_group_cap'`);
    try {
      await expectRefused(me);
      expect(await cap(me)).toMatchObject({ limit: 2, created: 2, canCreate: false });
    } finally {
      await client.query(`UPDATE app_config SET value = 10 WHERE key = 'free_group_cap'`);
    }
    await expect(create(me, 'Back to ten')).resolves.toBeTruthy();
  });
});
