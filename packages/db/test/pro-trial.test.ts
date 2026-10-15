/**
 * The automatic 15-day Pro trial (migration 20261015220000_pro_trial).
 *
 * waves_pro_trial_grant gives a new, verified, non-guest account 15 days of Pro
 * once (a subscriptions row, store 'trial'); the identity keys outlive the
 * account; existing accounts and accounts with a plan get nothing; the voice
 * quota on the trial is 20 in total; a purchase takes precedence.
 *
 * Every test runs in a transaction that is rolled back, on a stub auth.users
 * widened with the columns the verification check reads (as referrals.test.ts).
 */

import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { asRole, connect } from './helpers';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client.end();
});

beforeEach(async () => {
  await client.query('BEGIN');
  await client.query(`CREATE SCHEMA IF NOT EXISTS auth`);
  await client.query(`CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)`);
  for (const column of [
    'is_anonymous boolean NOT NULL DEFAULT false',
    'phone text',
    'phone_confirmed_at timestamptz',
    'email text',
    'email_confirmed_at timestamptz',
  ]) {
    await client.query(`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS ${column}`);
  }
  // The trial launched yesterday: accounts verified before that are "existing".
  await client.query(`UPDATE pro_trial_settings SET launched_at = now() - interval '1 day'`);
});

afterEach(async () => {
  await client.query('ROLLBACK');
});

interface PersonOptions {
  phone?: string;
  email?: string;
  guest?: boolean;
  unverified?: boolean;
  /** Days since the account was verified. Default 0: just now. */
  verifiedDaysAgo?: number;
}

function digits(n: number): string {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
}

async function person(options: PersonOptions = {}, id: string = randomUUID()): Promise<string> {
  await client.query(
    `INSERT INTO profiles (id, display_name, default_currency) VALUES ($1, 'Person', 'INR')
     ON CONFLICT (id) DO NOTHING`,
    [id],
  );
  const phone =
    options.unverified || options.guest || options.email
      ? null
      : (options.phone ?? `9199${digits(8)}`);
  const email = options.unverified || options.guest ? null : (options.email ?? null);
  await client.query(
    `INSERT INTO auth.users (id, is_anonymous, phone, phone_confirmed_at, email, email_confirmed_at)
     VALUES ($1, $2, $3, CASE WHEN $3::text IS NULL THEN NULL ELSE now() - make_interval(days => $5) END,
             $4, CASE WHEN $4::text IS NULL THEN NULL ELSE now() - make_interval(days => $5) END)`,
    [id, options.guest ?? false, phone, email, options.verifiedDaysAgo ?? 0],
  );
  return id;
}

const grant = async (id: string) =>
  (await client.query(`SELECT waves_pro_trial_grant($1) AS g`, [id])).rows[0].g as {
    granted: boolean;
    reason?: string;
  };

const plan = async (id: string) =>
  (await client.query(`SELECT waves_my_plan($1) AS p`, [id])).rows[0].p as Record<string, unknown>;

const trialRows = async (id: string) =>
  (
    await client.query(
      `SELECT tier, store, status, store_txn_id, current_period_end,
              current_period_end - now() AS left
         FROM subscriptions WHERE profile_id = $1 AND store = 'trial'`,
      [id],
    )
  ).rows;

const quota = async (id: string) =>
  (await client.query(`SELECT waves_voice_agent_quota($1) AS q`, [id])).rows[0].q as Record<
    string,
    unknown
  >;

function subscribe(
  profile: string,
  tier: string,
  store: string,
  end = `now() + interval '30 days'`,
) {
  return client.query(
    `INSERT INTO subscriptions (profile_id, tier, period, status, current_period_end, store, store_txn_id)
     VALUES ($1, $2, 'monthly', 'active', ${end}, $3, $3 || ':' || gen_random_uuid()::text)`,
    [profile, tier, store],
  );
}

describe('who gets the trial', () => {
  it('gives a new verified account 15 days of Pro, marked store trial', async () => {
    const id = await person();
    expect(await grant(id)).toMatchObject({ granted: true });
    const rows = await trialRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tier: 'pro',
      store: 'trial',
      status: 'active',
      store_txn_id: `trial:${id}`,
    });
    // Between 14.99 and 15 days.
    const { rows: d } = await client.query(
      `SELECT extract(epoch FROM $1::interval) / 86400 AS days`,
      [rows[0].left],
    );
    expect(Number(d[0].days)).toBeGreaterThan(14.99);
    expect(Number(d[0].days)).toBeLessThanOrEqual(15);
    expect(await plan(id)).toMatchObject({
      plan: 'pro',
      tier: 'plus',
      trial: true,
      trialVoiceLimit: 20,
      trialVoiceUsed: 0,
    });
  });

  it('is idempotent', async () => {
    const id = await person();
    await grant(id);
    expect(await grant(id)).toMatchObject({ granted: false, reason: 'ALREADY_GRANTED' });
    expect(await trialRows(id)).toHaveLength(1);
  });

  it('gives the same phone nothing when the account is deleted and re-created', async () => {
    const phone = `9188${digits(8)}`;
    const first = await person({ phone });
    await grant(first);
    await client.query(`DELETE FROM subscriptions WHERE profile_id = $1`, [first]);
    await client.query(`DELETE FROM auth.users WHERE id = $1`, [first]);
    await client.query(`DELETE FROM profiles WHERE id = $1`, [first]);
    const again = await person({ phone });
    expect(await grant(again)).toMatchObject({ granted: false, reason: 'IDENTITY_REUSED' });
    expect(await trialRows(again)).toHaveLength(0);
    expect(await plan(again)).toMatchObject({ plan: 'free' });
  });

  it('gives the same email nothing under a different phone', async () => {
    const email = `Same.${digits(6)}@Example.com`;
    const first = await person({ email });
    await grant(first);
    const second = await person({ email: email.toLowerCase() });
    expect(await grant(second)).toMatchObject({ granted: false, reason: 'IDENTITY_REUSED' });
  });

  it('gives a guest or an unverified account nothing', async () => {
    const guest = await person({ guest: true });
    expect(await grant(guest)).toMatchObject({ granted: false, reason: 'GUEST' });
    const unverified = await person({ unverified: true });
    expect(await grant(unverified)).toMatchObject({ granted: false, reason: 'NOT_VERIFIED' });
    expect(await trialRows(guest)).toHaveLength(0);
  });

  it('gives an account that was already real before launch nothing (no backfill)', async () => {
    const old = await person({ verifiedDaysAgo: 30 });
    expect(await grant(old)).toMatchObject({ granted: false, reason: 'EXISTING_ACCOUNT' });
    expect(await trialRows(old)).toHaveLength(0);
  });

  it('gives an account with a paid or promo plan nothing, and never later either', async () => {
    const paid = await person();
    await subscribe(paid, 'plus', 'play');
    expect(await grant(paid)).toMatchObject({ granted: false, reason: 'HAS_PLAN' });
    const promo = await person();
    await subscribe(promo, 'plus', 'promo');
    expect(await grant(promo)).toMatchObject({ granted: false, reason: 'HAS_PLAN' });
    // The plan lapses; a later login must not grant a trial.
    await client.query(
      `UPDATE subscriptions SET current_period_end = now() - interval '1 day' WHERE profile_id = $1`,
      [paid],
    );
    expect(await grant(paid)).toMatchObject({ granted: false, reason: 'ALREADY_GRANTED' });
    expect(await trialRows(paid)).toHaveLength(0);
  });
});

describe('the trigger on auth.users', () => {
  beforeEach(async () => {
    await client.query(
      `CREATE TRIGGER waves_pro_trial_on_auth_user AFTER INSERT OR UPDATE ON auth.users
         FOR EACH ROW EXECUTE FUNCTION public.waves_pro_trial_after_auth_user()`,
    );
  });

  it('grants when a verified account is created', async () => {
    const id = await person();
    expect(await trialRows(id)).toHaveLength(1);
  });

  it('grants when a guest becomes a real account, and not for the guest', async () => {
    const id = await person({ guest: true });
    expect(await trialRows(id)).toHaveLength(0);
    await client.query(
      `UPDATE auth.users SET is_anonymous = false, phone = '9177' || $2, phone_confirmed_at = now() WHERE id = $1`,
      [id, digits(8)],
    );
    expect(await trialRows(id)).toHaveLength(1);
  });

  it('does nothing for an unrelated update of an existing account', async () => {
    const old = await person({ verifiedDaysAgo: 30 });
    await client.query(`UPDATE auth.users SET phone = phone WHERE id = $1`, [old]);
    expect(await trialRows(old)).toHaveLength(0);
  });
});

describe('when the trial ends or a purchase arrives', () => {
  it('falls back to Free on expiry, or to the referral Plus days that follow it', async () => {
    const id = await person();
    await grant(id);
    // Referral days start where the coverage ends: after the trial.
    await client.query(
      `INSERT INTO subscriptions (profile_id, tier, period, status, current_period_end, store, store_txn_id)
       VALUES ($1, 'plus', 'monthly', 'active',
               (SELECT current_period_end FROM subscriptions WHERE profile_id = $1 AND store = 'trial') + interval '7 days',
               'promo', 'referral:test:' || $1::text)`,
      [id],
    );
    expect(await plan(id)).toMatchObject({ plan: 'pro', trial: true });
    await client.query(
      `UPDATE subscriptions SET current_period_end = now() - interval '1 minute' WHERE profile_id = $1 AND store = 'trial'`,
      [id],
    );
    const after = await plan(id);
    expect(after).toMatchObject({ plan: 'plus' });
    expect(after.trial).toBeUndefined();

    const solo = await person();
    await grant(solo);
    await client.query(
      `UPDATE subscriptions SET current_period_end = now() - interval '1 minute' WHERE profile_id = $1`,
      [solo],
    );
    expect(await plan(solo)).toMatchObject({ plan: 'free' });
    expect(await quota(solo)).toMatchObject({ tier: 'free', limit: 10 });
  });

  it('lets a store purchase take precedence over the trial', async () => {
    const id = await person();
    await grant(id);
    await subscribe(id, 'pro', 'play');
    const p = await plan(id);
    expect(p).toMatchObject({ plan: 'pro' });
    expect(p.trial).toBeUndefined();
    expect(await quota(id)).toMatchObject({ tier: 'pro', limit: 150, allowed: true });

    const plusBuyer = await person();
    await grant(plusBuyer);
    await subscribe(plusBuyer, 'plus', 'appstore');
    expect(await plan(plusBuyer)).toMatchObject({ plan: 'plus' });
    expect(await quota(plusBuyer)).toMatchObject({ tier: 'plus', limit: 50 });
  });
});

describe('voice on the trial', () => {
  it('allows 20 commands in total, then refuses, without touching the monthly count', async () => {
    const id = await person();
    await grant(id);
    expect(await quota(id)).toEqual({
      used: 1,
      limit: 20,
      tier: 'pro',
      trial: true,
      allowed: true,
    });
    for (let i = 0; i < 19; i += 1) expect((await quota(id)).allowed).toBe(true);
    expect(await quota(id)).toEqual({
      used: 20,
      limit: 20,
      tier: 'pro',
      trial: true,
      allowed: false,
    });
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM voice_agent_usage WHERE profile_id = $1`,
      [id],
    );
    expect(rows[0].n).toBe(0);
    expect(await plan(id)).toMatchObject({ trialVoiceUsed: 20 });
  });

  it('refunds a trial command, never below zero', async () => {
    const id = await person();
    await grant(id);
    await quota(id);
    const first = await client.query(`SELECT waves_voice_agent_refund($1) AS n`, [id]);
    expect(first.rows[0].n).toBe(0);
    const second = await client.query(`SELECT waves_voice_agent_refund($1) AS n`, [id]);
    expect(second.rows[0].n).toBe(0);
    expect(await quota(id)).toMatchObject({ used: 1 });
  });

  it('is on during the trial and off after it, and still refuses free users', async () => {
    await client.query(
      `UPDATE feature_flags SET enabled = true, rollout_percent = 100 WHERE key = 'voice_agent'`,
    );
    const enabled = async (p: string) =>
      (await client.query(`SELECT waves_voice_agent_enabled($1) AS e`, [p])).rows[0].e;
    const free = await person({ verifiedDaysAgo: 30 });
    expect(await enabled(free)).toBe(false);
    expect(await quota(free)).toMatchObject({ tier: 'free', limit: 10 });
    const id = await person();
    await grant(id);
    expect(await enabled(id)).toBe(true);
    await client.query(
      `UPDATE subscriptions SET current_period_end = now() - interval '1 minute' WHERE profile_id = $1`,
      [id],
    );
    expect(await enabled(id)).toBe(false);
  });

  it('has its own stream budget of 60', async () => {
    const id = await person();
    await grant(id);
    const { rows } = await client.query(`SELECT waves_voice_stream_mint($1) AS m`, [id]);
    expect(rows[0].m).toMatchObject({ budget: 60, tier: 'pro', trial: true, allowed: true });
  });
});

describe('waves_my_plan caller scoping', () => {
  it("gives a signed-in user their own plan even when they pass someone else's id", async () => {
    const mine = await person();
    const theirs = await person();
    await grant(theirs);
    expect(await plan(theirs)).toMatchObject({ plan: 'pro', trial: true });
    const seen = await asRole(
      client,
      'authenticated',
      { sub: mine, role: 'authenticated' },
      async () => (await client.query(`SELECT waves_my_plan($1) AS p`, [theirs])).rows[0].p,
    );
    expect(seen).toMatchObject({ plan: 'free' });
    expect(seen.trial).toBeUndefined();
  });
});

describe('privileges', () => {
  const fns = [
    'waves_pro_trial_active(uuid)',
    'waves_pro_trial_grant(uuid)',
    'waves_pro_trial_after_auth_user()',
    'waves_voice_agent_quota(uuid, integer, integer, integer, integer)',
    'waves_voice_agent_refund(uuid)',
    'waves_voice_stream_mint(uuid, integer, integer, integer, integer)',
    'waves_voice_agent_enabled(uuid)',
    'waves_revenuecat_apply(text, text, text, timestamptz, jsonb)',
  ];

  it('lets only the service role execute them', async () => {
    for (const fn of fns) {
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

  it('leaves no stale overload of the quota or mint functions', async () => {
    const { rows } = await client.query(
      `SELECT proname, pronargs FROM pg_proc
        WHERE pronamespace = 'public'::regnamespace
          AND proname IN ('waves_voice_agent_quota', 'waves_voice_stream_mint')`,
    );
    expect(rows.every((r) => r.pronargs === 5)).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it('keeps the trial tables away from clients', async () => {
    for (const table of ['pro_trials', 'pro_trial_settings']) {
      for (const role of ['anon', 'authenticated']) {
        const { rows } = await client.query(`SELECT has_table_privilege($1, $2, 'SELECT') AS ok`, [
          role,
          `public.${table}`,
        ]);
        expect(rows[0].ok).toBe(false);
      }
    }
  });
});
