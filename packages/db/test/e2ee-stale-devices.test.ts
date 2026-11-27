/** Stale e2ee devices: not addressed, purged, and live again (with a resync flag) on return. */

import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, seedGroup, type SeededGroup } from './helpers';

let client: Client;
let couple: SeededGroup;

beforeAll(async () => {
  client = await connect();
});
afterAll(async () => {
  await client.end();
});
beforeEach(async () => {
  couple = await seedGroup(client, { memberCount: 2, name: 'Us' });
  await client.query(`UPDATE groups SET type = 'couple' WHERE id = $1`, [couple.groupId]);
});

async function as<T>(profileId: string, run: () => Promise<T>) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  await client.query('SET ROLE authenticated');
  try {
    return await run();
  } finally {
    await client.query('RESET ROLE');
    await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

const register = async (profileId: string): Promise<string> =>
  (
    await as(profileId, () =>
      client.query(`SELECT waves_register_device($1::bytea) AS id`, [randomBytes(32)]),
    )
  ).rows[0].id;

const age = (id: string, days: number) =>
  client.query(
    `UPDATE e2ee_devices SET last_seen_at = now() - make_interval(days => $2) WHERE id = $1`,
    [id, days],
  );

const directory = async (profileId: string) =>
  (
    await as(profileId, () =>
      client.query(`SELECT device_id FROM waves_group_devices($1)`, [couple.groupId]),
    )
  ).rows.map((r) => r.device_id);

const send = (profileId: string, sender: string, to: string) =>
  as(profileId, () =>
    client.query(`SELECT waves_mailbox_send($1, $2, $3::jsonb) AS n`, [
      couple.groupId,
      sender,
      JSON.stringify([{ recipient_device: to, ciphertext: randomBytes(16).toString('base64') }]),
    ]),
  );

const queued = async (device: string) =>
  Number(
    (
      await client.query(`SELECT count(*) n FROM group_mailbox WHERE recipient_device_id = $1`, [
        device,
      ])
    ).rows[0].n,
  );

describe('stale e2ee devices', () => {
  it('drops a device unseen for 30 days from the directory and from new mail, then purges its queue', async () => {
    const [a, b] = couple.profileIds as [string, string];
    const da = await register(a);
    const db = await register(b);
    await send(a, da, db);
    expect(await queued(db)).toBe(1);
    expect(await directory(a)).toContain(db);

    await age(db, 31);
    expect(await directory(a)).not.toContain(db);
    // A send from a cached directory does not fail and leaves nothing behind.
    await send(a, da, db);
    expect(await queued(db)).toBe(1);

    await client.query('SELECT waves_purge_mailbox()');
    expect(await queued(db)).toBe(0);
    // The device row (its key and id) is kept.
    expect(
      Number(
        (await client.query(`SELECT count(*) n FROM e2ee_devices WHERE id = $1`, [db])).rows[0].n,
      ),
    ).toBe(1);
  });

  it('waves_device_seen revives a stale device once and reports that it was stale', async () => {
    const [a, b] = couple.profileIds as [string, string];
    const da = await register(a);
    const db = await register(b);
    await age(db, 40);
    const seen = () =>
      as(b, () => client.query(`SELECT waves_device_seen($1) AS stale`, [db])).then(
        (r) => r.rows[0].stale,
      );
    expect(await seen()).toBe(true);
    expect(await seen()).toBe(false);
    expect(await directory(a)).toContain(db);
    await send(a, da, db);
    expect(await queued(db)).toBe(1);
    // Not someone else's device.
    const other = await as(a, () => client.query(`SELECT waves_device_seen($1) AS stale`, [db]));
    expect(other.rows[0].stale).toBe(false);
  });

  it('keeps functions closed to anon', async () => {
    for (const sig of [
      'waves_device_seen(uuid)',
      'waves_purge_mailbox()',
      'waves_mailbox_skip_stale()',
    ]) {
      const r = await client.query(`SELECT has_function_privilege('anon', $1, 'EXECUTE') AS ok`, [
        `public.${sig}`,
      ]);
      expect(r.rows[0].ok, sig).toBe(false);
    }
  });
});
