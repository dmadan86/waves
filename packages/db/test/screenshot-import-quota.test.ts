/**
 * Screenshot import: the generic monthly AI meter, its refund, and the gate
 * (`import-screenshot` edge function, server half).
 *
 * Per person: a groupmate's subscription never lifts anyone. Usage is
 * service-role-only to write and own-row-only to read.
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
    `UPDATE feature_flags SET enabled = false, rollout_percent = 0 WHERE key = 'screenshot_import'`,
  );
}

beforeEach(reset);
afterAll(async () => {
  await reset();
  await client.end();
});

async function reserve(profile: string, plus = 3, pro = 5): Promise<Record<string, unknown>> {
  const { rows } = await client.query(
    `SELECT public.waves_screenshot_import_quota($1, $2, $3) AS q`,
    [profile, plus, pro],
  );
  return rows[0].q as Record<string, unknown>;
}

function subscribe(
  profile: string,
  tier: string,
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
      `SELECT enabled, rollout_percent FROM feature_flags WHERE key = 'screenshot_import'`,
    );
    expect(rows).toEqual([{ enabled: false, rollout_percent: 0 }]);
  });
});

describe('waves_screenshot_import_quota', () => {
  it('reserves one at a time up to the Plus allowance, then refuses without reserving', async () => {
    await subscribe(a, 'plus');
    expect(await reserve(a)).toEqual({ used: 1, limit: 3, tier: 'plus', allowed: true });
    await reserve(a);
    expect(await reserve(a)).toEqual({ used: 3, limit: 3, tier: 'plus', allowed: true });
    expect(await reserve(a)).toEqual({ used: 3, limit: 3, tier: 'plus', allowed: false });
    const { rows } = await client.query(
      `SELECT count FROM ai_usage WHERE profile_id = $1 AND feature = 'screenshot_import'`,
      [a],
    );
    expect(rows[0].count).toBe(3);
  });

  it('gives Pro (including promo and grace) the Pro allowance', async () => {
    await subscribe(b, 'pro', 'promo', 'NULL');
    expect(await reserve(b)).toMatchObject({ tier: 'pro', limit: 5, allowed: true });
    await client.query(`UPDATE subscriptions SET status = 'grace' WHERE profile_id = $1`, [b]);
    expect(await reserve(b)).toMatchObject({ tier: 'pro', limit: 5, used: 2 });
  });

  it('gives an allowlisted person with no subscription the Plus allowance', async () => {
    expect(await reserve(a)).toMatchObject({ tier: 'plus', limit: 3, allowed: true });
  });

  it('ignores an expired Pro subscription', async () => {
    await subscribe(a, 'pro', 'play', `now() - interval '1 day'`);
    expect(await reserve(a)).toMatchObject({ tier: 'plus', limit: 3 });
  });

  it('refuses outright when the limit is zero', async () => {
    expect(await reserve(a, 0, 0)).toMatchObject({ used: 0, allowed: false });
  });

  it('never lets two concurrent calls take the last use', async () => {
    const other = await connect();
    try {
      const results = await Promise.all(
        [client, other, client, other].map((c) =>
          c.query(`SELECT public.waves_screenshot_import_quota($1, 1, 1) AS q`, [a]),
        ),
      );
      const allowed = results.filter((r) => (r.rows[0].q as { allowed: boolean }).allowed);
      expect(allowed).toHaveLength(1);
    } finally {
      await other.end();
    }
  });

  it('starts a fresh count in a new calendar month', async () => {
    await client.query(
      `INSERT INTO ai_usage (profile_id, month, feature, count) VALUES ($1, '2020-01', 'screenshot_import', 99)`,
      [a],
    );
    expect(await reserve(a)).toMatchObject({ used: 1, allowed: true });
  });

  it('keeps each feature on its own meter', async () => {
    await client.query(`SELECT public.waves_ai_usage_reserve($1, 'other_feature', 10)`, [a]);
    expect(await reserve(a)).toMatchObject({ used: 1 });
  });

  it('refunds a reserved use, never below zero, and only for that feature', async () => {
    await reserve(a);
    await client.query(`SELECT public.waves_ai_usage_reserve($1, 'other_feature', 10)`, [a]);
    const first = await client.query(
      `SELECT public.waves_ai_usage_refund($1, 'screenshot_import') AS n`,
      [a],
    );
    expect(first.rows[0].n).toBe(0);
    const second = await client.query(
      `SELECT public.waves_ai_usage_refund($1, 'screenshot_import') AS n`,
      [a],
    );
    expect(second.rows[0].n).toBe(0);
    const other = await client.query(
      `SELECT count FROM ai_usage WHERE profile_id = $1 AND feature = 'other_feature'`,
      [a],
    );
    expect(other.rows[0].count).toBe(1);
  });
});

describe('waves_screenshot_import_enabled', () => {
  const enabled = async (p: string) =>
    (await client.query(`SELECT public.waves_screenshot_import_enabled($1) AS e`, [p])).rows[0].e;
  const flagOn = (percent = 100) =>
    client.query(
      `UPDATE feature_flags SET enabled = true, rollout_percent = $1 WHERE key = 'screenshot_import'`,
      [percent],
    );

  it('is off for everyone while the flag is off, even a subscriber', async () => {
    await subscribe(a, 'pro');
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

  it('is on for Plus and Pro at full rollout, and follows rollout_percent', async () => {
    await flagOn();
    await subscribe(a, 'plus');
    await subscribe(b, 'pro', 'promo', 'NULL');
    expect(await enabled(a)).toBe(true);
    expect(await enabled(b)).toBe(true);
    await flagOn(0);
    expect(await enabled(a)).toBe(false);
  });

  it('is off for a lapsed or cancelled subscription', async () => {
    await flagOn();
    await subscribe(a, 'plus', 'play', `now() - interval '1 day'`);
    await client.query(
      `INSERT INTO subscriptions (profile_id, tier, period, status, current_period_end, store)
       VALUES ($1, 'pro', 'monthly', 'cancelled', now() + interval '30 days', 'appstore')`,
      [b],
    );
    expect(await enabled(a)).toBe(false);
    expect(await enabled(b)).toBe(false);
  });

  it('is off for a guest, even a paid, allowlisted one', async () => {
    // The stub auth.users this suite runs against has no is_anonymous column;
    // it is added inside a transaction that is rolled back.
    await client.query(`CREATE SCHEMA IF NOT EXISTS auth`);
    await client.query(`CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)`);
    await client.query('BEGIN');
    try {
      await client.query(
        `ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_anonymous boolean NOT NULL DEFAULT false`,
      );
      await client.query(
        `INSERT INTO auth.users (id) VALUES ($1), ($2) ON CONFLICT (id) DO NOTHING`,
        [a, b],
      );
      await client.query(`UPDATE auth.users SET is_anonymous = true WHERE id = $1`, [a]);
      await flagOn();
      await subscribe(a, 'pro');
      await subscribe(b, 'pro');
      await client.query(`INSERT INTO screenshot_import_allowlist (profile_id) VALUES ($1)`, [a]);
      expect(await enabled(a)).toBe(false);
      expect(await enabled(b)).toBe(true);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('is off for no one at all', async () => {
    const { rows } = await client.query(`SELECT public.waves_screenshot_import_enabled(NULL) AS e`);
    expect(rows[0].e).toBe(false);
  });
});

describe('access control', () => {
  it('lets a person read only their own usage and write none', async () => {
    await reserve(a);
    await reserve(b);
    await asRole(client, 'authenticated', { sub: a, role: 'authenticated' }, async () => {
      const { rows } = await client.query(`SELECT profile_id FROM ai_usage`);
      expect(rows.map((r) => r.profile_id)).toEqual([a]);
    });
    await expectDenied(
      asRole(client, 'authenticated', { sub: a, role: 'authenticated' }, () =>
        client.query(`UPDATE ai_usage SET count = 0`),
      ),
    );
  });

  it('keeps the meter, the gate and the allowlist away from clients', async () => {
    for (const sql of [
      `SELECT public.waves_screenshot_import_quota('${a}')`,
      `SELECT public.waves_ai_usage_reserve('${a}', 'screenshot_import', 5)`,
      `SELECT public.waves_ai_usage_refund('${a}', 'screenshot_import')`,
      `SELECT public.waves_screenshot_import_enabled('${a}')`,
      `SELECT * FROM public.screenshot_import_allowlist`,
    ]) {
      await expectDenied(
        asRole(client, 'authenticated', { sub: a, role: 'authenticated' }, () => client.query(sql)),
      );
    }
  });
});
