/**
 * A part payment is an ordinary settlement for less. Its notice and its
 * activity row say what was owed, so it reads "paid 2,000 of 5,000".
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Client } from 'pg';

import { addEqualSplitExpense, connect, seedGroup } from './helpers.js';

let client: Client;
beforeAll(async () => {
  client = await connect();
});
afterAll(async () => {
  await client?.end();
});

async function recordAs(profileId: string, args: unknown[]): Promise<void> {
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  try {
    await client.query(
      `SELECT waves_record_settlement($1, $2, $3, $4, 'upi', 'INR', NULL, '[]'::jsonb, $5, 'upi')`,
      args,
    );
  } finally {
    await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

it('records less than owed and tells the payee how much of what', async () => {
  const g = await seedGroup(client, { memberCount: 2 });
  const [a, b] = g.memberIds as [string, string];
  // b pays 10,000 for two: a owes b 5,000.
  await addEqualSplitExpense(client, {
    groupId: g.groupId,
    payers: { [b]: 1_000_000n },
    participants: [a, b],
    amount: 1_000_000n,
  });

  await recordAs(g.profileIds[0] as string, [g.groupId, a, b, 200_000, randomUUID()]);

  const { rows: notices } = await client.query(
    `SELECT payload FROM notifications WHERE group_id = $1 AND kind = 'settlement_confirm_request'`,
    [g.groupId],
  );
  expect(notices).toHaveLength(1);
  expect(notices[0].payload).toMatchObject({ amount: '200000', owed: '500000' });
  const { rows: log } = await client.query(
    `SELECT payload FROM activity_log WHERE group_id = $1 AND verb = 'settled'`,
    [g.groupId],
  );
  expect(log[0].payload).toMatchObject({ amount: 200000, owed: '500000' });

  // A payment in full carries no `owed`.
  await recordAs(g.profileIds[0] as string, [g.groupId, a, b, 500_000, randomUUID()]);
  const { rows: full } = await client.query(
    `SELECT payload FROM activity_log WHERE group_id = $1 AND verb = 'settled' AND (payload->>'amount')::bigint = 500000`,
    [g.groupId],
  );
  expect(full[0].payload.owed).toBeUndefined();
});
