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

const replace = (profileId: string, oldId: string, newId: string) =>
  as(profileId, () => client.query(`SELECT waves_replace_device($1, $2)`, [oldId, newId]));

describe('replaced e2ee devices', () => {
  it('a new id from the same install replaces the old one: not addressed, rows purged', async () => {
    const [a, b] = couple.profileIds as [string, string];
    const da = await register(a);
    const oldB = await register(b);
    await send(a, da, [oldB]);
    expect(await queued(oldB)).toBe(1);
    const newB = await register(b);
    expect(await directory(a)).toEqual(expect.arrayContaining([oldB, newB])); // not yet declared
    await replace(b, oldB, newB);
    expect(await queued(oldB)).toBe(0);
    expect(await directory(a)).toEqual(expect.arrayContaining([da, newB]));
    expect(await directory(a)).not.toContain(oldB);
    await send(a, da, [oldB]);
    expect(await queued(oldB)).toBe(0); // skipped
  });

  it('keeps a real second device (phone + tablet used weekly) however long it is idle under 30 days', async () => {
    const [a, b] = couple.profileIds as [string, string];
    await register(a);
    const phone = await register(b);
    const tablet = await register(b);
    await age(tablet, 10);
    await age(phone, 0);
    expect(await directory(a)).toEqual(expect.arrayContaining([phone, tablet]));
  });

  it('only the owner can replace, and only with a device of their own', async () => {
    const [a, b] = couple.profileIds as [string, string];
    const da = await register(a);
    const oldB = await register(b);
    const newB = await register(b);
    await expect(replace(b, oldB, da)).rejects.toThrow();
    await replace(a, oldB, da); // not a's device: no effect
    expect(await directory(a)).toContain(oldB);
    await replace(b, oldB, newB);
    expect(await directory(a)).not.toContain(oldB);
  });

  it('a returning replaced device is told so and is live again', async () => {
    const [a, b] = couple.profileIds as [string, string];
    await register(a);
    const oldB = await register(b);
    const newB = await register(b);
    await replace(b, oldB, newB);
    const r = await as(b, () => client.query(`SELECT waves_device_seen($1) AS s`, [oldB]));
    expect(r.rows[0].s).toBe(true);
    expect(await directory(a)).toContain(oldB);
    const again = await as(b, () => client.query(`SELECT waves_device_seen($1) AS s`, [oldB]));
    expect(again.rows[0].s).toBe(false);
  });
});
