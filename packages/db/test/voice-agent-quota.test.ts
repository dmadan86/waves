/**
 * Plus and Pro advanced voice: the atomic monthly quota, its refund, the 'pro' tier and
 * the flag/allowlist rule (`voice-agent` edge function, phase 1).
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
  await client.query(`DELETE FROM voice_agent_usage WHERE profile_id = ANY($1::uuid[])`, [[a, b]]);
  await client.query(`DELETE FROM voice_agent_allowlist WHERE profile_id = ANY($1::uuid[])`, [
    [a, b],
  ]);
  await client.query(`DELETE FROM subscriptions WHERE profile_id = ANY($1::uuid[])`, [[a, b]]);
  await client.query(
    `UPDATE feature_flags SET enabled = false, rollout_percent = 0 WHERE key = 'voice_agent'`,
  );
}

beforeEach(reset);
afterAll(async () => {
  await reset();
  await client.end();
});

async function reserve(
  profile: string,
  free = 3,
  pro = 5,
  plus = 4,
): Promise<Record<string, unknown>> {
  const { rows } = await client.query(
    `SELECT public.waves_voice_agent_quota($1, $2, $3, $4) AS q`,
    [profile, free, pro, plus],
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

describe('waves_voice_agent_quota', () => {
  it('reserves one command at a time on the free tier, then refuses without reserving', async () => {
    expect(await reserve(a)).toEqual({ used: 1, limit: 3, tier: 'free', allowed: true });
    await reserve(a);
    expect(await reserve(a)).toEqual({ used: 3, limit: 3, tier: 'free', allowed: true });
    expect(await reserve(a)).toEqual({ used: 3, limit: 3, tier: 'free', allowed: false });
    const { rows } = await client.query(
      `SELECT count FROM voice_agent_usage WHERE profile_id = $1`,
      [a],
    );
    expect(rows[0].count).toBe(3);
  });

  it('gives plus its own allowance and pro (including promo) the pro one', async () => {
    await subscribe(a, 'plus');
    expect(await reserve(a)).toMatchObject({ tier: 'plus', limit: 4 });
    await subscribe(b, 'pro', 'promo', 'NULL');
    expect(await reserve(b)).toMatchObject({ tier: 'pro', limit: 5, allowed: true });
  });

  it('defaults to 10 free, 50 Plus and 150 Pro commands a month', async () => {
    const limitOf = async (p: string) =>
      (
        (await client.query(`SELECT public.waves_voice_agent_quota($1) AS q`, [p])).rows[0].q as {
          limit: number;
        }
      ).limit;
    expect(await limitOf(a)).toBe(10);
    await client.query(`DELETE FROM voice_agent_usage WHERE profile_id = $1`, [a]);
    await subscribe(a, 'plus');
    expect(await limitOf(a)).toBe(50);
    await subscribe(b, 'pro');
    expect(await limitOf(b)).toBe(150);
  });

  it('stops a Plus subscriber at the Plus limit, and a free one at the free limit', async () => {
    await subscribe(a, 'plus');
    for (let i = 0; i < 4; i += 1) expect((await reserve(a)).allowed).toBe(true);
    expect(await reserve(a)).toMatchObject({ used: 4, limit: 4, tier: 'plus', allowed: false });
    expect(await reserve(b, 2)).toMatchObject({ allowed: true });
    await reserve(b, 2);
    expect(await reserve(b, 2)).toMatchObject({ tier: 'free', limit: 2, allowed: false });
  });

  it('ignores an expired or cancelled pro subscription', async () => {
    await subscribe(a, 'pro', 'play', `now() - interval '1 day'`);
    await client.query(`UPDATE subscriptions SET status = 'cancelled' WHERE profile_id = $1`, [b]);
    expect(await reserve(a)).toMatchObject({ tier: 'free' });
  });

  it('never lets two concurrent calls take the last command', async () => {
    const other = await connect();
    try {
      await reserve(a, 1, 1, 1);
      await client.query(`UPDATE voice_agent_usage SET count = 0 WHERE profile_id = $1`, [a]);
      const results = await Promise.all(
        [client, other, client, other].map((c) =>
          c.query(`SELECT public.waves_voice_agent_quota($1, 1, 1) AS q`, [a]),
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
      `INSERT INTO voice_agent_usage (profile_id, month, count) VALUES ($1, '2020-01', 99)`,
      [a],
    );
    expect(await reserve(a)).toMatchObject({ used: 1, allowed: true });
  });

  it('refunds a reserved command, never below zero', async () => {
    await reserve(a);
    const first = await client.query(`SELECT public.waves_voice_agent_refund($1) AS n`, [a]);
    expect(first.rows[0].n).toBe(0);
    const second = await client.query(`SELECT public.waves_voice_agent_refund($1) AS n`, [a]);
    expect(second.rows[0].n).toBe(0);
  });

  it('accepts the pro tier and still rejects an unknown one', async () => {
    await expect(subscribe(a, 'pro')).resolves.toBeDefined();
    await expectDenied(subscribe(b, 'platinum'));
  });
});

describe('waves_voice_agent_enabled', () => {
  const enabled = async (p: string) =>
    (await client.query(`SELECT public.waves_voice_agent_enabled($1) AS e`, [p])).rows[0].e;

  it('is off for everyone while the flag is off', async () => {
    expect(await enabled(a)).toBe(false);
  });

  it('is on for an allowlisted person even while the flag is off', async () => {
    await client.query(`INSERT INTO voice_agent_allowlist (profile_id) VALUES ($1)`, [a]);
    expect(await enabled(a)).toBe(true);
    expect(await enabled(b)).toBe(false);
  });

  it('follows enabled + rollout_percent for a Pro subscriber', async () => {
    await subscribe(b, 'pro');
    await client.query(
      `UPDATE feature_flags SET enabled = true, rollout_percent = 100 WHERE key = 'voice_agent'`,
    );
    expect(await enabled(b)).toBe(true);
    await client.query(`UPDATE feature_flags SET rollout_percent = 0 WHERE key = 'voice_agent'`);
    expect(await enabled(b)).toBe(false);
  });

  it('is off for free even at full rollout, on for Plus and Pro', async () => {
    await client.query(
      `UPDATE feature_flags SET enabled = true, rollout_percent = 100 WHERE key = 'voice_agent'`,
    );
    expect(await enabled(a)).toBe(false);
    await subscribe(a, 'plus');
    expect(await enabled(a)).toBe(true);
    await subscribe(b, 'pro');
    expect(await enabled(b)).toBe(true);
  });

  it('counts a Plus in grace, but not a lapsed Plus', async () => {
    await client.query(
      `UPDATE feature_flags SET enabled = true, rollout_percent = 100 WHERE key = 'voice_agent'`,
    );
    await subscribe(a, 'plus');
    await client.query(`UPDATE subscriptions SET status = 'grace' WHERE profile_id = $1`, [a]);
    expect(await enabled(a)).toBe(true);
    await client.query(
      `UPDATE subscriptions SET current_period_end = now() - interval '1 day' WHERE profile_id = $1`,
      [a],
    );
    expect(await enabled(a)).toBe(false);
  });

  it('counts a promo Pro grant, and not a lapsed or cancelled Pro', async () => {
    await client.query(
      `UPDATE feature_flags SET enabled = true, rollout_percent = 100 WHERE key = 'voice_agent'`,
    );
    await subscribe(a, 'pro', 'play', `now() - interval '1 day'`);
    await client.query(
      `INSERT INTO subscriptions (profile_id, tier, period, status, current_period_end, store)
       VALUES ($1, 'pro', 'monthly', 'cancelled', now() + interval '30 days', 'appstore')`,
      [a],
    );
    expect(await enabled(a)).toBe(false);
    await subscribe(b, 'pro', 'promo', 'NULL');
    expect(await enabled(b)).toBe(true);
  });

  it('counts a Pro in grace, but not past its expiry', async () => {
    await client.query(
      `UPDATE feature_flags SET enabled = true, rollout_percent = 100 WHERE key = 'voice_agent'`,
    );
    await subscribe(b, 'pro');
    await client.query(`UPDATE subscriptions SET status = 'grace' WHERE profile_id = $1`, [b]);
    expect(await enabled(b)).toBe(true);
    await client.query(
      `UPDATE subscriptions SET current_period_end = now() - interval '1 day' WHERE profile_id = $1`,
      [b],
    );
    expect(await enabled(b)).toBe(false);
  });

  it('keeps the kill switch above a subscription', async () => {
    await subscribe(b, 'pro');
    expect(await enabled(b)).toBe(false);
  });

  it('is off for a guest, even a Pro, allowlisted one', async () => {
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
      await client.query(
        `UPDATE feature_flags SET enabled = true, rollout_percent = 100 WHERE key = 'voice_agent'`,
      );
      await subscribe(a, 'pro');
      await subscribe(b, 'pro');
      await client.query(`INSERT INTO voice_agent_allowlist (profile_id) VALUES ($1)`, [a]);
      expect(await enabled(a)).toBe(false);
      expect(await enabled(b)).toBe(true);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('is off for no one at all', async () => {
    const { rows } = await client.query(`SELECT public.waves_voice_agent_enabled(NULL) AS e`);
    expect(rows[0].e).toBe(false);
  });
});

describe('stream mint budget', () => {
  async function mint(
    profile: string,
    free = 2,
    pro = 4,
    plus = 3,
  ): Promise<Record<string, unknown>> {
    const { rows } = await client.query(
      `SELECT public.waves_voice_stream_mint($1, $2, $3, $4) AS m`,
      [profile, free, pro, plus],
    );
    return rows[0].m as Record<string, unknown>;
  }

  it('counts mints up to the budget, then refuses without counting', async () => {
    expect(await mint(a)).toMatchObject({ allowed: true, mints: 1, budget: 2, tier: 'free' });
    expect(await mint(a)).toMatchObject({ allowed: true, mints: 2 });
    expect(await mint(a)).toMatchObject({ allowed: false, mints: 2 });
    expect(await mint(b)).toMatchObject({ allowed: true, mints: 1 });
  });

  it('gives Pro the Pro budget', async () => {
    await subscribe(a, 'pro');
    for (let i = 0; i < 4; i += 1) expect((await mint(a)).allowed).toBe(true);
    expect(await mint(a)).toMatchObject({ allowed: false, mints: 4, tier: 'pro' });
  });

  it('gives Plus the Plus budget', async () => {
    await subscribe(a, 'plus');
    for (let i = 0; i < 3; i += 1) expect((await mint(a)).allowed).toBe(true);
    expect(await mint(a)).toMatchObject({ allowed: false, mints: 3, tier: 'plus' });
  });

  it('is its own meter: mints spend no command and commands spend no mint', async () => {
    await mint(a);
    await reserve(a);
    const { rows } = await client.query(
      `SELECT count, stream_mints FROM voice_agent_usage WHERE profile_id = $1`,
      [a],
    );
    expect(rows[0]).toEqual({ count: 1, stream_mints: 1 });
  });

  it('cannot be overspent by concurrent mints', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, async () => {
        const c = await connect();
        try {
          const { rows } = await c.query(`SELECT public.waves_voice_stream_mint($1, 3, 3) AS m`, [
            a,
          ]);
          return (rows[0].m as { allowed: boolean }).allowed;
        } finally {
          await c.end();
        }
      }),
    );
    expect(results.filter(Boolean)).toHaveLength(3);
  });
});

describe('access control', () => {
  it('lets a person read only their own usage and write none', async () => {
    await reserve(a);
    await reserve(b);
    await asRole(client, 'authenticated', { sub: a, role: 'authenticated' }, async () => {
      const { rows } = await client.query(`SELECT profile_id FROM voice_agent_usage`);
      expect(rows.map((r) => r.profile_id)).toEqual([a]);
    });
    await expectDenied(
      asRole(client, 'authenticated', { sub: a, role: 'authenticated' }, () =>
        client.query(`UPDATE voice_agent_usage SET count = 0`),
      ),
    );
  });

  it('keeps the quota, refund, flag and allowlist away from clients', async () => {
    for (const sql of [
      `SELECT public.waves_voice_agent_quota('${a}')`,
      `SELECT public.waves_voice_agent_refund('${a}')`,
      `SELECT public.waves_voice_agent_enabled('${a}')`,
      `SELECT public.waves_voice_stream_mint('${a}')`,
      `SELECT * FROM public.voice_agent_allowlist`,
    ]) {
      await expectDenied(
        asRole(client, 'authenticated', { sub: a, role: 'authenticated' }, () => client.query(sql)),
      );
    }
  });
});
