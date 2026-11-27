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

async function recordAs(
  db: Client,
  profileId: string,
  groupId: string,
  fromId: string,
  toId: string,
  amount: number,
  mutationId: string,
  allocations: Array<{ expenseId: string; amount: number }> = [],
  currency = 'INR',
): Promise<string> {
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  try {
    const { rows } = await db.query(
      `SELECT waves_record_settlement($1, $2, $3, $4, 'upi', $5, NULL, $6::jsonb, $7, 'upi') AS id`,
      [groupId, fromId, toId, amount, currency, JSON.stringify(allocations), mutationId],
    );
    return rows[0].id as string;
  } finally {
    await db.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

async function expense(groupId: string, members: string[], currency = 'INR') {
  return addEqualSplitExpense(client, {
    groupId,
    payers: { [members[0] as string]: 10_000n },
    participants: members,
    amount: 10_000n,
    currency,
  });
}

it('rejects allocations to another group, deleted expenses, and wrong currency; accepts valid ones', async () => {
  const g = await seedGroup(client, { memberCount: 2 });
  const other = await seedGroup(client, { memberCount: 2 });
  const [a, b] = g.memberIds as [string, string];
  const [oa, ob] = other.memberIds as [string, string];
  const foreign = await expense(other.groupId, [oa, ob]);
  const deleted = await expense(g.groupId, [a, b]);
  const wrongCurrency = await expense(g.groupId, [a, b], 'USD');
  const valid = await expense(g.groupId, [a, b]);
  const record = (allocExpenseId: string, mutationId = randomUUID()) =>
    recordAs(client, g.profileIds[0] as string, g.groupId, a, b, 10_000, mutationId, [
      { expenseId: allocExpenseId, amount: 1_000 },
    ]);

  await expect(record(foreign.expenseId)).rejects.toThrow('INVALID_ALLOCATION');
  await client.query(`UPDATE expenses SET deleted_at = now() WHERE id = $1`, [deleted.expenseId]);
  await expect(record(deleted.expenseId)).rejects.toThrow('INVALID_ALLOCATION');
  await expect(record(wrongCurrency.expenseId)).rejects.toThrow('INVALID_ALLOCATION');
  const validId = await record(valid.expenseId);
  expect(validId).toBeTruthy();
});

it('blocks direct cross-group settlement allocations with the database trigger', async () => {
  const g = await seedGroup(client, { memberCount: 2 });
  const other = await seedGroup(client, { memberCount: 2 });
  const [a, b] = g.memberIds as [string, string];
  const [oa, ob] = other.memberIds as [string, string];
  const foreign = await expense(other.groupId, [oa, ob]);
  const settlementId = await recordAs(
    client,
    g.profileIds[0] as string,
    g.groupId,
    a,
    b,
    10_000,
    randomUUID(),
  );
  await expect(
    client.query(
      `INSERT INTO settlement_allocations (settlement_id, expense_id, amount) VALUES ($1, $2, 1)`,
      [settlementId, foreign.expenseId],
    ),
  ).rejects.toThrow('INVALID_ALLOCATION');
});

it('makes retries idempotent, rejects changed or cross-group requests, and handles concurrent duplicates', async () => {
  const g = await seedGroup(client, { memberCount: 2 });
  const other = await seedGroup(client, { memberCount: 2 });
  const [a, b] = g.memberIds as [string, string];
  const [oa, ob] = other.memberIds as [string, string];
  const mutationId = randomUUID();
  const first = await recordAs(client, g.profileIds[0] as string, g.groupId, a, b, 100, mutationId);
  const retry = await recordAs(client, g.profileIds[0] as string, g.groupId, a, b, 100, mutationId);
  expect(retry).toBe(first);
  await expect(
    recordAs(client, g.profileIds[0] as string, g.groupId, a, b, 101, mutationId),
  ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
  await expect(
    recordAs(client, other.profileIds[0] as string, other.groupId, oa, ob, 100, mutationId),
  ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
  const counts = await client.query(
    `SELECT (SELECT count(*) FROM settlements WHERE client_mutation_id = $1) AS settlements,
            (SELECT count(*) FROM activity_log WHERE object_id = $2 AND verb = 'settled') AS activities`,
    [mutationId, first],
  );
  expect(counts.rows[0]).toMatchObject({ settlements: '1', activities: '1' });

  const concurrentKey = randomUUID();
  const clients = await Promise.all([connect(), connect()]);
  try {
    const results = await Promise.all(
      clients.map((db) =>
        recordAs(db, g.profileIds[0] as string, g.groupId, a, b, 200, concurrentKey),
      ),
    );
    expect(results[0]).toBe(results[1]);
  } finally {
    await Promise.all(clients.map((db) => db.end()));
  }
  const concurrentCount = await client.query(
    `SELECT count(*) FROM settlements WHERE client_mutation_id = $1`,
    [concurrentKey],
  );
  expect(concurrentCount.rows[0].count).toBe('1');
});

it('stores activity amount as an uppercase currency string and omits owed when there is no direct debt', async () => {
  const g = await seedGroup(client, { memberCount: 2 });
  const [a, b] = g.memberIds as [string, string];
  const id = await recordAs(
    client,
    g.profileIds[0] as string,
    g.groupId,
    a,
    b,
    250,
    randomUUID(),
    [],
    'inr',
  );
  const { rows } = await client.query(
    `SELECT payload FROM activity_log WHERE object_id = $1 AND verb = 'settled'`,
    [id],
  );
  expect(rows[0].payload.amount).toBe('250');
  expect(rows[0].payload.currency).toBe('INR');
  expect(rows[0].payload.owed).toBeUndefined();
});
