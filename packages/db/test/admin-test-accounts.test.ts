/** Test-account marking: admin-only table + RPCs, and the users-list filter. */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect } from './helpers.js';

let client: Client;
const tag = randomUUID().slice(0, 8);

beforeAll(async () => {
  client = await connect();
  // Bare Postgres has no `auth` schema; shim the columns waves_admin_users reads.
  await client.query(`CREATE SCHEMA IF NOT EXISTS auth`);
  await client.query(`CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY, email text, phone text, email_confirmed_at timestamptz,
    is_anonymous boolean DEFAULT false, created_at timestamptz DEFAULT now(),
    last_sign_in_at timestamptz)`);
});

afterAll(async () => {
  await client?.query(
    `DELETE FROM public.test_accounts WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE $1)`,
    [`%${tag}%`],
  );
  await client?.query(`DELETE FROM auth.users WHERE email LIKE $1`, [`%${tag}%`]);
  await client?.end();
});

async function user(email: string): Promise<string> {
  const id = randomUUID();
  await client.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [id, email]);
  return id;
}

async function asRole<T>(role: string, run: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    return await run();
  } finally {
    await client.query('ROLLBACK');
  }
}

type Listing = { total: number; test_total: number; rows: { id: string; is_test: boolean }[] };

async function list(test: string | null, prefix: string): Promise<Listing> {
  const { rows } = await client.query(
    `SELECT public.waves_admin_users(100, 0, $1, NULL, $2) AS r`,
    [prefix, test],
  );
  return rows[0].r as Listing;
}

describe('test accounts', () => {
  it('marks by pattern, filters, and unmarks', async () => {
    const real = await user(`real-${tag}@x.com`);
    const a = await user(`me+wv-a-${tag}@gmail.com`);
    const b = await user(`me+wv-b-${tag}@gmail.com`);

    const { rows } = await client.query(`SELECT public.waves_admin_mark_test_by_email($1) AS n`, [
      `me+wv-%-${tag}@gmail.com`,
    ]);
    expect(rows[0].n).toBe(2);

    expect((await list(null, '')).test_total).toBeGreaterThanOrEqual(2);
    const only = await list('only', `me+wv-`);
    expect(only.rows.map((r) => r.id).sort()).toEqual([a, b].sort());
    expect(only.rows.every((r) => r.is_test)).toBe(true);
    const hide = await list('hide', `real-${tag}`);
    expect(hide.rows.map((r) => r.id)).toEqual([real]);
    expect(hide.rows[0]?.is_test).toBe(false);

    await client.query(`SELECT public.waves_admin_set_test($1, false, NULL)`, [a]);
    expect((await list('only', `me+wv-a-${tag}`)).rows).toEqual([]);
    await client.query(`SELECT public.waves_admin_set_test($1, true, 'hand')`, [real]);
    expect((await list('only', `real-${tag}`)).rows.map((r) => r.id)).toEqual([real]);
  });

  it('rejects patterns that could match everyone', async () => {
    for (const bad of ['%', '%@%', '%@gmail.com', 'me%', 'a_@x.com', 'nopercent', '', 'abc']) {
      await expect(
        client.query(`SELECT public.waves_admin_mark_test_by_email($1)`, [bad]),
      ).rejects.toThrow(/pattern must contain/);
    }
  });

  it('rejects an unknown p_test value and an unknown user', async () => {
    await expect(
      client.query(`SELECT public.waves_admin_users(5, 0, NULL, NULL, 'x')`),
    ).rejects.toThrow();
    await expect(
      client.query(`SELECT public.waves_admin_set_test($1, true, NULL)`, [randomUUID()]),
    ).rejects.toThrow(/no such user/);
  });

  it('is unreachable for anon and authenticated', async () => {
    const calls = [
      `SELECT public.waves_admin_users(5, 0, NULL, NULL, NULL)`,
      `SELECT public.waves_admin_set_test('${randomUUID()}', true, NULL)`,
      `SELECT public.waves_admin_mark_test_by_email('abc@x.com')`,
      `SELECT * FROM public.test_accounts`,
    ];
    for (const role of ['anon', 'authenticated']) {
      for (const sql of calls) {
        await expect(asRole(role, () => client.query(sql))).rejects.toThrow(/permission denied/);
      }
    }
  });
});
