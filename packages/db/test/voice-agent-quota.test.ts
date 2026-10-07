/**
 * Pro advanced voice: the atomic monthly quota, its refund, the 'pro' tier and
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

async function reserve(profile: string, free = 3, pro = 5): Promise<Record<string, unknown>> {
  const { rows } = await client.query(`SELECT public.waves_voice_agent_quota($1, $2, $3) AS q`, [
    profile,
    free,
    pro,
  ]);
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

  it('gives plus the free allowance and pro (including promo) the pro one', async () => {
    await subscribe(a, 'plus');
    expect(await reserve(a)).toMatchObject({ tier: 'plus', limit: 3 });
    await subscribe(b, 'pro', 'promo', 'NULL');
    expect(await reserve(b)).toMatchObject({ tier: 'pro', limit: 5, allowed: true });
  });

  it('ignores an expired or cancelled pro subscription', async () => {
    await subscribe(a, 'pro', 'play', `now() - interval '1 day'`);
    await client.query(`UPDATE subscriptions SET status = 'cancelled' WHERE profile_id = $1`, [b]);
    expect(await reserve(a)).toMatchObject({ tier: 'free' });
  });

  it('never lets two concurrent calls take the last command', async () => {
    const other = await connect();
    try {
      await reserve(a, 1, 1);
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

  it('follows enabled + rollout_percent for everybody else', async () => {
    await client.query(
      `UPDATE feature_flags SET enabled = true, rollout_percent = 100 WHERE key = 'voice_agent'`,
    );
    expect(await enabled(b)).toBe(true);
    await client.query(`UPDATE feature_flags SET rollout_percent = 0 WHERE key = 'voice_agent'`);
    expect(await enabled(b)).toBe(false);
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
      `SELECT * FROM public.voice_agent_allowlist`,
    ]) {
      await expectDenied(
        asRole(client, 'authenticated', { sub: a, role: 'authenticated' }, () => client.query(sql)),
      );
    }
  });
});
