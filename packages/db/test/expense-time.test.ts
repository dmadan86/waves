/**
 * Editable time-of-day (`expense_versions.occurred_at`).
 *
 * `waves_apply_expense` takes `p_occurred_at` as its LAST, defaulted parameter.
 * An app build or edge function that predates it calls without it, so:
 *   • a create with no time stores NULL;
 *   • an edit with no time carries the previous version's time forward (it must
 *     not wipe it), unless the edit moved the day;
 *   • an edit with a time stores the new one.
 * And there must be exactly one overload, or old callers hit "not unique".
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
  date?: string;
  occurredAt?: string | null;
  /** Leave the argument out entirely, as an old caller does. */
  omitOccurredAt?: boolean;
}): Promise<{ expenseId: string; versionNo: number }> {
  const withTime = !params.omitOccurredAt;
  const { rows } = await client.query(
    `SELECT waves_apply_expense(
        p_group_id           := $1,
        p_expense_id         := $2,
        p_author_member_id   := $3,
        p_description        := 'Dinner',
        p_category           := NULL,
        p_expense_date       := $4::date,
        p_currency           := 'INR',
        p_amount             := 1000,
        p_split_type         := 'equal',
        p_split_params       := '{"kind":"equal"}'::jsonb,
        p_payers             := $5::jsonb,
        p_shares             := $6::jsonb,
        p_client_mutation_id := $7
        ${withTime ? ', p_occurred_at := $8::timestamptz' : ''}
      ) AS out`,
    [
      params.groupId,
      params.expenseId ?? null,
      params.author,
      params.date ?? '2026-03-01',
      JSON.stringify([{ memberId: params.author, amount: '1000' }]),
      JSON.stringify([
        { memberId: params.author, amount: '500' },
        { memberId: params.other, amount: '500' },
      ]),
      randomUUID(),
      ...(withTime ? [params.occurredAt ?? null] : []),
    ],
  );
  return rows[0].out as { expenseId: string; versionNo: number };
}

async function occurredAt(expenseId: string, versionNo: number): Promise<string | null> {
  const { rows } = await client.query(
    `SELECT occurred_at FROM expense_versions WHERE expense_id = $1 AND version_no = $2`,
    [expenseId, versionNo],
  );
  const value = rows[0]?.occurred_at as Date | null | undefined;
  return value ? value.toISOString() : null;
}

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client?.end();
});

describe('expense occurred_at', () => {
  it('replaced the previous signature rather than overloading it', async () => {
    const { rows } = await client.query(
      `SELECT to_regprocedure(
         'public.waves_apply_expense(uuid, uuid, uuid, text, text, date, character, bigint, text, jsonb, jsonb, jsonb, uuid, text, uuid, integer, jsonb, text, text, text, jsonb, jsonb, text, boolean, bigint, date)'
       ) AS old_sig`,
    );
    expect(rows[0].old_sig).toBeNull();
  });

  it('stores the time on a create, and NULL when none is sent', async () => {
    const { groupId, memberIds } = await seedGroup(client, { memberCount: 2 });
    const [a, b] = memberIds as [string, string];
    const withTime = await apply({
      groupId,
      author: a,
      other: b,
      occurredAt: '2026-03-01T14:30:00Z',
    });
    expect(await occurredAt(withTime.expenseId, 1)).toBe('2026-03-01T14:30:00.000Z');

    const old = await apply({ groupId, author: a, other: b, omitOccurredAt: true });
    expect(await occurredAt(old.expenseId, 1)).toBeNull();
  });

  it('carries the time forward when an older client edits without it', async () => {
    const { groupId, memberIds } = await seedGroup(client, { memberCount: 2 });
    const [a, b] = memberIds as [string, string];
    const created = await apply({
      groupId,
      author: a,
      other: b,
      occurredAt: '2026-03-01T14:30:00Z',
    });
    const edit = await apply({
      groupId,
      author: a,
      other: b,
      expenseId: created.expenseId,
      omitOccurredAt: true,
    });
    expect(edit.versionNo).toBe(2);
    expect(await occurredAt(created.expenseId, 2)).toBe('2026-03-01T14:30:00.000Z');
  });

  it('does not carry the time onto a different day', async () => {
    const { groupId, memberIds } = await seedGroup(client, { memberCount: 2 });
    const [a, b] = memberIds as [string, string];
    const created = await apply({
      groupId,
      author: a,
      other: b,
      occurredAt: '2026-03-01T14:30:00Z',
    });
    await apply({
      groupId,
      author: a,
      other: b,
      expenseId: created.expenseId,
      date: '2026-03-02',
      omitOccurredAt: true,
    });
    expect(await occurredAt(created.expenseId, 2)).toBeNull();
  });

  it('stores a new time on an edit', async () => {
    const { groupId, memberIds } = await seedGroup(client, { memberCount: 2 });
    const [a, b] = memberIds as [string, string];
    const created = await apply({
      groupId,
      author: a,
      other: b,
      occurredAt: '2026-03-01T14:30:00Z',
    });
    await apply({
      groupId,
      author: a,
      other: b,
      expenseId: created.expenseId,
      occurredAt: '2026-03-01T20:05:00Z',
    });
    expect(await occurredAt(created.expenseId, 2)).toBe('2026-03-01T20:05:00.000Z');
    expect(await occurredAt(created.expenseId, 1)).toBe('2026-03-01T14:30:00.000Z');
  });
});
