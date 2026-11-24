/**
 * Deleted groups are permanently erased after 30 days (waves_purge_deleted_groups).
 * The ledger tables forbid deletes (ADR-004), so these also pin that the purge
 * puts those guards back afterwards.
 */

import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { addEqualSplitExpense, connect, expectDenied, seedGroup } from './helpers.js';

let client: Client;

beforeAll(async () => {
  client = await connect();
  await client.query(
    readFileSync(
      new URL(
        '../prisma/migrations/20261219090000_purge_deleted_groups/migration.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
});

afterAll(async () => {
  await client?.end();
});

const addExpense = (g: { groupId: string; memberIds: string[] }) =>
  addEqualSplitExpense(client, {
    groupId: g.groupId,
    amount: 1000n,
    participants: [g.memberIds[0]!, g.memberIds[1]!],
    payers: { [g.memberIds[0]!]: 1000n },
  });

async function exists(groupId: string): Promise<boolean> {
  const { rowCount } = await client.query(`SELECT 1 FROM groups WHERE id = $1`, [groupId]);
  return rowCount === 1;
}

describe('waves_purge_deleted_groups', () => {
  it('erases a group deleted over 30 days ago with its expenses, and keeps newer ones', async () => {
    const old = await seedGroup(client);
    await addExpense(old);
    const recent = await seedGroup(client);
    const live = await seedGroup(client);
    await client.query(`UPDATE groups SET deleted_at = now() - interval '31 days' WHERE id = $1`, [
      old.groupId,
    ]);
    await client.query(`UPDATE groups SET deleted_at = now() - interval '5 days' WHERE id = $1`, [
      recent.groupId,
    ]);

    const { rows } = await client.query(`SELECT public.waves_purge_deleted_groups(100000) AS n`);
    expect(Number(rows[0].n)).toBeGreaterThanOrEqual(1);

    expect(await exists(old.groupId)).toBe(false);
    const expenses = await client.query(`SELECT 1 FROM expenses WHERE group_id = $1`, [
      old.groupId,
    ]);
    expect(expenses.rowCount).toBe(0);
    expect(await exists(recent.groupId)).toBe(true);
    expect(await exists(live.groupId)).toBe(true);
  });

  it('leaves the append-only guard on expenses enabled afterwards', async () => {
    const group = await seedGroup(client);
    await addExpense(group);
    await expectDenied(client.query(`DELETE FROM expenses WHERE group_id = $1`, [group.groupId]));
  });

  it('is service-role only', async () => {
    await client.query(`SET ROLE authenticated`);
    try {
      await expectDenied(client.query(`SELECT public.waves_purge_deleted_groups()`));
    } finally {
      await client.query(`RESET ROLE`);
    }
  });
});
