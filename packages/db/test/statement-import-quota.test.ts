/**
 * Statement import: the flag, the gate and the files-a-month meter
 * (`parse-statement` edge function, server half). It rides on the generic
 * `ai_usage` meter from the screenshot import; these pin what is new.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { asRole, connect, expectDenied, seedGroup } from './helpers';

let client: Client;
let a: string;
let b: string;

beforeAll(async () => {
  client = await connect();
  const group = await seedGroup(client, { memberCount: 2 });
  [a, b] = group.profileIds as [string, string];
});

async function reset(): Promise<void> {
  await client.query(`DELETE FROM ai_usage WHERE profile_id = ANY($1::uuid[])`, [[a, b]]);
  await client.query(`DELETE FROM screenshot_import_allowlist WHERE profile_id = ANY($1::uuid[])`, [
    [a, b],
  ]);
  await client.query(`DELETE FROM subscriptions WHERE profile_id = ANY($1::uuid[])`, [[a, b]]);
  await client.query(
    `UPDATE feature_flags SET enabled = false, rollout_percent = 0 WHERE key = 'statement_import'`,
  );
}

beforeEach(reset);
afterAll(async () => {
  await reset();
  await client.end();
});

const reserve = async (profile: string, limit = 5): Promise<Record<string, unknown>> =>
  (await client.query(`SELECT public.waves_statement_import_quota($1, $2) AS q`, [profile, limit]))
    .rows[0].q as Record<string, unknown>;

function subscribe(
  profile: string,
  tier = 'pro',
  store = 'play',
  end = `now() + interval '30 days'`,
) {
  const period = end === 'NULL' ? 'lifetime' : 'monthly';
  return client.query(
    `INSERT INTO subscriptions (profile_id, tier, period, status, current_period_end, store)
     VALUES ($1, $2, '${period}', 'active', ${end}, $3)`,
    [profile, tier, store],
  );
}

describe('the seeded flag', () => {
  it('exists and ships OFF', async () => {
    const { rows } = await client.query(
      `SELECT enabled, rollout_percent FROM feature_flags WHERE key = 'statement_import'`,
    );
    expect(rows).toEqual([{ enabled: false, rollout_percent: 0 }]);
  });
});

describe('waves_statement_import_quota', () => {
  it('reserves one file at a time up to the allowance, then refuses without reserving', async () => {
    expect(await reserve(a, 2)).toEqual({ used: 1, limit: 2, tier: 'pro', allowed: true });
    expect(await reserve(a, 2)).toEqual({ used: 2, limit: 2, tier: 'pro', allowed: true });
    expect(await reserve(a, 2)).toEqual({ used: 2, limit: 2, tier: 'pro', allowed: false });
    const { rows } = await client.query(
      `SELECT count FROM ai_usage WHERE profile_id = $1 AND feature = 'statement_import'`,
      [a],
    );
    expect(rows[0].count).toBe(2);
  });

  it('refuses outright when the limit is zero', async () => {
    expect(await reserve(a, 0)).toMatchObject({ used: 0, allowed: false });
  });

  it('never lets two concurrent calls take the last file', async () => {
    const other = await connect();
    try {
      const results = await Promise.all(
        [client, other, client, other].map((c) =>
          c.query(`SELECT public.waves_statement_import_quota($1, 1) AS q`, [a]),
        ),
      );
      const allowed = results.filter((r) => (r.rows[0].q as { allowed: boolean }).allowed);
      expect(allowed).toHaveLength(1);
    } finally {
      await other.end();
    }
  });

  it('keeps statements on their own meter, apart from screenshots and follow-up chunks', async () => {
    await client.query(`SELECT public.waves_ai_usage_reserve($1, 'screenshot_import', 10)`, [a]);
    await client.query(`SELECT public.waves_ai_usage_reserve($1, 'statement_import_chunks', 10)`, [
      a,
    ]);
    expect(await reserve(a)).toMatchObject({ used: 1 });
  });

  it('starts a fresh count in a new calendar month', async () => {
    await client.query(
      `INSERT INTO ai_usage (profile_id, month, feature, count) VALUES ($1, '2020-01', 'statement_import', 99)`,
      [a],
    );
    expect(await reserve(a)).toMatchObject({ used: 1, allowed: true });
  });

  it('is refunded by the shared refund, per feature', async () => {
    await reserve(a);
    await reserve(a);
    const { rows } = await client.query(
      `SELECT public.waves_ai_usage_refund($1, 'statement_import') AS n`,
      [a],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe('waves_statement_import_enabled', () => {
  const enabled = async (p: string) =>
    (await client.query(`SELECT public.waves_statement_import_enabled($1) AS e`, [p])).rows[0].e;
  const flagOn = (percent = 100) =>
    client.query(
      `UPDATE feature_flags SET enabled = true, rollout_percent = $1 WHERE key = 'statement_import'`,
      [percent],
    );

  it('is off for everyone while the flag is off, even a subscriber', async () => {
    await subscribe(a);
    expect(await enabled(a)).toBe(false);
  });

  it('is on for an allowlisted person even while the flag is off', async () => {
    await client.query(`INSERT INTO screenshot_import_allowlist (profile_id) VALUES ($1)`, [a]);
    expect(await enabled(a)).toBe(true);
    expect(await enabled(b)).toBe(false);
  });

  it('is off for a free person even at full rollout', async () => {
    await flagOn();
    expect(await enabled(a)).toBe(false);
  });

  it('is on for a paid person at full rollout and follows rollout_percent', async () => {
    await flagOn();
    await subscribe(a);
    await subscribe(b, 'pro', 'promo', 'NULL');
    expect(await enabled(a)).toBe(true);
    expect(await enabled(b)).toBe(true);
    await flagOn(0);
    expect(await enabled(a)).toBe(false);
  });

  it('is off for a lapsed or cancelled subscription', async () => {
    await flagOn();
    await subscribe(a, 'pro', 'play', `now() - interval '1 day'`);
    await client.query(
      `INSERT INTO subscriptions (profile_id, tier, period, status, current_period_end, store)
       VALUES ($1, 'pro', 'monthly', 'cancelled', now() + interval '30 days', 'appstore')`,
      [b],
    );
    expect(await enabled(a)).toBe(false);
    expect(await enabled(b)).toBe(false);
  });

  it('is off for no one at all', async () => {
    const { rows } = await client.query(`SELECT public.waves_statement_import_enabled(NULL) AS e`);
    expect(rows[0].e).toBe(false);
  });
});

describe('access control', () => {
  it('keeps the gate and the meter away from clients', async () => {
    for (const sql of [
      `SELECT public.waves_statement_import_quota('${a}')`,
      `SELECT public.waves_statement_import_enabled('${a}')`,
    ]) {
      await expectDenied(
        asRole(client, 'authenticated', { sub: a, role: 'authenticated' }, () => client.query(sql)),
      );
    }
  });
});
