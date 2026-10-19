/**
 * "Work expense (to claim)" (`expense_versions.reimbursable`).
 *
 * `waves_apply_expense` takes `p_reimbursable` as its LAST, defaulted
 * parameter. An app build or edge function that predates it calls without it,
 * so:
 *   • a create with no flag stores false;
 *   • an edit with no flag carries the previous version's forward (an old
 *     phone editing the amount must not wipe it);
 *   • an edit with false clears it; an edit with true sets it;
 *   • the column is NOT NULL, and the old function signature is gone, so there
 *     is exactly one overload.
 * Access is the table's existing row-level policy: members read their group's
 * versions, and nobody can write one except through the SECURITY DEFINER RPC.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, seedGroup } from './helpers.js';

let client: Client;

async function apply(params: {
  groupId: string;
  author: string;
  other: string;
  expenseId?: string | null;
  reimbursable?: boolean | null;
  /** Leave the argument out entirely, as an old caller does. */
  omit?: boolean;
}): Promise<{ expenseId: string; versionNo: number }> {
  const withFlag = !params.omit;
  const { rows } = await client.query(
    `SELECT waves_apply_expense(
        p_group_id           := $1,
        p_expense_id         := $2,
        p_author_member_id   := $3,
        p_description        := 'Cab',
        p_category           := NULL,
        p_expense_date       := '2026-10-01'::date,
        p_currency           := 'INR',
        p_amount             := 1000,
        p_split_type         := 'equal',
        p_split_params       := '{"kind":"equal"}'::jsonb,
        p_payers             := $4::jsonb,
        p_shares             := $5::jsonb,
        p_client_mutation_id := $6
        ${withFlag ? ', p_reimbursable := $7' : ''}
      ) AS out`,
    [
      params.groupId,
      params.expenseId ?? null,
      params.author,
      JSON.stringify([{ memberId: params.author, amount: '1000' }]),
      JSON.stringify([
        { memberId: params.author, amount: '500' },
        { memberId: params.other, amount: '500' },
      ]),
      randomUUID(),
      ...(withFlag ? [params.reimbursable ?? null] : []),
    ],
  );
  return rows[0].out as { expenseId: string; versionNo: number };
}

async function flag(expenseId: string, versionNo: number): Promise<boolean | undefined> {
  const { rows } = await client.query(
    `SELECT reimbursable FROM expense_versions WHERE expense_id = $1 AND version_no = $2`,
    [expenseId, versionNo],
  );
  return rows[0]?.reimbursable as boolean | undefined;
}

async function pair(): Promise<{ groupId: string; a: string; b: string; profile: string }> {
  const { groupId, memberIds, profileIds } = await seedGroup(client, {
    memberCount: 2,
    name: 'Work trip',
  });
  const [a, b] = memberIds as [string, string];
  return { groupId, a, b, profile: profileIds[0]! };
}

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client?.end();
});

describe('expense work tag (reimbursable)', () => {
  it('replaced the previous signature rather than overloading it', async () => {
    const { rows } = await client.query(
      `SELECT to_regprocedure(
         'public.waves_apply_expense(uuid, uuid, uuid, text, text, date, character, bigint, text, jsonb, jsonb, jsonb, uuid, text, uuid, integer, jsonb, text, text, text, jsonb, jsonb, text, boolean, bigint, date, timestamptz, text, uuid)'
       ) AS old_sig,
       (SELECT count(*) FROM pg_proc WHERE proname = 'waves_apply_expense')::int AS overloads`,
    );
    expect(rows[0].old_sig).toBeNull();
    expect(rows[0].overloads).toBe(1);
  });

  it('is a NOT NULL boolean that defaults to false for a plain insert', async () => {
    const { rows } = await client.query(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'expense_versions' AND column_name = 'reimbursable'`,
    );
    expect(rows[0]).toEqual({
      data_type: 'boolean',
      is_nullable: 'NO',
      column_default: 'false',
    });
  });

  it('stores true when sent, false when not sent or sent as false', async () => {
    const { groupId, a, b } = await pair();
    const on = await apply({ groupId, author: a, other: b, reimbursable: true });
    expect(await flag(on.expenseId, 1)).toBe(true);
    const old = await apply({ groupId, author: a, other: b, omit: true });
    expect(await flag(old.expenseId, 1)).toBe(false);
    const off = await apply({ groupId, author: a, other: b, reimbursable: false });
    expect(await flag(off.expenseId, 1)).toBe(false);
    const nul = await apply({ groupId, author: a, other: b, reimbursable: null });
    expect(await flag(nul.expenseId, 1)).toBe(false);
  });

  it('carries the flag forward when an older client edits without it', async () => {
    const { groupId, a, b } = await pair();
    const created = await apply({ groupId, author: a, other: b, reimbursable: true });
    const edit = await apply({
      groupId,
      author: a,
      other: b,
      expenseId: created.expenseId,
      omit: true,
    });
    expect(edit.versionNo).toBe(2);
    expect(await flag(created.expenseId, 2)).toBe(true);
    // NULL ("not sent") is the same as leaving it out.
    await apply({
      groupId,
      author: a,
      other: b,
      expenseId: created.expenseId,
      reimbursable: null,
    });
    expect(await flag(created.expenseId, 3)).toBe(true);
  });

  it('switches it on and off on an edit, and keeps the old versions as they were', async () => {
    const { groupId, a, b } = await pair();
    const created = await apply({ groupId, author: a, other: b });
    await apply({
      groupId,
      author: a,
      other: b,
      expenseId: created.expenseId,
      reimbursable: true,
    });
    await apply({
      groupId,
      author: a,
      other: b,
      expenseId: created.expenseId,
      reimbursable: false,
    });
    expect(await flag(created.expenseId, 1)).toBe(false);
    expect(await flag(created.expenseId, 2)).toBe(true);
    expect(await flag(created.expenseId, 3)).toBe(false);
  });

  it('is covered by the same row policy as its neighbours: a member reads it, an outsider does not, and nobody inserts directly', async () => {
    const { groupId, a, b, profile } = await pair();
    const created = await apply({ groupId, author: a, other: b, reimbursable: true });
    const outsider = randomUUID();
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL ROLE authenticated');
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: profile, role: 'authenticated' }),
      ]);
      const mine = await client.query(
        `SELECT reimbursable FROM expense_versions WHERE expense_id = $1`,
        [created.expenseId],
      );
      expect(mine.rows).toEqual([{ reimbursable: true }]);

      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: outsider, role: 'authenticated' }),
      ]);
      const theirs = await client.query(
        `SELECT reimbursable FROM expense_versions WHERE expense_id = $1`,
        [created.expenseId],
      );
      expect(theirs.rows).toEqual([]);

      await client.query('SAVEPOINT direct');
      await expect(
        client.query(
          `INSERT INTO expense_versions
             (expense_id, version_no, author_member_id, description, expense_date, currency,
              amount, split_type, split_params, reimbursable)
           VALUES ($1, 99, $2, 'x', '2026-10-01', 'INR', 0, 'equal', '{"kind":"equal"}', true)`,
          [created.expenseId, a],
        ),
      ).rejects.toThrow();
      await client.query('ROLLBACK TO SAVEPOINT direct');
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('leaves the ledger import untouched: imported rows are not reimbursable', async () => {
    const { groupId, a, profile } = await pair();
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: profile }),
      ]);
      await client.query(
        `SELECT waves_import_ledger($1, $2::jsonb, $3::jsonb, '[]'::jsonb, 'test')`,
        [
          groupId,
          JSON.stringify([{ name: 'Me', memberId: a }, { name: 'Lodger' }]),
          JSON.stringify([
            {
              description: 'Milk',
              date: '2026-09-01',
              currency: 'INR',
              amount: '1000',
              payers: { Me: '1000' },
              shares: { Me: '500', Lodger: '500' },
              clientMutationId: randomUUID(),
            },
          ]),
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    const { rows } = await client.query(
      `SELECT ev.reimbursable
         FROM expense_versions ev JOIN expenses e ON e.id = ev.expense_id
        WHERE e.group_id = $1`,
      [groupId],
    );
    expect(rows).toEqual([{ reimbursable: false }]);
  });
});
