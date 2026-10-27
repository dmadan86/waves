/** Departed shares move as one transaction; undo never overwrites later work. */
import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, expectDenied, readTruth, seedGroup } from './helpers.js';
import type { SeededGroup } from './helpers.js';

let client: Client;
beforeAll(async () => {
  client = await connect();
});
afterAll(async () => {
  await client?.end();
});
beforeEach(async () => {
  await client.query('BEGIN');
});
afterEach(async () => {
  await client.query('ROLLBACK');
});

// A rejected RPC must leave the outer rollback fixture usable. A savepoint
// restores both its writes and its role/claims on failure.
async function asUser(profileId: string | null, sql: string, values: unknown[] = []) {
  await client.query('SAVEPOINT rpc_call');
  try {
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: profileId, role: profileId ? 'authenticated' : 'anon' }),
    ]);
    await client.query(profileId ? 'SET LOCAL ROLE authenticated' : 'SET LOCAL ROLE anon');
    const result = await client.query(sql, values);
    await client.query('RESET ROLE');
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
    await client.query('RELEASE SAVEPOINT rpc_call');
    return result;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT rpc_call');
    await client.query('RELEASE SAVEPOINT rpc_call');
    throw error;
  }
}

interface Item {
  expense_id: string;
  base_version_no: number;
  split_type: string;
  split_params: { kind: string };
  shares: { member_id: string; amount_minor: string }[];
}
interface Batch {
  batchId: string;
  count: number;
  amount: string;
  replayed: boolean;
}

async function addExpense(g: SeededGroup, payers = [{ memberId: g.memberIds[0], amount: '3000' }]) {
  // Unlike addEqualSplitExpense (which commits its own fixture), this uses the
  // canonical write and stays inside this test's rollback transaction.
  const { rows } = await client.query(
    `SELECT waves_apply_expense(
    p_group_id => $1, p_expense_id => $2, p_author_member_id => $3,
    p_description => 'Dinner', p_category => NULL, p_expense_date => '2026-10-01',
    p_currency => 'INR', p_amount => 3000, p_split_type => 'equal',
    p_split_params => '{"kind":"equal"}', p_payers => $4::jsonb,
    p_shares => $5::jsonb, p_client_mutation_id => $6,
    p_notes => 'Keep this note', p_payee => 'Cafe', p_reimbursable => true,
    p_occurred_at => '2026-10-01T12:00:00Z'
  ) AS result`,
    [
      g.groupId,
      randomUUID(),
      g.memberIds[0],
      JSON.stringify(payers),
      JSON.stringify(g.memberIds.map((memberId) => ({ memberId, amount: '1000' }))),
      randomUUID(),
    ],
  );
  return rows[0].result as { expenseId: string; versionId: string };
}
function item(g: SeededGroup, expenseId: string, baseVersionNo = 1): Item {
  return {
    expense_id: expenseId,
    base_version_no: baseVersionNo,
    split_type: 'equal',
    split_params: { kind: 'equal' },
    shares: [g.memberIds[0]!, g.memberIds[2]!].map((id) => ({
      member_id: id,
      amount_minor: '1500',
    })),
  };
}
async function fixture(departed = true) {
  const g = await seedGroup(client, { memberCount: 3 });
  const expense = await addExpense(g);
  if (departed) await asUser(g.profileIds[0]!, 'SELECT waves_remove_member($1)', [g.memberIds[1]]);
  return { g, expense, items: [item(g, expense.expenseId)] };
}
async function resplit(
  g: SeededGroup,
  items: Item[],
  mutationId = randomUUID(),
  profileId = g.profileIds[0]!,
) {
  const { rows } = await asUser(
    profileId,
    'SELECT waves_resplit_departed($1, $2, $3::jsonb, $4) AS result',
    [g.groupId, g.memberIds[1], JSON.stringify(items), mutationId],
  );
  return rows[0].result as Batch;
}
async function undo(g: SeededGroup, batchId: string, profileId = g.profileIds[0]!) {
  const { rows } = await asUser(profileId, 'SELECT waves_undo_resplit($1) AS result', [batchId]);
  return rows[0].result as { restored: number; skipped: number };
}
async function current(expenseId: string) {
  const { rows } = await client.query(
    `SELECT v.* FROM expenses e
    JOIN expense_versions v ON v.id = e.current_version_id WHERE e.id = $1`,
    [expenseId],
  );
  return rows[0];
}
async function shares(expenseId: string) {
  const { rows } = await client.query(
    `SELECT s.member_id, s.amount FROM expenses e
    JOIN expense_shares s ON s.expense_version_id = e.current_version_id
    WHERE e.id = $1 ORDER BY s.member_id`,
    [expenseId],
  );
  return rows;
}
async function edit(g: SeededGroup, expenseId: string) {
  // A genuine later edit through the same apply path, without batch context.
  const { rows } = await client.query(
    `SELECT waves_apply_resplit_version(
    $1, $2, 'equal', '{"kind":"equal"}', $3::jsonb) AS result`,
    [
      (await current(expenseId)).id,
      g.memberIds[0],
      JSON.stringify(g.memberIds.map((memberId) => ({ memberId, amount: '1000' }))),
    ],
  );
  return rows[0].result as { versionId: string };
}

describe('departed member re-split', () => {
  it('requires an admin of this group for both RPCs', async () => {
    const { g, items } = await fixture();
    const outsider = await seedGroup(client, { memberCount: 1 });
    for (const profile of [g.profileIds[2]!, g.profileIds[1]!, outsider.profileIds[0]!]) {
      expect(await expectDenied(resplit(g, items, randomUUID(), profile))).toMatch(/NOT_ADMIN/);
    }
    const batch = await resplit(g, items);
    expect(await expectDenied(undo(g, batch.batchId, g.profileIds[2]!))).toMatch(/NOT_ADMIN/);
    expect(
      await expectDenied(asUser(null, 'SELECT waves_undo_resplit($1)', [batch.batchId])),
    ).toMatch(/permission denied/);
  });

  it('requires the member to have left', async () => {
    const { g, items } = await fixture(false);
    expect(await expectDenied(resplit(g, items))).toMatch(/MEMBER_NOT_DEPARTED/);
  });

  it('accepts a voluntary departure too', async () => {
    const { g, items } = await fixture(false);
    await client.query('UPDATE group_members SET left_at = now() WHERE id = $1', [g.memberIds[1]]);
    expect((await resplit(g, items)).count).toBe(1);
  });

  for (const coPayer of [false, true]) {
    it(`refuses an expense the departed person ${coPayer ? 'co-paid' : 'paid'}`, async () => {
      const { g } = await fixture();
      const expense = await addExpense(
        g,
        coPayer
          ? [
              { memberId: g.memberIds[0], amount: '1500' },
              { memberId: g.memberIds[1], amount: '1500' },
            ]
          : [{ memberId: g.memberIds[1], amount: '3000' }],
      );
      expect(await expectDenied(resplit(g, [item(g, expense.expenseId)]))).toMatch(
        /DEPARTED_PAYER/,
      );
      expect((await current(expense.expenseId)).version_no).toBe(1);
    });
  }

  it('preserves expense sums, moves the departed shares, and writes one activity and notice', async () => {
    const { g, expense, items } = await fixture();
    const second = await addExpense(g);
    const batch = await resplit(g, [...items, item(g, second.expenseId)]);
    expect(batch).toMatchObject({ count: 2, amount: '2000', replayed: false });
    for (const id of [expense.expenseId, second.expenseId]) {
      const v = await current(id);
      expect(v.resplit_batch_id).toBe(batch.batchId);
      expect(v.amount).toBe('3000');
      expect(v).toMatchObject({
        description: 'Dinner',
        notes: 'Keep this note',
        payee: 'Cafe',
        reimbursable: true,
      });
      expect(new Date(v.occurred_at).toISOString()).toBe('2026-10-01T12:00:00.000Z');
      const { rows: payers } = await client.query(
        `SELECT member_id, amount FROM expense_payers WHERE expense_version_id = $1`,
        [v.id],
      );
      expect(payers).toEqual([{ member_id: g.memberIds[0], amount: '3000' }]);
      const rows = await shares(id);
      expect(rows.map((s) => s.member_id)).not.toContain(g.memberIds[1]);
      expect(rows.reduce((sum, s) => sum + BigInt(s.amount), 0n)).toBe(3000n);
    }
    expect((await readTruth(client, g.groupId)).get(g.memberIds[1]!)).toBeUndefined();
    const { rows: activity } = await client.query(
      `SELECT verb, payload FROM activity_log
      WHERE group_id = $1 AND (verb = 'resplit' OR verb = 'edited')`,
      [g.groupId],
    );
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      verb: 'resplit',
      payload: {
        name: 'Member 2',
        count: 2,
        amount: '2000',
        batchId: batch.batchId,
      },
    });
    const { rows: notices } = await client.query(
      `SELECT profile_id, payload FROM notifications
      WHERE group_id = $1 AND kind = 'resplit'`,
      [g.groupId],
    );
    expect(notices).toEqual([
      {
        profile_id: g.profileIds[1],
        payload: {
          counterparty: 'Member 1',
          group: 'Goa trip',
          count: '2',
          amount: '0',
          currency: 'INR',
          batchId: batch.batchId,
        },
      },
    ]);
  });

  it('replays the same batch without new versions, activity or notifications, even after undo', async () => {
    const { g, expense, items } = await fixture();
    const mutation = randomUUID();
    const first = await resplit(g, items, mutation);
    expect(await resplit(g, items, mutation)).toEqual({ ...first, replayed: true });
    expect((await current(expense.expenseId)).version_no).toBe(2);
    await undo(g, first.batchId);
    expect(await resplit(g, items, mutation)).toEqual({ ...first, replayed: true });
    expect((await current(expense.expenseId)).version_no).toBe(3);
    for (const table of ['resplit_batches', 'notifications']) {
      const { rows } = await client.query(
        `SELECT count(*)::int AS count FROM ${table}
        WHERE group_id = $1${table === 'notifications' ? " AND kind = 'resplit'" : ''}`,
        [g.groupId],
      );
      expect(rows[0].count).toBe(1);
    }
  });

  it('rejects a mutation id reused for a different member or group', async () => {
    const first = await fixture();
    const second = await fixture();
    const mutation = randomUUID();
    await resplit(first.g, first.items, mutation);
    expect(await expectDenied(resplit(second.g, second.items, mutation))).toMatch(/BATCH_CONFLICT/);
  });

  it('rolls the entire batch back when a later item has a stale base', async () => {
    const { g, expense, items } = await fixture();
    const second = await addExpense(g);
    await edit(g, second.expenseId);
    const before = await readTruth(client, g.groupId);
    expect(await expectDenied(resplit(g, [...items, item(g, second.expenseId)]))).toMatch(
      /STALE_VERSION/,
    );
    expect((await current(expense.expenseId)).version_no).toBe(1);
    expect((await current(second.expenseId)).version_no).toBe(2);
    expect(await readTruth(client, g.groupId)).toEqual(before);
    const { rows } = await client.query(
      `SELECT
      (SELECT count(*)::int FROM resplit_batches WHERE group_id = $1) AS batches,
      (SELECT count(*)::int FROM notifications WHERE group_id = $1 AND kind = 'resplit') AS notices`,
      [g.groupId],
    );
    expect(rows[0]).toEqual({ batches: 0, notices: 0 });
  });

  it('refuses wrong share totals and duplicate or departed recipients', async () => {
    const { g, items } = await fixture();
    for (const invalidShares of [
      [{ member_id: g.memberIds[0]!, amount_minor: '2999' }],
      [
        { member_id: g.memberIds[0]!, amount_minor: '1500' },
        { member_id: g.memberIds[0]!, amount_minor: '1500' },
      ],
      [{ member_id: g.memberIds[1]!, amount_minor: '3000' }],
    ]) {
      expect(await expectDenied(resplit(g, [{ ...items[0]!, shares: invalidShares }]))).toMatch(
        /INVALID_SHARES/,
      );
    }
  });

  it('undo restores the original split and balances by appending a version', async () => {
    const { g, expense, items } = await fixture();
    const before = await shares(expense.expenseId);
    const balances = await readTruth(client, g.groupId);
    const batch = await resplit(g, items);
    expect(await undo(g, batch.batchId)).toEqual({ restored: 1, skipped: 0 });
    expect(await shares(expense.expenseId)).toEqual(before);
    expect(await readTruth(client, g.groupId)).toEqual(balances);
    expect(await current(expense.expenseId)).toMatchObject({
      version_no: 3,
      resplit_batch_id: null,
    });
    const { rows } = await client.query(`SELECT undone_at FROM resplit_batches WHERE id = $1`, [
      batch.batchId,
    ]);
    expect(rows[0].undone_at).not.toBeNull();
    expect(await undo(g, batch.batchId)).toEqual({ restored: 0, skipped: 0 });
    const { rows: activity } = await client.query(
      `SELECT verb FROM activity_log
      WHERE object_id = $1 ORDER BY verb`,
      [batch.batchId],
    );
    expect(activity).toEqual([{ verb: 'resplit' }, { verb: 'resplit_undone' }]);
  });

  it('undo skips later edits while restoring untouched expenses', async () => {
    const { g, expense, items } = await fixture();
    const second = await addExpense(g);
    const batch = await resplit(g, [...items, item(g, second.expenseId)]);
    const later = await edit(g, second.expenseId);
    expect(await undo(g, batch.batchId)).toEqual({ restored: 1, skipped: 1 });
    expect((await current(second.expenseId)).id).toBe(later.versionId);
    expect((await current(expense.expenseId)).version_no).toBe(3);
  });

  it('refuses undo after seven days without changing a version', async () => {
    const { g, expense, items } = await fixture();
    const batch = await resplit(g, items);
    await client.query(
      `UPDATE resplit_batches SET created_at = now() - interval '7 days 1 second' WHERE id = $1`,
      [batch.batchId],
    );
    expect(await expectDenied(undo(g, batch.batchId))).toMatch(/RESPLIT_UNDO_EXPIRED/);
    expect((await current(expense.expenseId)).version_no).toBe(2);
  });

  it('uses the push and email preferences', async () => {
    const { g, items } = await fixture();
    await client.query(
      `UPDATE profiles SET notification_prefs = '{"involvesMe":false,"email":false}' WHERE id = $1`,
      [g.profileIds[1]],
    );
    const batch = await resplit(g, items);
    expect(
      (await client.query(`SELECT waves_pref_key_for_kind('resplit') AS key`)).rows[0].key,
    ).toBe('involvesMe');
    await client.query('SELECT waves_claim_push_notifications(10000)');
    await client.query('SELECT waves_claim_email_notifications(10000)');
    const { rows } = await client.query(
      `SELECT push_status, email_status FROM notifications
      WHERE kind = 'resplit' AND payload->>'batchId' = $1`,
      [batch.batchId],
    );
    expect(rows).toEqual([{ push_status: 'suppressed', email_status: 'suppressed' }]);
  });
});
