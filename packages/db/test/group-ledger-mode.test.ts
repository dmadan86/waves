/** `groups.ledger_mode` through a direct write: default, check, admin-only. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, expectDenied, seedGroup } from './helpers.js';

let client: Client;
beforeAll(async () => {
  client = await connect();
});
afterAll(async () => {
  await client?.end();
});

async function setMode(profileId: string, groupId: string, mode: string) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  await client.query(`SET ROLE authenticated`);
  try {
    return await client.query(`UPDATE groups SET ledger_mode = $1 WHERE id = $2`, [mode, groupId]);
  } finally {
    await client.query(`RESET ROLE`);
    await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

describe('groups.ledger_mode', () => {
  it('defaults to split and lets an admin switch to pool', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 2 });
    const before = await client.query(`SELECT ledger_mode FROM groups WHERE id = $1`, [groupId]);
    expect(before.rows[0].ledger_mode).toBe('split');
    await setMode(profileIds[0]!, groupId, 'pool');
    const after = await client.query(`SELECT ledger_mode FROM groups WHERE id = $1`, [groupId]);
    expect(after.rows[0].ledger_mode).toBe('pool');
  });

  it('refuses a non-admin member and an unknown value', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 2 });
    await expectDenied(setMode(profileIds[1]!, groupId, 'pool'));
    await expect(setMode(profileIds[0]!, groupId, 'bogus')).rejects.toThrow();
  });
});
