/**
 * Rewarded ads for Free (migration 20261016090000_rewarded_ads).
 *
 * waves_ads_grant is the one writer (service role, after admob-ssv has checked
 * Google's signature): idempotent on transaction_id, refuses anyone not eligible,
 * stops at the daily cap. The credit then lifts the Free monthly allowance of
 * voice commands and of receipt scans for the month it was earned in. Deepgram
 * streaming is refused to Free by waves_voice_stream_mint.
 *
 * Tests that switch role (asRole) manage their own transaction, so these tests
 * commit their rows and remove them again afterwards.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { asRole, connect, expectDenied } from './helpers';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client.end();
});

const made: string[] = [];

beforeEach(async () => {
  await client.query(
    `UPDATE feature_flags SET enabled = true, rollout_percent = 100 WHERE key = 'ads_rewarded'`,
  );
  await client.query(`UPDATE feature_flags SET enabled = false WHERE key = 'voice_agent'`);
});

afterEach(async () => {
  // Cascades remove rewards, allowlist rows, subscriptions, usage and trials.
  await client.query(`DELETE FROM pro_trials WHERE profile_id = ANY($1::uuid[])`, [made]);
  await client.query(`DELETE FROM voice_agent_usage WHERE profile_id = ANY($1::uuid[])`, [made]);
  await client.query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [made]);
  made.length = 0;
  await client.query(
    `UPDATE ad_reward_settings SET voice_per_ad = 2, scans_per_ad = 2, daily_cap = 3, min_account_age_days = 7`,
  );
  await client.query(
    `UPDATE feature_flags SET enabled = false, rollout_percent = 0 WHERE key = 'ads_rewarded'`,
  );
});

/** A profile that is `ageDays` old. */
async function person(ageDays = 30): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO profiles (id, display_name, default_currency, created_at)
     VALUES ($1, 'Person', 'INR', now() - make_interval(days => $2))`,
    [id, ageDays],
  );
  made.push(id);
  return id;
}

const grant = async (profile: string, kind = 'voice', tx = randomUUID(), unit = '123') =>
  (
    await client.query(`SELECT public.waves_ads_grant($1, $2, $3, $4) AS g`, [
      profile,
      kind,
      tx,
      unit,
    ])
  ).rows[0].g as Record<string, unknown>;

const eligibility = async (profile: string) =>
  (await client.query(`SELECT public.waves_ads_eligibility($1) AS e`, [profile])).rows[0]
    .e as Record<string, unknown>;

const voice = async (profile: string, free = 10) =>
  (await client.query(`SELECT public.waves_voice_agent_quota($1, $2) AS q`, [profile, free]))
    .rows[0].q as Record<string, unknown>;

function subscribe(profile: string, tier: string, store: string) {
  return client.query(
    `INSERT INTO subscriptions (profile_id, tier, period, status, current_period_end, store, store_txn_id)
     VALUES ($1, $2, 'monthly', 'active', now() + interval '20 days', $3, $3 || ':' || gen_random_uuid()::text)`,
    [profile, tier, store],
  );
}

describe('defaults', () => {
  it('ships the settings row and the flag off at 0%', async () => {
    const settings = await client.query(`SELECT * FROM ad_reward_settings`);
    expect(settings.rows).toHaveLength(1);
    expect(settings.rows[0]).toMatchObject({
      voice_per_ad: 2,
      scans_per_ad: 2,
      daily_cap: 3,
      min_account_age_days: 7,
    });
    const flag = await client.query(
      `SELECT description FROM feature_flags WHERE key = 'ads_rewarded'`,
    );
    expect(flag.rows).toHaveLength(1);
  });

  it('is off for everyone while the flag is off, except the allowlist', async () => {
    const a = await person();
    const b = await person();
    await client.query(
      `UPDATE feature_flags SET enabled = false, rollout_percent = 0 WHERE key = 'ads_rewarded'`,
    );
    expect(await eligibility(a)).toMatchObject({ eligible: false, reason: 'disabled' });
    expect(await grant(a)).toMatchObject({ outcome: 'ineligible', reason: 'disabled' });
    await client.query(`INSERT INTO ads_allowlist (profile_id) VALUES ($1)`, [b]);
    expect(await eligibility(b)).toMatchObject({ eligible: true, reason: null });
  });

  it('honours the rollout percentage', async () => {
    const people = await Promise.all(Array.from({ length: 40 }, () => person()));
    await client.query(`UPDATE feature_flags SET rollout_percent = 50 WHERE key = 'ads_rewarded'`);
    const on = await Promise.all(
      people.map(
        async (p) =>
          (await client.query(`SELECT public.waves_ads_enabled($1) AS e`, [p])).rows[0]
            .e as boolean,
      ),
    );
    const count = on.filter(Boolean).length;
    expect(count).toBeGreaterThan(5);
    expect(count).toBeLessThan(35);
  });
});

describe('eligibility', () => {
  it('lets an old enough Free account in', async () => {
    const a = await person();
    expect(await eligibility(a)).toEqual({
      eligible: true,
      reason: null,
      usedToday: 0,
      dailyCap: 3,
      voicePerAd: 2,
      scansPerAd: 2,
    });
  });

  it('refuses an account younger than min_account_age_days', async () => {
    const a = await person(2);
    expect(await eligibility(a)).toMatchObject({ eligible: false, reason: 'too_new' });
    expect(await grant(a)).toMatchObject({ outcome: 'ineligible', reason: 'too_new' });
  });

  it('refuses a guest', async () => {
    // auth.users is a stub here: keep it inside a transaction that is rolled back.
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA IF NOT EXISTS auth`);
    await client.query(`CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)`);
    await client.query(
      `ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_anonymous boolean NOT NULL DEFAULT false`,
    );
    const a = await person();
    await client.query(`INSERT INTO auth.users (id, is_anonymous) VALUES ($1, true)`, [a]);
    try {
      expect(await eligibility(a)).toMatchObject({ eligible: false, reason: 'guest' });
    } finally {
      await client.query('ROLLBACK');
      made.length = 0;
    }
  });

  it('refuses Plus and Pro, bought or promo', async () => {
    const plus = await person();
    const pro = await person();
    await subscribe(plus, 'plus', 'play');
    await subscribe(pro, 'pro', 'promo');
    expect(await eligibility(plus)).toMatchObject({ eligible: false, reason: 'paid' });
    expect(await eligibility(pro)).toMatchObject({ eligible: false, reason: 'paid' });
  });

  it('refuses during the Pro trial and its voice pool', async () => {
    const a = await person();
    await subscribe(a, 'pro', 'trial');
    await client.query(
      `INSERT INTO pro_trials (profile_id, outcome, granted_at, expires_at)
       VALUES ($1, 'granted', now(), now() + interval '15 days')`,
      [a],
    );
    expect(await eligibility(a)).toMatchObject({ eligible: false, reason: 'trial' });
    // Day 20: the Pro days are over, the voice pool still runs.
    await client.query(`UPDATE pro_trials SET granted_at = now() - interval '20 days'`);
    await client.query(`UPDATE subscriptions SET status = 'expired' WHERE profile_id = $1`, [a]);
    expect(await eligibility(a)).toMatchObject({ eligible: false, reason: 'trial' });
    // Day 31: back to plain Free.
    await client.query(`UPDATE pro_trials SET granted_at = now() - interval '31 days'`);
    expect(await eligibility(a)).toMatchObject({ eligible: true });
  });

  it('is never eligible for an unknown or null profile', async () => {
    expect(await eligibility(randomUUID())).toMatchObject({ eligible: false });
    const { rows } = await client.query(`SELECT public.waves_ads_eligibility(NULL) AS e`);
    expect(rows[0].e).toMatchObject({ eligible: false });
  });
});

describe('waves_ads_grant', () => {
  it('records one row and answers granted', async () => {
    const a = await person();
    const tx = randomUUID();
    expect(await grant(a, 'voice', tx, '555')).toMatchObject({
      outcome: 'granted',
      kind: 'voice',
      amount: 2,
      usedToday: 1,
      dailyCap: 3,
    });
    const { rows } = await client.query(`SELECT * FROM ad_rewards WHERE profile_id = $1`, [a]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'voice',
      amount: 2,
      transaction_id: tx,
      ad_unit: '555',
    });
  });

  it('is idempotent on transaction_id', async () => {
    const a = await person();
    const tx = randomUUID();
    expect(await grant(a, 'scan', tx)).toMatchObject({ outcome: 'granted', amount: 2 });
    expect(await grant(a, 'scan', tx)).toEqual({ outcome: 'duplicate' });
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM ad_rewards`);
    expect(rows[0].n).toBe(1);
  });

  it('refuses a transaction id already used by someone else, without a second row', async () => {
    const a = await person();
    const b = await person();
    const tx = randomUUID();
    await grant(a, 'voice', tx);
    expect(await grant(b, 'voice', tx)).toEqual({ outcome: 'duplicate' });
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM ad_rewards WHERE profile_id = $1`,
      [b],
    );
    expect(rows[0].n).toBe(0);
  });

  it('stops at the daily cap and records nothing past it', async () => {
    const a = await person();
    for (let i = 0; i < 3; i += 1) expect(await grant(a)).toMatchObject({ outcome: 'granted' });
    expect(await grant(a)).toEqual({ outcome: 'capped', reason: 'capped' });
    expect(await eligibility(a)).toMatchObject({ eligible: false, reason: 'capped', usedToday: 3 });
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM ad_rewards WHERE profile_id = $1`,
      [a],
    );
    expect(rows[0].n).toBe(3);
    // Yesterday's rewards do not count towards today's cap.
    await client.query(`UPDATE ad_rewards SET created_at = now() - interval '2 days'`);
    expect(await grant(a)).toMatchObject({ outcome: 'granted' });
  });

  it('reads the cap and the amounts from the settings row', async () => {
    const a = await person();
    await client.query(
      `UPDATE ad_reward_settings SET daily_cap = 1, voice_per_ad = 5, scans_per_ad = 4`,
    );
    expect(await grant(a, 'voice')).toMatchObject({ outcome: 'granted', amount: 5 });
    expect(await grant(a, 'scan')).toMatchObject({ outcome: 'capped' });
    await client.query(`UPDATE ad_reward_settings SET daily_cap = 3`);
    expect(await grant(a, 'scan')).toMatchObject({ outcome: 'granted', amount: 4 });
  });

  it('rejects a bad kind, an empty transaction id and an unknown profile', async () => {
    const a = await person();
    expect(await grant(a, 'banner')).toEqual({ outcome: 'invalid' });
    expect(await grant(a, 'voice', '  ')).toEqual({ outcome: 'invalid' });
    expect(await grant(a, 'voice', randomUUID(), '')).toEqual({ outcome: 'invalid' });
    expect(await grant(randomUUID())).toMatchObject({ outcome: 'ineligible' });
    const { rows } = await client.query(
      `SELECT public.waves_ads_grant(NULL, 'voice', 'x', 'y') AS g`,
    );
    expect(rows[0].g).toEqual({ outcome: 'invalid' });
  });

  it('refuses a paid account even with a valid callback', async () => {
    const a = await person();
    await subscribe(a, 'plus', 'appstore');
    expect(await grant(a)).toMatchObject({ outcome: 'ineligible', reason: 'paid' });
  });
});

describe('voice credit', () => {
  it('is used after the monthly ten, and is not counted twice', async () => {
    const a = await person();
    await grant(a, 'voice');
    for (let i = 1; i <= 12; i += 1) {
      expect(await voice(a)).toMatchObject({ used: i, limit: 12, tier: 'free', allowed: true });
    }
    expect(await voice(a)).toMatchObject({ used: 12, limit: 12, allowed: false });
  });

  it('adds up across ads and leaves scans alone', async () => {
    const a = await person();
    await grant(a, 'voice');
    await grant(a, 'voice');
    await grant(a, 'scan');
    expect(await voice(a)).toMatchObject({ limit: 14 });
    const { rows } = await client.query(`SELECT public.waves_ads_bonus($1, 'scan') AS b`, [a]);
    expect(rows[0].b).toBe(2);
  });

  it('is only valid for the month it was earned in', async () => {
    const a = await person();
    await grant(a, 'voice');
    await client.query(
      `UPDATE ad_rewards SET created_at = date_trunc('month', now()) - interval '1 day'`,
    );
    expect(await voice(a)).toMatchObject({ limit: 10 });
  });

  it('gives a refunded command back to the bonus pool', async () => {
    const a = await person();
    await grant(a, 'voice');
    for (let i = 0; i < 11; i += 1) await voice(a);
    await client.query(`SELECT public.waves_voice_agent_refund($1)`, [a]);
    expect(await voice(a)).toMatchObject({ used: 11, allowed: true });
  });

  it('does not lift Plus', async () => {
    const a = await person();
    await grant(a, 'voice');
    await subscribe(a, 'plus', 'play');
    expect(await voice(a)).toMatchObject({ tier: 'plus', limit: 50 });
  });
});

describe('scan credit', () => {
  const scansAs = (profile: string) =>
    asRole(
      client,
      'authenticated',
      { sub: profile, role: 'authenticated' },
      async () =>
        (await client.query(`SELECT public.waves_receipt_scan_quota() AS q`)).rows[0].q as Record<
          string,
          unknown
        >,
    );

  it('raises the limit above the Free twenty, for this month only', async () => {
    const a = await person();
    expect(await scansAs(a)).toMatchObject({ used: 0, limit: 20, remaining: 20, bonus: 0 });
    await grant(a, 'scan');
    await grant(a, 'voice');
    expect(await scansAs(a)).toMatchObject({ limit: 22, remaining: 22, bonus: 2 });
    await client.query(`UPDATE ad_rewards SET created_at = now() - interval '40 days'`);
    expect(await scansAs(a)).toMatchObject({ limit: 20, bonus: 0 });
  });

  it('counts scans already used against the larger limit', async () => {
    const a = await person();
    for (let i = 0; i < 20; i += 1) {
      await client.query(
        `INSERT INTO usage_events (profile_id, kind) VALUES ($1, 'receipt_scan')`,
        [a],
      );
    }
    expect(await scansAs(a)).toMatchObject({ used: 20, limit: 20, remaining: 0 });
    await grant(a, 'scan');
    expect(await scansAs(a)).toMatchObject({ used: 20, limit: 22, remaining: 2 });
  });
});

describe('Deepgram streaming is not for Free', () => {
  const mint = async (profile: string) =>
    (await client.query(`SELECT public.waves_voice_stream_mint($1) AS m`, [profile])).rows[0]
      .m as Record<string, unknown>;

  it('refuses Free with a reason, and Plus and the trial still stream', async () => {
    const free = await person();
    const plus = await person();
    const trial = await person();
    await subscribe(plus, 'plus', 'play');
    await subscribe(trial, 'pro', 'trial');
    await client.query(
      `INSERT INTO pro_trials (profile_id, outcome, granted_at, expires_at)
       VALUES ($1, 'granted', now(), now() + interval '15 days')`,
      [trial],
    );
    expect(await mint(free)).toMatchObject({ allowed: false, reason: 'free_tier', tier: 'free' });
    expect(await mint(plus)).toMatchObject({ allowed: true, tier: 'plus' });
    expect(await mint(trial)).toMatchObject({ allowed: true, tier: 'pro', trial: true });
  });
});

describe('waves_my_ads_status', () => {
  it('answers a signed-in person about themselves only', async () => {
    const a = await person();
    const b = await person(1);
    await asRole(client, 'authenticated', { sub: a, role: 'authenticated' }, async () => {
      const { rows } = await client.query(`SELECT public.waves_my_ads_status() AS s`);
      expect(rows[0].s).toMatchObject({ eligible: true });
    });
    await asRole(client, 'authenticated', { sub: b, role: 'authenticated' }, async () => {
      const { rows } = await client.query(`SELECT public.waves_my_ads_status() AS s`);
      expect(rows[0].s).toMatchObject({ eligible: false, reason: 'too_new' });
    });
  });

  it('is closed to signed-out callers', async () => {
    await expectDenied(
      asRole(client, 'anon', {}, () => client.query(`SELECT public.waves_my_ads_status()`)),
    );
  });
});

describe('waves_admin_ads', () => {
  it('summarises per day: by kind, units, unique users, cap hits', async () => {
    const a = await person();
    const b = await person();
    for (let i = 0; i < 3; i += 1) await grant(a, 'voice');
    await grant(b, 'scan');
    const { rows } = await client.query(`SELECT * FROM public.waves_admin_ads(7)`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rewards: '4',
      voice_rewards: '3',
      scan_rewards: '1',
      voice_units: '6',
      scan_units: '2',
      unique_users: '2',
      cap_hits: '1',
    });
  });
});

describe('privileges', () => {
  const serviceOnly = [
    'waves_ads_enabled(uuid)',
    'waves_ads_bonus(uuid, text)',
    'waves_ads_eligibility(uuid)',
    'waves_ads_grant(uuid, text, text, text)',
    'waves_admin_ads(integer)',
  ];

  it('lets only the service role execute the grant and its helpers', async () => {
    for (const fn of serviceOnly) {
      for (const role of ['anon', 'authenticated']) {
        const { rows } = await client.query(
          `SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`,
          [role, `public.${fn}`],
        );
        expect(rows[0].ok, `${role} must not execute ${fn}`).toBe(false);
      }
      const { rows } = await client.query(
        `SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS ok`,
        [`public.${fn}`],
      );
      expect(rows[0].ok, `service_role runs ${fn}`).toBe(true);
    }
  });

  it('denies a signed-in client the grant, the tables and the allowlist', async () => {
    const a = await person();
    for (const sql of [
      `SELECT public.waves_ads_grant('${a}', 'voice', 'x', 'y')`,
      `SELECT * FROM public.ad_rewards`,
      `SELECT * FROM public.ad_reward_settings`,
      `SELECT * FROM public.ads_allowlist`,
      `INSERT INTO public.ad_rewards (profile_id, kind, amount, transaction_id, ad_unit) VALUES ('${a}', 'voice', 2, 't', 'u')`,
    ]) {
      await expectDenied(
        asRole(client, 'authenticated', { sub: a, role: 'authenticated' }, () => client.query(sql)),
      );
      await expectDenied(asRole(client, 'anon', {}, () => client.query(sql)));
    }
  });

  it('lets the service role call the grant', async () => {
    const a = await person();
    const out = await asRole(
      client,
      'service_role',
      { role: 'service_role' },
      async () =>
        (await client.query(`SELECT public.waves_ads_grant($1, 'voice', 'svc-1', 'u') AS g`, [a]))
          .rows[0].g as Record<string, unknown>,
    );
    expect(out).toMatchObject({ outcome: 'granted' });
  });
});
