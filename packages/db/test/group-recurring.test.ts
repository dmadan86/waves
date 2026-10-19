/**
 * Recurring group expenses: the rent that posts itself.
 *
 * What is pinned here is the thing that is easy to get wrong and expensive to get
 * wrong in shared money — that one occurrence becomes exactly one expense, however
 * many times, from however many places, the generator is asked.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, expectDenied, seedGroup, type SeededGroup } from './helpers';

let client: Client;
let group: SeededGroup;
let other: SeededGroup;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client.end();
});

// A fresh group per test: expenses are append-only, so a shared group would
// carry every earlier test's rent into the next one's assertions.
beforeEach(async () => {
  group = await seedGroup(client, { memberCount: 3, name: 'Flat 4B' });
  other = await seedGroup(client, { memberCount: 1, name: 'Elsewhere' });
});

async function as<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  await client.query('SET ROLE authenticated');
  try {
    return await run();
  } finally {
    await client.query('RESET ROLE');
    await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

const [alice, bob, cara] = [0, 1, 2] as const;

/** 90 000 rent, paid by Alice, split three ways. */
async function createRule(
  options: {
    by?: number;
    id?: string;
    anchor?: string;
    cadence?: string;
    interval?: number;
    secondDay?: number | null;
    end?: string | null;
    amount?: string;
    description?: string;
  } = {},
): Promise<string> {
  const id = options.id ?? randomUUID();
  const amount = options.amount ?? '90000';
  const third = (BigInt(amount) / 3n).toString();
  await as(group.profileIds[options.by ?? alice]!, () =>
    client.query(
      `SELECT waves_create_group_recurring_expense(
         $1, $2, $3, NULL, 'INR', $4, 'equal', '{"kind":"equal"}'::jsonb,
         $5::jsonb, $6::jsonb, NULL, $7, $8, $9, $10::date, $11::date)`,
      [
        group.groupId,
        id,
        options.description ?? 'Rent',
        amount,
        JSON.stringify([{ memberId: group.memberIds[alice], amount }]),
        JSON.stringify(group.memberIds.map((m) => ({ memberId: m, amount: third }))),
        options.cadence ?? 'monthly',
        options.interval ?? 1,
        options.secondDay ?? null,
        options.anchor ?? '2026-11-01',
        options.end ?? null,
      ],
    ),
  );
  return id;
}

const generate = async (now: string, groupId: string | null = group.groupId) => {
  const { rows } = await client.query(
    `SELECT waves_generate_recurring_expenses($1::timestamptz, $2) AS r`,
    [now, groupId],
  );
  return rows[0].r as { generated: number; replayed: number; failed: number };
};

const expenseDates = async (description = 'Rent'): Promise<string[]> => {
  const { rows } = await client.query(
    `SELECT to_char(v.expense_date, 'YYYY-MM-DD') AS d
       FROM expenses e JOIN expense_versions v ON v.id = e.current_version_id
      WHERE e.group_id = $1 AND v.description = $2
      ORDER BY v.expense_date`,
    [group.groupId, description],
  );
  return rows.map((r) => r.d as string);
};

const rule = async (id: string) =>
  (
    await client.query(
      `SELECT status, to_char(next_date,'YYYY-MM-DD') AS next_date,
              to_char(last_generated_on,'YYYY-MM-DD') AS last_generated_on
         FROM group_recurring_expenses WHERE id = $1`,
      [id],
    )
  ).rows[0] as { status: string; next_date: string; last_generated_on: string | null };

describe('waves_recurring_next (SQL twin of nextOccurrenceAfter)', () => {
  const next = async (
    cadence: string,
    interval: number,
    secondDay: number | null,
    anchor: string,
    after: string,
  ) =>
    (
      await client.query(
        `SELECT to_char(waves_recurring_next($1, $2, $3, $4::date, $5::date), 'YYYY-MM-DD') AS d`,
        [cadence, interval, secondDay, anchor, after],
      )
    ).rows[0].d as string;

  it.each([
    ['RC-01', '2026-01-31', '2026-02-28'],
    ['RC-02', '2028-01-31', '2028-02-29'],
    ['RC-03', '2028-02-29', '2028-03-29'],
    ['RC-04', '2026-03-31', '2026-04-30'],
    ['RC-05', '2026-12-15', '2027-01-15'],
    ['RC-06', '2026-10-05', '2026-11-05'],
  ])('%s month arithmetic from %s', async (_id, from, expected) => {
    expect(await next('monthly', 1, null, from, from)).toBe(expected);
  });

  it('RC-07 the 31st is remembered: 31, 28, 31, 30, 31', async () => {
    const out = ['2026-01-31'];
    for (let i = 0; i < 5; i += 1) out.push(await next('monthly', 1, null, '2026-01-31', out[i]!));
    expect(out).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
  });

  it('RC-08 semimonthly 1st + 15th, and a 31st second day clamps in February', async () => {
    expect(await next('semimonthly', 1, 15, '2026-01-01', '2026-01-01')).toBe('2026-01-15');
    expect(await next('semimonthly', 1, 15, '2026-01-01', '2026-01-15')).toBe('2026-02-01');
    expect(await next('semimonthly', 1, 31, '2026-01-01', '2026-02-01')).toBe('2026-02-28');
    expect(await next('semimonthly', 1, 31, '2028-02-01', '2028-02-01')).toBe('2028-02-29');
  });

  it('RC-09 fortnightly stays on Sundays across DST changes (dates, not hours)', async () => {
    expect(await next('weekly', 2, null, '2026-03-15', '2026-03-15')).toBe('2026-03-29');
    expect(await next('weekly', 2, null, '2026-10-18', '2026-10-18')).toBe('2026-11-01');
  });

  it('RC-10 quarterly, half-yearly and yearly from Feb 29', async () => {
    expect(await next('monthly', 3, null, '2028-02-29', '2028-02-29')).toBe('2028-05-29');
    expect(await next('monthly', 6, null, '2028-02-29', '2028-08-29')).toBe('2029-02-28');
    expect(await next('yearly', 1, null, '2028-02-29', '2028-02-29')).toBe('2029-02-28');
    expect(await next('yearly', 1, null, '2028-02-29', '2031-02-28')).toBe('2032-02-29');
  });

  it('a date before the anchor gives the anchor', async () => {
    expect(await next('monthly', 1, null, '2026-03-31', '2025-01-01')).toBe('2026-03-31');
  });
});

describe('creating a rule', () => {
  it('records the member, from the session, and starts at the anchor', async () => {
    const id = await createRule({ by: bob, anchor: '2026-11-05' });
    const row = (
      await client.query(
        `SELECT created_by, to_char(next_date,'YYYY-MM-DD') AS n, status FROM group_recurring_expenses WHERE id=$1`,
        [id],
      )
    ).rows[0];
    expect(row.created_by).toBe(group.memberIds[bob]);
    expect(row.n).toBe('2026-11-05');
    expect(row.status).toBe('active');
  });

  it('a replayed create returns the same rule and makes no second one', async () => {
    const id = await createRule();
    await createRule({ id });
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM group_recurring_expenses WHERE group_id=$1`,
      [group.groupId],
    );
    expect(rows[0].n).toBe(1);
  });

  it('refuses a non-member, and a template that does not add up', async () => {
    await expectDenied(
      as(other.profileIds[0]!, () =>
        client.query(
          `SELECT waves_create_group_recurring_expense($1, $2, 'Rent', NULL, 'INR', 100, 'equal', '{}'::jsonb,
             '[]'::jsonb, '[]'::jsonb, NULL, 'monthly', 1, NULL, '2026-11-01', NULL)`,
          [group.groupId, randomUUID()],
        ),
      ),
    );
    await expect(
      as(group.profileIds[alice]!, () =>
        client.query(
          `SELECT waves_create_group_recurring_expense($1, $2, 'Rent', NULL, 'INR', 100, 'equal', '{}'::jsonb,
             $3::jsonb, $4::jsonb, NULL, 'monthly', 1, NULL, '2026-11-01', NULL)`,
          [
            group.groupId,
            randomUUID(),
            JSON.stringify([{ memberId: group.memberIds[alice], amount: '100' }]),
            JSON.stringify([{ memberId: group.memberIds[alice], amount: '90' }]),
          ],
        ),
      ),
    ).rejects.toThrow(/TEMPLATE_MISMATCH/);
  });

  it("refuses another group's member id in the template", async () => {
    await expect(
      as(group.profileIds[alice]!, () =>
        client.query(
          `SELECT waves_create_group_recurring_expense($1, $2, 'Rent', NULL, 'INR', 100, 'equal', '{}'::jsonb,
             $3::jsonb, $3::jsonb, NULL, 'monthly', 1, NULL, '2026-11-01', NULL)`,
          [
            group.groupId,
            randomUUID(),
            JSON.stringify([{ memberId: other.memberIds[0], amount: '100' }]),
          ],
        ),
      ),
    ).rejects.toThrow(/UNKNOWN_MEMBER/);
  });

  it('only members of the group can read its rules', async () => {
    await createRule();
    const mine = await as(group.profileIds[cara]!, () =>
      client.query(`SELECT id FROM group_recurring_expenses`),
    );
    expect(mine.rowCount).toBe(1);
    const theirs = await as(other.profileIds[0]!, () =>
      client.query(`SELECT id FROM group_recurring_expenses`),
    );
    expect(theirs.rowCount).toBe(0);
  });
});

describe('the generator', () => {
  it('posts nothing before the date and one real expense on it', async () => {
    const id = await createRule({ anchor: '2026-11-01' });
    expect(await generate('2026-10-31T23:00:00Z')).toMatchObject({ generated: 0 });
    expect(await generate('2026-11-01T00:05:00Z')).toMatchObject({ generated: 1 });
    expect(await expenseDates()).toEqual(['2026-11-01']);
    expect(await rule(id)).toMatchObject({
      next_date: '2026-12-01',
      last_generated_on: '2026-11-01',
    });
  });

  it("records the expense as written by the rule's creator, with the template split", async () => {
    await createRule({ by: bob });
    await generate('2026-11-01T01:00:00Z');
    const { rows } = await client.query(
      `SELECT v.author_member_id, v.amount::text AS amount, v.split_type,
              (SELECT count(*)::int FROM expense_shares s WHERE s.expense_version_id = v.id) AS shares,
              (SELECT sum(p.amount)::text FROM expense_payers p WHERE p.expense_version_id = v.id) AS paid
         FROM expenses e JOIN expense_versions v ON v.id = e.current_version_id
        WHERE e.group_id = $1 AND v.description = 'Rent'`,
      [group.groupId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      author_member_id: group.memberIds[bob],
      amount: '90000',
      split_type: 'equal',
      shares: 3,
      paid: '90000',
    });
  });

  it('is idempotent: running it again, twice, creates nothing more', async () => {
    await createRule({ anchor: '2026-11-01' });
    await generate('2026-11-01T01:00:00Z');
    expect(await generate('2026-11-01T01:00:00Z')).toMatchObject({ generated: 0, replayed: 0 });
    expect(await generate('2026-11-01T23:59:00Z')).toMatchObject({ generated: 0 });
    expect(await expenseDates()).toEqual(['2026-11-01']);
  });

  it('survives its own bookkeeping being lost: rewinding next_date replays, never duplicates', async () => {
    const id = await createRule({ anchor: '2026-11-01' });
    await generate('2026-11-01T01:00:00Z');
    await client.query(
      `UPDATE group_recurring_expenses SET next_date = '2026-11-01', last_generated_on = NULL WHERE id = $1`,
      [id],
    );
    expect(await generate('2026-11-01T02:00:00Z')).toMatchObject({ generated: 0, replayed: 1 });
    expect(await expenseDates()).toEqual(['2026-11-01']);
    expect((await rule(id)).next_date).toBe('2026-12-01');
  });

  it("two overlapping runs split the work: the second sees the first's rows locked or done", async () => {
    await createRule({ anchor: '2026-11-01' });
    const second = await connect();
    try {
      const [a, b] = await Promise.all([
        generate('2026-11-01T01:00:00Z'),
        second
          .query(
            `SELECT waves_generate_recurring_expenses('2026-11-01T01:00:00Z'::timestamptz, $1) AS r`,
            [group.groupId],
          )
          .then((r) => r.rows[0].r as { generated: number }),
      ]);
      expect(a.generated + b.generated).toBe(1);
      expect(await expenseDates()).toEqual(['2026-11-01']);
    } finally {
      await second.end();
    }
  });

  it('catches up every missed occurrence, oldest first, with the 31st remembered', async () => {
    const id = await createRule({ anchor: '2026-01-31' });
    expect(await generate('2026-04-30T01:00:00Z')).toMatchObject({ generated: 4 });
    expect(await expenseDates()).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect((await rule(id)).next_date).toBe('2026-05-31');
  });

  it('caps one run at twelve occurrences and finishes on the next', async () => {
    const id = await createRule({ anchor: '2024-01-01' });
    const first = await client.query(
      `SELECT waves_generate_recurring_expenses('2026-11-01T00:00:00Z'::timestamptz, $1, 12) AS r`,
      [group.groupId],
    );
    expect(first.rows[0].r.generated).toBe(12);
    expect((await rule(id)).next_date).toBe('2025-01-01');
    await client.query(
      `SELECT waves_generate_recurring_expenses('2026-11-01T00:00:00Z'::timestamptz, $1, 100)`,
      [group.groupId],
    );
    expect((await expenseDates()).length).toBe(35);
  });

  it('RC-11 an end date equal to the occurrence still fires; the rule then ends', async () => {
    const id = await createRule({ anchor: '2026-11-01', end: '2026-12-01' });
    await generate('2027-03-01T00:00:00Z');
    expect(await expenseDates()).toEqual(['2026-11-01', '2026-12-01']);
    expect((await rule(id)).status).toBe('stopped');
  });

  it('RC-11 an end date one day before the occurrence does not fire it', async () => {
    const id = await createRule({ anchor: '2026-11-01', end: '2026-11-30' });
    await generate('2027-03-01T00:00:00Z');
    expect(await expenseDates()).toEqual(['2026-11-01']);
    expect((await rule(id)).status).toBe('stopped');
  });

  it('a paused rule posts nothing; a stopped rule never does', async () => {
    const id = await createRule({ anchor: '2026-11-01' });
    await as(group.profileIds[bob]!, () =>
      client.query(
        `SELECT waves_update_group_recurring_expense($1, '{"status":"paused"}'::jsonb)`,
        [id],
      ),
    );
    expect(await generate('2026-12-15T00:00:00Z')).toMatchObject({ generated: 0 });
    await as(group.profileIds[bob]!, () =>
      client.query(
        `SELECT waves_update_group_recurring_expense($1, '{"status":"stopped"}'::jsonb)`,
        [id],
      ),
    );
    expect(await generate('2027-12-15T00:00:00Z')).toMatchObject({ generated: 0 });
    expect(await expenseDates()).toEqual([]);
  });

  it('pauses a rule whose creator has left rather than writing as a stranger', async () => {
    const id = await createRule({ by: cara });
    await client.query(`UPDATE group_members SET left_at = now() WHERE id = $1`, [
      group.memberIds[cara],
    ]);
    try {
      expect(await generate('2026-11-02T00:00:00Z')).toMatchObject({ generated: 0 });
      expect((await rule(id)).status).toBe('paused');
    } finally {
      await client.query(`UPDATE group_members SET left_at = NULL WHERE id = $1`, [
        group.memberIds[cara],
      ]);
    }
  });

  it('skips archived groups and other groups when scoped', async () => {
    await createRule({ anchor: '2026-11-01' });
    expect(await generate('2026-11-02T00:00:00Z', other.groupId)).toMatchObject({ generated: 0 });
    await client.query(`UPDATE groups SET archived_at = now() WHERE id = $1`, [group.groupId]);
    try {
      expect(await generate('2026-11-02T00:00:00Z')).toMatchObject({ generated: 0 });
    } finally {
      await client.query(`UPDATE groups SET archived_at = NULL WHERE id = $1`, [group.groupId]);
    }
  });

  it('one failing rule does not stop the others', async () => {
    const bad = await createRule({ anchor: '2026-11-01', description: 'Rent bad' });
    await createRule({ anchor: '2026-11-01', description: 'Rent good' });
    // Corrupt one rule's payers behind the RPC's back so apply_expense refuses it.
    await client.query(
      `UPDATE group_recurring_expenses SET payers = '[{"memberId":"${randomUUID()}","amount":"90000"}]' WHERE id = $1`,
      [bad],
    );
    const result = await generate('2026-11-01T01:00:00Z');
    expect(result).toMatchObject({ generated: 1, failed: 1 });
    expect((await rule(bad)).next_date).toBe('2026-11-01');
  });

  it('is not callable by a signed-in user', async () => {
    await expectDenied(
      as(group.profileIds[alice]!, () =>
        client.query(`SELECT waves_generate_recurring_expenses()`),
      ),
    );
  });
});

describe("the app's own catch-up", () => {
  const day = (offset: number): string =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  it("lets any member trigger it, posts as the rule's creator, and is idempotent", async () => {
    await createRule({ by: alice, anchor: day(0) });
    const r1 = await as(group.profileIds[cara]!, () =>
      client.query(`SELECT waves_generate_my_recurring_expenses($1::date) AS r`, [day(0)]),
    );
    expect(r1.rows[0].r).toMatchObject({ generated: 1, failed: 0 });
    const r2 = await as(group.profileIds[bob]!, () =>
      client.query(`SELECT waves_generate_my_recurring_expenses($1::date) AS r`, [day(0)]),
    );
    expect(r2.rows[0].r).toMatchObject({ generated: 0 });
    expect(await expenseDates()).toEqual([day(0)]);
    const { rows } = await client.query(
      `SELECT v.author_member_id FROM expenses e JOIN expense_versions v ON v.id = e.current_version_id
        WHERE e.group_id = $1 AND v.description = 'Rent'`,
      [group.groupId],
    );
    expect(rows[0].author_member_id).toBe(group.memberIds[alice]);
  });

  it('never runs ahead of tomorrow, and never touches a group the caller is not in', async () => {
    await createRule({ anchor: day(5) });
    const far = await as(group.profileIds[alice]!, () =>
      client.query(`SELECT waves_generate_my_recurring_expenses($1::date) AS r`, [day(30)]),
    );
    expect(far.rows[0].r.generated).toBe(0);
    await client.query(`UPDATE group_recurring_expenses SET next_date = $1, anchor_date = $1`, [
      day(0),
    ]);
    const outsider = await as(other.profileIds[0]!, () =>
      client.query(`SELECT waves_generate_my_recurring_expenses($1::date) AS r`, [day(0)]),
    );
    expect(outsider.rows[0].r.generated).toBe(0);
  });

  it('refuses an unauthenticated caller', async () => {
    await expectDenied(
      as(randomUUID(), async () => {
        await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
        return client.query(`SELECT waves_generate_my_recurring_expenses()`);
      }),
    );
  });
});

describe('pause, resume, stop and edit', () => {
  const patch = (profile: string, id: string, body: object) =>
    as(profile, () =>
      client.query(`SELECT waves_update_group_recurring_expense($1, $2::jsonb)`, [
        id,
        JSON.stringify(body),
      ]),
    );

  it('any live member can pause and resume; resume skips what was missed', async () => {
    const id = await createRule({ anchor: '2026-01-15' });
    await patch(group.profileIds[bob]!, id, { status: 'paused' });
    expect((await rule(id)).status).toBe('paused');
    await client.query(
      `UPDATE group_recurring_expenses SET next_date = '2026-01-15' WHERE id = $1`,
      [id],
    );
    await patch(group.profileIds[cara]!, id, { status: 'active' });
    const after = await rule(id);
    expect(after.status).toBe('active');
    expect(after.next_date >= new Date().toISOString().slice(0, 10)).toBe(true);
    expect(after.next_date.endsWith('-15')).toBe(true);
  });

  it('stopped is final', async () => {
    const id = await createRule();
    await patch(group.profileIds[bob]!, id, { status: 'stopped' });
    await expect(patch(group.profileIds[bob]!, id, { status: 'active' })).rejects.toThrow(
      /RULE_STOPPED/,
    );
    await expect(patch(group.profileIds[alice]!, id, { description: 'x' })).rejects.toThrow(
      /RULE_STOPPED/,
    );
  });

  it('a non-member cannot change, pause or stop it', async () => {
    const id = await createRule();
    await expectDenied(patch(other.profileIds[0]!, id, { status: 'stopped' }));
    expect((await rule(id)).status).toBe('active');
  });

  it('editing the amount re-validates the split; the next occurrence uses the new values', async () => {
    const id = await createRule({ anchor: '2026-11-01' });
    const third = '10000';
    await patch(group.profileIds[alice]!, id, {
      amount: '30000',
      payers: [{ memberId: group.memberIds[alice], amount: '30000' }],
      shares: group.memberIds.map((m) => ({ memberId: m, amount: third })),
    });
    await generate('2026-11-01T01:00:00Z');
    const { rows } = await client.query(
      `SELECT v.amount::text AS amount FROM expenses e JOIN expense_versions v ON v.id = e.current_version_id
        WHERE e.group_id = $1 AND v.description = 'Rent'`,
      [group.groupId],
    );
    expect(rows[0].amount).toBe('30000');
    await expect(patch(group.profileIds[alice]!, id, { amount: '999' })).rejects.toThrow(
      /TEMPLATE_MISMATCH/,
    );
  });

  it('can set and clear the end date; an end before the anchor is refused', async () => {
    const id = await createRule({ anchor: '2027-02-01' });
    await patch(group.profileIds[alice]!, id, { end_date: '2027-06-01' });
    expect(
      (
        await client.query(
          `SELECT to_char(end_date,'YYYY-MM-DD') AS e FROM group_recurring_expenses WHERE id=$1`,
          [id],
        )
      ).rows[0].e,
    ).toBe('2027-06-01');
    await patch(group.profileIds[alice]!, id, { end_date: null });
    expect(
      (await client.query(`SELECT end_date FROM group_recurring_expenses WHERE id=$1`, [id]))
        .rows[0].end_date,
    ).toBeNull();
    await expect(patch(group.profileIds[alice]!, id, { end_date: '2027-01-01' })).rejects.toThrow(
      /INVALID_END|end_after_anchor/,
    );
  });

  it('changing the schedule restarts from today without back-paying', async () => {
    const id = await createRule({ anchor: '2026-01-31' });
    await patch(group.profileIds[alice]!, id, { cadence: 'monthly', interval: 3 });
    const after = await rule(id);
    expect(after.next_date >= new Date().toISOString().slice(0, 10)).toBe(true);
    expect(await generate('2026-02-01T00:00:00Z')).toMatchObject({ generated: 0 });
  });
});
