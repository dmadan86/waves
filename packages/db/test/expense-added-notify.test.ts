/**
 * A new expense tells the people on it.
 *
 * `waves_apply_expense` writes one `expense_added` notification per person who
 * paid towards the bill or owes a share of it. As with the other taps, most of
 * the feature is in who is *not* told, and that is what is pinned here:
 *
 *   - the author is not told about their own bill;
 *   - a ghost, somebody who has left, and a zero share are not told;
 *   - a replay of the same mutation does not tell anyone twice;
 *   - an edit does not send `expense_added`;
 *   - an imported bill tells no one.
 *
 * Called on the owner connection with no JWT claims, the trusted path the edge
 * functions use: `waves_assert_expense_caller` steps aside when there is no
 * signed-in profile, and this file is about the notifications, not the check.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, seedGroup } from './helpers.js';

let client: Client;

beforeAll(async () => {
  client = await connect();
  await client.query(`RESET ROLE`);
  await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
});

afterAll(async () => {
  await client?.end();
});

interface Line {
  memberId: string;
  amount: bigint;
}

async function applyExpense(options: {
  groupId: string;
  authorMemberId: string;
  payers: Line[];
  shares: Line[];
  amount: bigint;
  expenseId?: string;
  mutationId?: string;
  source?: 'manual' | 'imported';
  description?: string;
}): Promise<string> {
  const lines = (list: Line[]) =>
    JSON.stringify(list.map((line) => ({ memberId: line.memberId, amount: String(line.amount) })));
  const { rows } = await client.query(
    `SELECT waves_apply_expense(
       $1::uuid, $2::uuid, $3::uuid, $4::text, NULL::text, '2026-09-24'::date, 'INR'::char(3),
       $5::bigint, 'exact'::text, '{"kind":"exact"}'::jsonb, $6::jsonb, $7::jsonb, $8::uuid,
       NULL::text, NULL::uuid, NULL::int, NULL::jsonb, $9::text
     ) AS result`,
    [
      options.groupId,
      options.expenseId ?? randomUUID(),
      options.authorMemberId,
      options.description ?? 'Dinner',
      String(options.amount),
      lines(options.payers),
      lines(options.shares),
      options.mutationId ?? randomUUID(),
      options.source ?? 'manual',
    ],
  );
  return String((rows[0].result as { expenseId: string }).expenseId);
}

async function addedFor(expenseId: string) {
  const { rows } = await client.query(
    `SELECT profile_id, title, deep_link, payload
       FROM notifications
      WHERE kind = 'expense_added' AND payload ->> 'expenseId' = $1
      ORDER BY profile_id`,
    [expenseId],
  );
  return rows as {
    profile_id: string;
    title: string;
    deep_link: string;
    payload: Record<string, string>;
  }[];
}

describe('expense_added', () => {
  it('tells everyone on a new bill except the person who added it', async () => {
    const { groupId, profileIds, memberIds } = await seedGroup(client, {
      memberCount: 3,
      name: 'Flat 4B',
    });
    const [author, second, third] = memberIds as [string, string, string];

    const expenseId = await applyExpense({
      groupId,
      authorMemberId: author,
      payers: [{ memberId: author, amount: 900n }],
      shares: [
        { memberId: author, amount: 300n },
        { memberId: second, amount: 300n },
        { memberId: third, amount: 300n },
      ],
      amount: 900n,
      description: 'Groceries',
    });

    const rows = await addedFor(expenseId);
    expect(rows.map((row) => row.profile_id).sort()).toEqual([profileIds[1], profileIds[2]].sort());
    for (const row of rows) {
      expect(row.title).toBe('Member 1 added an expense');
      expect(row.deep_link).toBe(`waves://group/${groupId}/expense/${expenseId}`);
      expect(row.payload).toMatchObject({
        counterparty: 'Member 1',
        group: 'Flat 4B',
        description: 'Groceries',
        amount: '900',
        currency: 'INR',
      });
    }
  });

  it('tells a payer who is not the author, even with no share', async () => {
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 2 });
    const [author, payer] = memberIds as [string, string];

    const expenseId = await applyExpense({
      groupId,
      authorMemberId: author,
      payers: [{ memberId: payer, amount: 500n }],
      shares: [{ memberId: author, amount: 500n }],
      amount: 500n,
    });

    expect((await addedFor(expenseId)).map((row) => row.profile_id)).toEqual([profileIds[1]]);
  });

  it('tells a member only once when they both paid and owe', async () => {
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 2 });
    const [author, other] = memberIds as [string, string];

    const expenseId = await applyExpense({
      groupId,
      authorMemberId: author,
      payers: [
        { memberId: author, amount: 300n },
        { memberId: other, amount: 300n },
      ],
      shares: [
        { memberId: author, amount: 300n },
        { memberId: other, amount: 300n },
      ],
      amount: 600n,
    });

    expect((await addedFor(expenseId)).map((row) => row.profile_id)).toEqual([profileIds[1]]);
  });

  it('does not tell a ghost, somebody who left, or a zero share', async () => {
    const { groupId, profileIds, memberIds } = await seedGroup(client, {
      memberCount: 4,
      ghostCount: 1,
    });
    const [author, stays, left, zero, ghost] = memberIds as [
      string,
      string,
      string,
      string,
      string,
    ];
    await client.query(`UPDATE group_members SET left_at = now() WHERE id = $1`, [left]);

    const expenseId = await applyExpense({
      groupId,
      authorMemberId: author,
      payers: [{ memberId: author, amount: 600n }],
      shares: [
        { memberId: author, amount: 200n },
        { memberId: stays, amount: 200n },
        { memberId: ghost, amount: 200n },
        { memberId: left, amount: 0n },
        { memberId: zero, amount: 0n },
      ],
      amount: 600n,
    });

    expect((await addedFor(expenseId)).map((row) => row.profile_id)).toEqual([profileIds[1]]);
  });

  it('does not tell anyone twice when the same mutation is replayed', async () => {
    const { groupId, memberIds } = await seedGroup(client, { memberCount: 2 });
    const [author, other] = memberIds as [string, string];
    const expenseId = randomUUID();
    const mutationId = randomUUID();
    const write = () =>
      applyExpense({
        groupId,
        authorMemberId: author,
        payers: [{ memberId: author, amount: 400n }],
        shares: [
          { memberId: author, amount: 200n },
          { memberId: other, amount: 200n },
        ],
        amount: 400n,
        expenseId,
        mutationId,
      });

    await write();
    await write();

    expect(await addedFor(expenseId)).toHaveLength(1);
  });

  it('does not send expense_added for an edit', async () => {
    const { groupId, memberIds } = await seedGroup(client, { memberCount: 2 });
    const [author, other] = memberIds as [string, string];
    const shares = [
      { memberId: author, amount: 200n },
      { memberId: other, amount: 200n },
    ];
    const expenseId = await applyExpense({
      groupId,
      authorMemberId: author,
      payers: [{ memberId: author, amount: 400n }],
      shares,
      amount: 400n,
    });

    // The other member edits it: a new version of an existing expense.
    await applyExpense({
      groupId,
      authorMemberId: other,
      payers: [{ memberId: author, amount: 400n }],
      shares,
      amount: 400n,
      expenseId,
      description: 'Dinner, corrected',
    });

    // Still only the one, sent to the other member when the bill was added.
    expect(await addedFor(expenseId)).toHaveLength(1);
  });

  it('tells no one about an imported bill', async () => {
    const { groupId, memberIds } = await seedGroup(client, { memberCount: 2 });
    const [author, other] = memberIds as [string, string];

    const expenseId = await applyExpense({
      groupId,
      authorMemberId: author,
      payers: [{ memberId: author, amount: 400n }],
      shares: [
        { memberId: author, amount: 200n },
        { memberId: other, amount: 200n },
      ],
      amount: 400n,
      source: 'imported',
    });

    expect(await addedFor(expenseId)).toHaveLength(0);
  });
});
