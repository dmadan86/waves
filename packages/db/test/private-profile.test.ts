import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { asRole, connect, expectDenied, seedGroup } from './helpers.js';

let client: Client;
let group: Awaited<ReturnType<typeof seedGroup>>;
beforeAll(async () => {
  client = await connect();
  group = await seedGroup(client, { memberCount: 2 });
  await client.query(
    `UPDATE profiles SET address = 'Private home', notification_prefs = '{"push":false}' WHERE id = $1`,
    [group.profileIds[0]],
  );
});
afterAll(async () => {
  await client?.end();
});

describe('private profile columns', () => {
  it.each(['address', 'notification_prefs', '*'])(
    'denies a co-member selecting %s directly',
    async (column) => {
      await asRole(
        client,
        'authenticated',
        { sub: group.profileIds[1], role: 'authenticated' },
        async () => {
          expect(
            await expectDenied(
              client.query(`SELECT ${column} FROM profiles WHERE id = $1`, [group.profileIds[0]]),
            ),
          ).toMatch(/permission denied/i);
        },
      );
    },
  );
  it('lets the owner read private values through the RPC', async () => {
    await asRole(
      client,
      'authenticated',
      { sub: group.profileIds[0], role: 'authenticated' },
      async () => {
        const result = await client.query(
          'SELECT id, address, notification_prefs FROM waves_my_profile()',
        );
        expect(result.rows).toEqual([
          { id: group.profileIds[0], address: 'Private home', notification_prefs: { push: false } },
        ]);
      },
    );
  });
  it('does not expose another member through the RPC', async () => {
    await asRole(
      client,
      'authenticated',
      { sub: group.profileIds[1], role: 'authenticated' },
      async () => {
        const result = await client.query('SELECT id FROM waves_my_profile() WHERE id = $1', [
          group.profileIds[0],
        ]);
        expect(result.rowCount).toBe(0);
      },
    );
  });
});
