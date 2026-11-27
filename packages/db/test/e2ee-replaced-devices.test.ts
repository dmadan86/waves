/** A device superseded by a newer one of the same profile is treated as replaced after 3 days. */

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
    `UPDATE e2ee_devices SET last_seen_at = now() - make_interval(days => $2),
       created_at = now() - make_interval(days => $2 + 1) WHERE id = $1`,
    [id, days],
  );

const directory = async (profileId: string) =>
  (
    await as(profileId, () =>
      client.query(`SELECT device_id FROM waves_group_devices($1)`, [couple.groupId]),
    )
  ).rows.map((r) => r.device_id);

const send = (profileId: string, sender: string, to: string[]) =>
  as(profileId, () =>
    client.query(`SELECT waves_mailbox_send($1, $2, $3::jsonb) AS n`, [
      couple.groupId,
      sender,
      JSON.stringify(
        to.map((d) => ({ recipient_device: d, ciphertext: randomBytes(16).toString('base64') })),
      ),
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

describe('replaced e2ee devices', () => {
  it('drops an older unseen device once a newer sibling is live, and purges its rows', async () => {
    const [a, b] = couple.profileIds as [string, string];
    const da = await register(a);
    const oldB = await register(b);
    await send(a, da, [oldB]);
    await age(oldB, 4);
    const newB = await register(b);
    expect(await directory(a)).toEqual(expect.arrayContaining([da, newB]));
    expect(await directory(a)).not.toContain(oldB);
    await send(a, da, [oldB]);
    expect(await queued(oldB)).toBe(1); // the new send was skipped
    // The sibling's heartbeat clears what already piled up for the replaced one.
    await as(b, () => client.query(`SELECT waves_device_seen($1)`, [newB]));
    expect(await queued(oldB)).toBe(0);
  });

  it('keeps an older device that is the only one, or recent, or whose sibling is also idle', async () => {
    const [a, b] = couple.profileIds as [string, string];
    await register(a);
    const only = await register(b);
    await age(only, 10); // stale at 30d, not before: alone, so live
    expect(await directory(a)).toContain(only);
    const recent = await register(b);
    await age(only, 2);
    expect(await directory(a)).toEqual(expect.arrayContaining([only, recent]));
    await age(only, 5);
    await age(recent, 4); // both idle >3 days: nobody is "newer and live"
    expect(await directory(a)).toEqual(expect.arrayContaining([only, recent]));
  });

  it('tells a returning replaced device it was inactive', async () => {
    const [, b] = couple.profileIds as [string, string];
    const oldB = await register(b);
    await age(oldB, 5);
    await register(b);
    const r = await as(b, () => client.query(`SELECT waves_device_seen($1) AS s`, [oldB]));
    expect(r.rows[0].s).toBe(true);
  });
});
