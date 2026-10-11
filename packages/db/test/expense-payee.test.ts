/**
 * "Paid to" (`expense_versions.payee`).
 *
 * `waves_apply_expense` takes `p_payee` as its LAST, defaulted parameter. An
 * app build or edge function that predates it calls without it, so:
 *   • a create with no payee stores NULL;
 *   • an edit with no payee carries the previous version's forward (an old
 *     phone editing the amount must not wipe it);
 *   • an edit with '' clears it; an edit with text replaces it;
 *   • it is stored trimmed, and anything over 80 characters is refused.
 * The ledger import passes a row's `payee` through. And there must be exactly
 * one overload of the RPC, or old callers hit "not unique".
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
  payee?: string | null;
  /** Leave the argument out entirely, as an old caller does. */
  omitPayee?: boolean;
}): Promise<{ expenseId: string; versionNo: number }> {
  const withPayee = !params.omitPayee;
  const { rows } = await client.query(
    `SELECT waves_apply_expense(
        p_group_id           := $1,
        p_expense_id         := $2,
        p_author_member_id   := $3,
        p_description        := 'Rent',
        p_category           := NULL,
        p_expense_date       := '2026-10-01'::date,
        p_currency           := 'INR',
        p_amount             := 1000,
        p_split_type         := 'equal',
        p_split_params       := '{"kind":"equal"}'::jsonb,
        p_payers             := $4::jsonb,
        p_shares             := $5::jsonb,
        p_client_mutation_id := $6
        ${withPayee ? ', p_payee := $7' : ''}
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
      ...(withPayee ? [params.payee ?? null] : []),
    ],
  );
  return rows[0].out as { expenseId: string; versionNo: number };
}

async function payee(expenseId: string, versionNo: number): Promise<string | null> {
  const { rows } = await client.query(
    `SELECT payee FROM expense_versions WHERE expense_id = $1 AND version_no = $2`,
    [expenseId, versionNo],
  );
  return (rows[0]?.payee as string | null | undefined) ?? null;
}

async function pair(): Promise<{ groupId: string; a: string; b: string; profile: string }> {
  const { groupId, memberIds, profileIds } = await seedGroup(client, {
    memberCount: 2,
    name: 'Home',
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

describe('expense payee ("Paid to")', () => {
  it('replaced the previous signature rather than overloading it', async () => {
    const { rows } = await client.query(
      `SELECT to_regprocedure(
         'public.waves_apply_expense(uuid, uuid, uuid, text, text, date, character, bigint, text, jsonb, jsonb, jsonb, uuid, text, uuid, integer, jsonb, text, text, text, jsonb, jsonb, text, boolean, bigint, date, timestamptz)'
       ) AS old_sig,
       (SELECT count(*) FROM pg_proc WHERE proname = 'waves_apply_expense')::int AS overloads`,
    );
    expect(rows[0].old_sig).toBeNull();
    expect(rows[0].overloads).toBe(1);
  });

  it('stores the payee on the version, trimmed', async () => {
    const { groupId, a, b } = await pair();
    const created = await apply({ groupId, author: a, other: b, payee: '  Car   rental ' });
    expect(await payee(created.expenseId, 1)).toBe('Car rental');
  });

  it('stores NULL for an old client that sends none, and for a blank one', async () => {
    const { groupId, a, b } = await pair();
    const old = await apply({ groupId, author: a, other: b, omitPayee: true });
    expect(await payee(old.expenseId, 1)).toBeNull();
    const blank = await apply({ groupId, author: a, other: b, payee: '   ' });
    expect(await payee(blank.expenseId, 1)).toBeNull();
  });

  it('refuses a payee over 80 characters, and keeps one of exactly 80', async () => {
    const { groupId, a, b } = await pair();
    await expect(apply({ groupId, author: a, other: b, payee: 'x'.repeat(81) })).rejects.toThrow(
      /expense_versions_payee_check/,
    );
    const ok = await apply({ groupId, author: a, other: b, payee: 'y'.repeat(80) });
    expect(await payee(ok.expenseId, 1)).toBe('y'.repeat(80));
  });

  it('refuses a raw insert that is blank or padded (the CHECK)', async () => {
    const { groupId, a, b } = await pair();
    const created = await apply({ groupId, author: a, other: b, payee: 'Landlord' });
    for (const bad of ['', ' Landlord']) {
      await expect(
        client.query(
          `INSERT INTO expense_versions
             (expense_id, version_no, author_member_id, description, expense_date, currency,
              amount, split_type, split_params, payee)
           VALUES ($1, 99, $2, 'x', '2026-10-01', 'INR', 0, 'equal', '{"kind":"equal"}', $3)`,
          [created.expenseId, a, bad],
        ),
      ).rejects.toThrow(/expense_versions_payee_check/);
    }
  });

  it('carries the payee forward when an older client edits without it', async () => {
    const { groupId, a, b } = await pair();
    const created = await apply({ groupId, author: a, other: b, payee: 'Landlord' });
    const edit = await apply({
      groupId,
      author: a,
      other: b,
      expenseId: created.expenseId,
      omitPayee: true,
    });
    expect(edit.versionNo).toBe(2);
    expect(await payee(created.expenseId, 2)).toBe('Landlord');
  });

  it("replaces it on an edit, clears it with '', and keeps the old versions", async () => {
    const { groupId, a, b } = await pair();
    const created = await apply({ groupId, author: a, other: b, payee: 'Landlord' });
    await apply({ groupId, author: a, other: b, expenseId: created.expenseId, payee: 'Maid' });
    await apply({ groupId, author: a, other: b, expenseId: created.expenseId, payee: '' });
    expect(await payee(created.expenseId, 1)).toBe('Landlord');
    expect(await payee(created.expenseId, 2)).toBe('Maid');
    expect(await payee(created.expenseId, 3)).toBeNull();
  });

  it('passes a payee through the ledger import, and none when the file has none', async () => {
    const { groupId, a, profile } = await pair();
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: profile }),
      ]);
      const expense = (description: string, extra: Record<string, unknown> = {}) => ({
        description,
        date: '2026-09-01',
        currency: 'INR',
        amount: '1000',
        payers: { Me: '1000' },
        shares: { Me: '500', Lodger: '500' },
        clientMutationId: randomUUID(),
        ...extra,
      });
      await client.query(
        `SELECT waves_import_ledger($1, $2::jsonb, $3::jsonb, '[]'::jsonb, 'test')`,
        [
          groupId,
          JSON.stringify([{ name: 'Me', memberId: a }, { name: 'Lodger' }]),
          JSON.stringify([expense('Books', { payee: 'Book rental' }), expense('Milk')]),
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    const { rows } = await client.query(
      `SELECT ev.description, ev.payee
         FROM expense_versions ev JOIN expenses e ON e.id = ev.expense_id
        WHERE e.group_id = $1 ORDER BY ev.description`,
      [groupId],
    );
    expect(rows).toEqual([
      { description: 'Books', payee: 'Book rental' },
      { description: 'Milk', payee: null },
    ]);
  });
});
