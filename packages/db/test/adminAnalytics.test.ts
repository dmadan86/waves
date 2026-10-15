/**
 * The admin console's reads, and who is allowed to make them.
 *
 * The grants are the point. Postgres gives EXECUTE to PUBLIC on every new
 * function, and `anon` and `authenticated` inherit PUBLIC in Supabase — so a
 * missing REVOKE does not fail loudly, it quietly publishes the whole business
 * behind the anon key that ships inside the app binary. That is a one-line
 * mistake with no symptom, which is exactly the kind worth a test.
 *
 * The arithmetic is checked too, against rows this file seeds, because a
 * dashboard that is confidently wrong is worse than one that is empty.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { addEqualSplitExpense, connect, expectDenied, seedGroup } from './helpers';

let client: Client;

const FUNCTIONS = [
  'waves_admin_overview()',
  'waves_admin_daily(30)',
  'waves_admin_geo()',
  'waves_admin_money()',
  'waves_admin_ai_cost(30)',
  'waves_admin_logins(30)',
  'waves_admin_kpis(30)',
  'waves_admin_retention_cohorts(8)',
  'waves_admin_campaigns(30)',
  'waves_admin_creations(current_date)',
  'waves_admin_activity_days(current_date)',
];

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client.end();
});

/** Runs one statement as a role, then puts the connection back. */
async function asRole<T>(role: string, run: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    return await run();
  } finally {
    await client.query('ROLLBACK');
  }
}

describe('who may read the business', () => {
  it('refuses anon on every function', async () => {
    for (const fn of FUNCTIONS) {
      const message = await asRole('anon', () =>
        expectDenied(client.query(`SELECT * FROM public.${fn}`)),
      );
      expect(message, fn).toMatch(/permission denied/i);
    }
  });

  it('refuses a signed-in user on every function', async () => {
    // The one that matters most. Every Waves account is signed in, including
    // the anonymous guests ADR-006 hands out for free — "authenticated" is not
    // a privilege here, it is the default.
    for (const fn of FUNCTIONS) {
      const message = await asRole('authenticated', () =>
        expectDenied(client.query(`SELECT * FROM public.${fn}`)),
      );
      expect(message, fn).toMatch(/permission denied/i);
    }
  });

  it('allows the service role', async () => {
    for (const fn of FUNCTIONS) {
      await asRole('service_role', async () => {
        await expect(client.query(`SELECT * FROM public.${fn}`)).resolves.toBeDefined();
      });
    }
  });
});

describe('the numbers', () => {
  it('counts people, groups and live expenses', async () => {
    const before = (await client.query('SELECT * FROM public.waves_admin_overview()')).rows[0];

    const { groupId, memberIds } = await seedGroup(client, { memberCount: 2 });
    const expenseId = await addExpense(client, groupId, memberIds[0]!, 'INR', 45000n);

    const after = (await client.query('SELECT * FROM public.waves_admin_overview()')).rows[0];

    expect(Number(after.profiles_total)).toBe(Number(before.profiles_total) + 2);
    expect(Number(after.groups_total)).toBe(Number(before.groups_total) + 1);
    expect(Number(after.expenses_total)).toBe(Number(before.expenses_total) + 1);

    // A soft-deleted expense leaves the live count and joins the deleted one.
    await client.query('UPDATE public.expenses SET deleted_at = now() WHERE id = $1', [expenseId]);
    const deleted = (await client.query('SELECT * FROM public.waves_admin_overview()')).rows[0];
    expect(Number(deleted.expenses_total)).toBe(Number(after.expenses_total) - 1);
    expect(Number(deleted.expenses_deleted)).toBe(Number(after.expenses_deleted) + 1);
  });

  it('keeps a day with nothing in it', async () => {
    // The reason this is generate_series and not GROUP BY: a chart drawn from
    // grouped rows closes its own gaps, and a flat fortnight is information.
    const { rows } = await client.query('SELECT * FROM public.waves_admin_daily(14)');
    expect(rows).toHaveLength(14);

    const days = rows.map((row) => String(row.day instanceof Date ? isoDay(row.day) : row.day));
    expect(new Set(days).size).toBe(14);
    expect(days).toEqual([...days].sort());
  });

  it('never adds one currency to another', async () => {
    const { groupId, memberIds } = await seedGroup(client, { memberCount: 2 });
    await addExpense(client, groupId, memberIds[0]!, 'INR', 10_000n);
    await addExpense(client, groupId, memberIds[0]!, 'AED', 700n);

    const { rows } = await client.query('SELECT * FROM public.waves_admin_money()');
    const inr = rows.find((row) => row.currency === 'INR');
    const aed = rows.find((row) => row.currency === 'AED');

    expect(inr).toBeDefined();
    expect(aed).toBeDefined();
    // Separate rows, and the AED row cannot have absorbed the rupees.
    expect(BigInt(aed!.expense_minor)).toBeGreaterThanOrEqual(700n);
    expect(BigInt(inr!.expense_minor)).toBeGreaterThanOrEqual(10_000n);
    expect(rows.every((row) => typeof row.currency === 'string' && row.currency.length === 3)).toBe(
      true,
    );
  });

  it('counts an edited expense once, at its current version', async () => {
    const { groupId, memberIds } = await seedGroup(client, { memberCount: 2 });
    const expenseId = await addExpense(client, groupId, memberIds[0]!, 'SGD', 5_000n);

    const before = await currencyTotal(client, 'SGD');
    await addVersion(client, expenseId, memberIds[0]!, 'SGD', 9_000n, 2);
    const after = await currencyTotal(client, 'SGD');

    // 5000 replaced by 9000, not 5000 + 9000.
    expect(after - before).toBe(4_000n);
  });

  it('reports an unknown country as its own row rather than dropping it', async () => {
    await seedGroup(client, { memberCount: 1 });
    const { rows } = await client.query('SELECT * FROM public.waves_admin_geo()');
    expect(rows.some((row) => row.country_code === null)).toBe(true);
  });

  it('returns nothing for logins on a database with no auth schema', async () => {
    // CI is bare Postgres. The function must answer rather than raise — an
    // admin console that 500s on a machine without Supabase's auth schema is
    // one nobody can develop against.
    const { rows } = await client.query('SELECT * FROM public.waves_admin_logins(30)');
    expect(Array.isArray(rows)).toBe(true);
  });
});

describe('activation, retention and invites', () => {
  /** The KPI row for a 60-day window, as numbers. */
  async function kpis(): Promise<Record<string, number | null>> {
    const { rows } = await client.query('SELECT * FROM public.waves_admin_kpis(60)');
    const out: Record<string, number | null> = {};
    for (const [key, value] of Object.entries(rows[0])) {
      out[key] = value === null ? null : Number(value);
    }
    return out;
  }

  /** Midnight, 40 days ago, plus six hours: a signup time no clock edge can move. */
  const SIGNUP = `(date_trunc('day', now()) - interval '40 days' + interval '6 hours')`;

  async function expenseAt(groupId: string, memberId: string, at: string): Promise<void> {
    const { expenseId } = await addEqualSplitExpense(client, {
      groupId,
      payers: { [memberId]: 1000n },
      participants: [memberId],
      amount: 1000n,
    });
    await client.query(`UPDATE public.expenses SET created_at = ${at} WHERE id = $1`, [expenseId]);
  }

  it('counts activation and day 1, 7 and 30 retention from the right days', async () => {
    const before = await kpis();
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 3 });
    await client.query(`UPDATE public.profiles SET created_at = ${SIGNUP} WHERE id = ANY($1)`, [
      profileIds,
    ]);
    const [a, b, c] = profileIds as [string, string, string];

    // A: an expense on day 1, again on day 7 (after the 7-day window), and on day 30.
    await expenseAt(groupId, memberIds[0]!, `${SIGNUP} + interval '1 day'`);
    await expenseAt(groupId, memberIds[0]!, `${SIGNUP} + interval '7 days 2 hours'`);
    await expenseAt(groupId, memberIds[0]!, `${SIGNUP} + interval '30 days 2 hours'`);
    // B: first expense on day 10 — too late to count as activated.
    await expenseAt(groupId, memberIds[1]!, `${SIGNUP} + interval '10 days'`);
    // C: a personal record on day 3 — activated, and nothing else.
    await client.query(
      `INSERT INTO public.personal_records (id, owner_user_id, record_kind, created_at)
       VALUES ($1, $2, 'txn', ${SIGNUP} + interval '3 days')`,
      [randomUUID(), c],
    );
    expect([a, b, c]).toHaveLength(3);

    // D: signed up a moment ago, so too young for any of the measures.
    await seedGroup(client, { memberCount: 1 });

    const after = await kpis();
    const delta = (key: string): number => (after[key] ?? 0) - (before[key] ?? 0);

    expect(delta('registrations')).toBe(4);
    expect(delta('activation_cohort')).toBe(3);
    expect(delta('activated')).toBe(2);
    expect(delta('d1_cohort')).toBe(3);
    expect(delta('d1_retained')).toBe(1);
    expect(delta('d7_cohort')).toBe(3);
    expect(delta('d7_retained')).toBe(1);
    expect(delta('d30_cohort')).toBe(3);
    expect(delta('d30_retained')).toBe(1);
  });

  it('does not count a soft-deleted expense as activation', async () => {
    const before = await kpis();
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 1 });
    await client.query(`UPDATE public.profiles SET created_at = ${SIGNUP} WHERE id = $1`, [
      profileIds[0],
    ]);
    await expenseAt(groupId, memberIds[0]!, `${SIGNUP} + interval '1 day'`);
    await client.query(`UPDATE public.expenses SET deleted_at = now() WHERE group_id = $1`, [
      groupId,
    ]);

    const after = await kpis();
    expect((after.activation_cohort ?? 0) - (before.activation_cohort ?? 0)).toBe(1);
    expect((after.activated ?? 0) - (before.activated ?? 0)).toBe(0);
  });

  it('counts a settlement as activation, by the member who starts it', async () => {
    const before = await kpis();
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 2 });
    await client.query(`UPDATE public.profiles SET created_at = ${SIGNUP} WHERE id = ANY($1)`, [
      profileIds,
    ]);
    await client.query(
      `INSERT INTO public.settlements
         (group_id, from_member_id, to_member_id, currency, amount, method, created_at)
       VALUES ($1, $2, $3, 'INR', 500, 'cash', ${SIGNUP} + interval '2 days')`,
      [groupId, memberIds[0], memberIds[1]],
    );

    const after = await kpis();
    expect((after.activation_cohort ?? 0) - (before.activation_cohort ?? 0)).toBe(2);
    // Only the payer made something; the person who was paid did not.
    expect((after.activated ?? 0) - (before.activated ?? 0)).toBe(1);
  });

  it('returns a ratio only where there is a denominator, and the raw counts beside it', async () => {
    const { rows } = await client.query('SELECT * FROM public.waves_admin_kpis(1)');
    const row = rows[0];
    for (const key of ['activation', 'd1', 'd7', 'd30']) {
      const cohort = key === 'activation' ? row.activation_cohort : row[`${key}_cohort`];
      const ratio = key === 'activation' ? row.registration_to_activation : row[key];
      if (BigInt(cohort) === 0n) expect(ratio, key).toBeNull();
      else expect(Number(ratio), key).toBeGreaterThanOrEqual(0);
    }
    expect(typeof row.installs).toBe('string'); // bigint, exact
  });

  it('counts install -> registration from app_installed rows', async () => {
    const before = await kpis();
    const install = randomUUID();
    await client.query(
      `INSERT INTO public.app_events (install_id, name) VALUES ($1, 'app_installed')`,
      [install],
    );
    // Other events from the same install are not installs.
    await client.query(
      `INSERT INTO public.app_events (install_id, name) VALUES ($1, 'premium_viewed')`,
      [install],
    );
    const after = await kpis();
    expect((after.installs ?? 0) - (before.installs ?? 0)).toBe(1);
  });

  it('counts an invite once when it brought a new person, and not when it did not', async () => {
    const before = await kpis();
    const inviteAt = (groupId: string, at: string) =>
      client.query(
        `INSERT INTO public.invites (group_id, token_hash, created_by, expires_at, created_at)
         VALUES ($1, $2, (SELECT profile_id FROM public.group_members WHERE group_id = $1 AND role = 'admin'),
                 now() + interval '7 days', ${at})`,
        [groupId, randomUUID()],
      );

    // Worked: the joiner's profile was made after the invite, and they came in by its link.
    const g1 = await seedGroup(client, { memberCount: 2 });
    await inviteAt(g1.groupId, `now() - interval '1 hour'`);
    await client.query(`UPDATE public.group_members SET joined_via = 'invite_link' WHERE id = $1`, [
      g1.memberIds[1],
    ]);

    // Did not: the joiner already had an account from long before the invite.
    const g2 = await seedGroup(client, { memberCount: 2 });
    await inviteAt(g2.groupId, `now()`);
    await client.query(`UPDATE public.group_members SET joined_via = 'invite_link' WHERE id = $1`, [
      g2.memberIds[1],
    ]);
    await client.query(`UPDATE public.profiles SET created_at = ${SIGNUP} WHERE id = $1`, [
      g2.profileIds[1],
    ]);

    // Did not: nobody joined.
    const g3 = await seedGroup(client, { memberCount: 1 });
    await inviteAt(g3.groupId, `now()`);

    const after = await kpis();
    expect((after.invites_sent ?? 0) - (before.invites_sent ?? 0)).toBe(3);
    expect((after.invite_registrations ?? 0) - (before.invite_registrations ?? 0)).toBe(1);
  });

  it('gives one row per week, oldest first, with young weeks marked ineligible', async () => {
    const { rows } = await client.query('SELECT * FROM public.waves_admin_retention_cohorts(4)');
    expect(rows).toHaveLength(4);
    const weeks = rows.map((row) =>
      row.week_start instanceof Date ? isoDay(row.week_start) : row.week_start,
    );
    expect(weeks).toEqual([...weeks].sort());
    const newest = rows[3];
    // The current week cannot have a mature day-30 cohort.
    expect(BigInt(newest.d30_eligible)).toBe(0n);
    for (const row of rows) {
      expect(BigInt(row.d1_retained)).toBeLessThanOrEqual(BigInt(row.d1_eligible));
      expect(BigInt(row.activated)).toBeLessThanOrEqual(BigInt(row.activation_eligible));
      expect(BigInt(row.d1_eligible)).toBeLessThanOrEqual(BigInt(row.size));
    }
  });

  it('puts a cohort in the week it signed up', async () => {
    const before = await client.query('SELECT * FROM public.waves_admin_retention_cohorts(8)');
    const { profileIds } = await seedGroup(client, { memberCount: 2 });
    await client.query(`UPDATE public.profiles SET created_at = ${SIGNUP} WHERE id = ANY($1)`, [
      profileIds,
    ]);
    const after = await client.query('SELECT * FROM public.waves_admin_retention_cohorts(8)');

    const { rows: target } = await client.query(
      `SELECT date_trunc('week', ${SIGNUP})::date AS week`,
    );
    const key = isoDay(target[0].week);
    const sizeIn = (rows: Array<Record<string, unknown>>) => {
      const row = rows.find((r) => isoDay(r.week_start as Date) === key);
      return row ? Number(row.size) : 0;
    };
    expect(sizeIn(after.rows)).toBe(sizeIn(before.rows) + 2);
  });
});

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

async function currencyTotal(db: Client, currency: string): Promise<bigint> {
  const { rows } = await db.query(
    'SELECT expense_minor FROM public.waves_admin_money() WHERE currency = $1',
    [currency],
  );
  return rows[0] ? BigInt(rows[0].expense_minor) : 0n;
}

/**
 * One expense, through the repo's own helper.
 *
 * Hand-rolling the inserts here did not work and should not have: a trigger
 * checks that the payers sum to the amount, so an expense seeded without them
 * is rejected — `PAYER_MISMATCH: payers sum to 0 but the expense is 10000`.
 * That guard is the ledger's, and a test fixture that sidestepped it would be
 * measuring rows the app can never produce.
 */
async function addExpense(
  db: Client,
  groupId: string,
  memberId: string,
  currency: string,
  amount: bigint,
): Promise<string> {
  const { expenseId } = await addEqualSplitExpense(db, {
    groupId,
    payers: { [memberId]: amount },
    participants: [memberId],
    amount,
    currency,
  });
  return expenseId;
}

/** A second version of an existing expense, payers and shares included. */
async function addVersion(
  db: Client,
  expenseId: string,
  memberId: string,
  currency: string,
  amount: bigint,
  versionNo: number,
): Promise<void> {
  const versionId = randomUUID();
  await db.query('BEGIN');
  try {
    await db.query(
      `INSERT INTO public.expense_versions
         (id, expense_id, version_no, author_member_id, description, expense_date,
          currency, amount, split_type, split_params)
       VALUES ($1, $2, $3, $4, 'Dinner', current_date, $5, $6, 'equal', '{"kind":"equal"}'::jsonb)`,
      [versionId, expenseId, versionNo, memberId, currency, amount.toString()],
    );
    await db.query(
      `INSERT INTO public.expense_payers (id, expense_version_id, member_id, amount)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), versionId, memberId, amount.toString()],
    );
    await db.query(
      `INSERT INTO public.expense_shares (id, expense_version_id, member_id, amount)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), versionId, memberId, amount.toString()],
    );
    await db.query('UPDATE public.expenses SET current_version_id = $1 WHERE id = $2', [
      versionId,
      expenseId,
    ]);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}
