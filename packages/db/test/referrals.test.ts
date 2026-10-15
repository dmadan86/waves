/**
 * Referral rewards (migration 20261015140000_referral_rewards).
 *
 * A friend claims a code after signing up; once they are verified and have
 * recorded a real expense in a group of two or more, both sides get 7 days of
 * Plus, capped at 30 earned days per account.
 *
 * Every test runs inside a transaction that is rolled back, on a stub
 * `auth.users` that this file widens with the columns the verification check
 * reads (the same trick join-requires-account.test.ts uses).
 */

import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect } from './helpers';

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
});

afterEach(async () => {
  await client.query('ROLLBACK');
});

interface PersonOptions {
  /** Confirmed phone, bare digits as Supabase stores it. */
  phone?: string;
  /** Confirmed email (what an OAuth sign-in records). */
  email?: string;
  /** Minutes since the profile was created. Default 0: just signed up. */
  ageMinutes?: number;
  /** Days since the phone/email was confirmed (the account became real). Default 0: just now. */
  verifiedDaysAgo?: number;
  /** No confirmed identity at all. */
  unverified?: boolean;
}

async function person(options: PersonOptions = {}): Promise<string> {
  const id = randomUUID();
  const age = options.ageMinutes ?? 0;
  await client.query(
    `INSERT INTO profiles (id, display_name, default_currency, created_at)
     VALUES ($1, 'Person', 'INR', now() - make_interval(mins => $2))`,
    [id, age],
  );
  const phone =
    options.phone ?? (options.unverified || options.email ? null : `9199${randomDigits(8)}`);
  await client.query(
    `INSERT INTO auth.users (id, phone, phone_confirmed_at, email, email_confirmed_at)
     VALUES ($1, $2, CASE WHEN $2::text IS NULL THEN NULL ELSE now() - make_interval(days => $4) END,
                 $3, CASE WHEN $3::text IS NULL THEN NULL ELSE now() - make_interval(days => $4) END)`,
    [
      id,
      options.unverified ? null : phone,
      options.unverified ? null : (options.email ?? null),
      options.verifiedDaysAgo ?? 0,
    ],
  );
  return id;
}

function randomDigits(n: number): string {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
}

async function asUser<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  return run();
}

async function myCode(profileId: string): Promise<string> {
  const { rows } = await asUser(profileId, () =>
    client.query(`SELECT public.waves_my_referral() AS r`),
  );
  return (rows[0].r as { code: string }).code;
}

async function claim(profileId: string, code: string): Promise<{ ok: boolean; reason?: string }> {
  const { rows } = await asUser(profileId, () =>
    client.query(`SELECT public.waves_claim_referral($1) AS r`, [code]),
  );
  return rows[0].r;
}

async function summary(profileId: string): Promise<Record<string, number>> {
  const { rows } = await asUser(profileId, () =>
    client.query(`SELECT public.waves_my_referral() AS r`),
  );
  return rows[0].r;
}

/** A group with the given profiles as active members. Returns member ids in order. */
async function group(profiles: string[]): Promise<{ groupId: string; members: string[] }> {
  const groupId = randomUUID();
  await client.query(
    `INSERT INTO groups (id, name, type, default_currency, created_by)
     VALUES ($1, 'Flat', 'trip', 'INR', $2)`,
    [groupId, profiles[0]],
  );
  const members: string[] = [];
  for (const profileId of profiles) {
    members.push(await addMember(groupId, profileId));
  }
  return { groupId, members };
}

async function addMember(groupId: string, profileId: string): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO group_members (id, group_id, profile_id, role, joined_via)
     VALUES ($1, $2, $3, 'member', 'creator')`,
    [id, groupId, profileId],
  );
  return id;
}

async function expense(groupId: string, memberId: string): Promise<string> {
  const id = randomUUID();
  await client.query(`INSERT INTO expenses (id, group_id, created_by) VALUES ($1, $2, $3)`, [
    id,
    groupId,
    memberId,
  ]);
  return id;
}

async function referralRow(referee: string) {
  const { rows } = await client.query(
    `SELECT status, reject_reason, referrer_days, referee_days FROM referrals WHERE referee_id = $1`,
    [referee],
  );
  return rows[0] as
    | { status: string; reject_reason: string | null; referrer_days: number; referee_days: number }
    | undefined;
}

async function promoDays(profileId: string): Promise<number> {
  const { rows } = await client.query(
    `SELECT COALESCE(round(extract(epoch FROM max(current_period_end) - now()) / 86400), 0)::int AS d
       FROM subscriptions WHERE profile_id = $1 AND store = 'promo'`,
    [profileId],
  );
  return rows[0].d;
}

/** Friend claims, then creates a group with the referrer's friend and records an expense. */
async function friendUsesWaves(referrer: string, options: PersonOptions = {}): Promise<string> {
  const friend = await person(options);
  expect((await claim(friend, await myCode(referrer))).ok).toBe(true);
  const other = await person();
  const g = await group([friend, other]);
  await expense(g.groupId, g.members[0]!);
  return friend;
}

describe('code and claim', () => {
  it('creates a stable, unambiguous code lazily and reports the empty state', async () => {
    const me = await person();
    const code = await myCode(me);
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    expect(await myCode(me)).toBe(code);
    expect(await summary(me)).toMatchObject({
      ok: true,
      invited: 0,
      pending: 0,
      days_earned: 0,
      days_cap: 30,
      days_remaining: 30,
    });
  });

  it('claims a code, tolerating case and separators', async () => {
    const referrer = await person();
    const friend = await person();
    const code = await myCode(referrer);
    const result = await claim(friend, `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`);
    expect(result.ok).toBe(true);
    expect((await referralRow(friend))?.status).toBe('claimed');
    expect(await summary(referrer)).toMatchObject({ invited: 1, pending: 1, rewarded: 0 });
  });

  it('refuses an unknown code', async () => {
    const friend = await person();
    expect(await claim(friend, 'ZZZZZZZZ')).toEqual({ ok: false, reason: 'UNKNOWN_CODE' });
  });

  it('refuses a self-referral', async () => {
    const me = await person();
    expect(await claim(me, await myCode(me))).toEqual({ ok: false, reason: 'SELF_REFERRAL' });
    expect(await referralRow(me)).toBeUndefined();
  });

  it('refuses a second claim, by the same or another referrer', async () => {
    const a = await person();
    const b = await person();
    const friend = await person();
    expect((await claim(friend, await myCode(a))).ok).toBe(true);
    expect(await claim(friend, await myCode(a))).toEqual({ ok: false, reason: 'ALREADY_CLAIMED' });
    expect(await claim(friend, await myCode(b))).toEqual({ ok: false, reason: 'ALREADY_CLAIMED' });
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM referrals WHERE referee_id = $1`,
      [friend],
    );
    expect(rows[0].n).toBe(1);
  });

  it('judges newness by when the account became real, not by the profile age', async () => {
    const referrer = await person();
    const code = await myCode(referrer);
    // A guest profile created 3 hours ago that verified a phone just now.
    const lateSignup = await person({ ageMinutes: 180 });
    expect((await claim(lateSignup, code)).ok).toBe(true);
    // Signed up 2 days ago, pastes a code now.
    const twoDays = await person({ ageMinutes: 3 * 24 * 60, verifiedDaysAgo: 2 });
    expect((await claim(twoDays, code)).ok).toBe(true);
    // Verified 8 days ago.
    const old = await person({ ageMinutes: 9 * 24 * 60, verifiedDaysAgo: 8 });
    expect(await claim(old, code)).toEqual({ ok: false, reason: 'NOT_NEW_USER' });
  });

  it('falls back to the profile age when nothing is confirmed', async () => {
    const referrer = await person();
    const code = await myCode(referrer);
    const stale = await person({ unverified: true, ageMinutes: 8 * 24 * 60 });
    expect(await claim(stale, code)).toEqual({ ok: false, reason: 'NOT_NEW_USER' });
  });

  it('qualifies a guest who browsed for hours before verifying their phone', async () => {
    const referrer = await person();
    const friend = await friendUsesWaves(referrer, { ageMinutes: 180 });
    expect((await referralRow(friend))?.status).toBe('rewarded');
  });

  it('rejects at qualification only when the account joined over 7 days before the claim', async () => {
    const referrer = await person();
    const friend = await person({ unverified: true });
    expect((await claim(friend, await myCode(referrer))).ok).toBe(true);
    await client.query(`UPDATE referrals SET claimed_at = now() + interval '8 days' WHERE referee_id = $1`, [friend]);
    await client.query(`UPDATE auth.users SET phone = $2, phone_confirmed_at = now() WHERE id = $1`, [
      friend,
      `9199${randomDigits(8)}`,
    ]);
    const other = await person();
    const g = await group([friend, other]);
    await expense(g.groupId, g.members[0]!);
    const row = await referralRow(friend);
    expect(row?.status).toBe('rejected');
    expect(row?.reject_reason).toBe('NOT_NEW_USER');
  });

  it('keeps a guest out (and tells the app it can retry once signed up)', async () => {
    const referrer = await person();
    const guest = await person();
    await client.query(`UPDATE auth.users SET is_anonymous = true WHERE id = $1`, [guest]);
    expect(await claim(guest, await myCode(referrer))).toEqual({
      ok: false,
      reason: 'ACCOUNT_REQUIRED',
    });
  });
});

describe('qualification', () => {
  it('rewards nothing for a claim alone', async () => {
    const referrer = await person();
    const friend = await person();
    await claim(friend, await myCode(referrer));
    expect((await referralRow(friend))?.status).toBe('claimed');
    expect(await promoDays(referrer)).toBe(0);
    expect(await promoDays(friend)).toBe(0);
  });

  it('rewards nothing when the friend is not verified', async () => {
    const referrer = await person();
    const friend = await friendUsesWaves(referrer, { unverified: true });
    expect((await referralRow(friend))?.status).toBe('claimed');
    expect(await promoDays(referrer)).toBe(0);
  });

  it('waits for a group of two or more, then rewards when the second person arrives', async () => {
    const referrer = await person();
    const friend = await person();
    await claim(friend, await myCode(referrer));
    const solo = await group([friend]);
    await expense(solo.groupId, solo.members[0]!);
    expect((await referralRow(friend))?.status).toBe('claimed');

    await addMember(solo.groupId, await person());
    expect(await referralRow(friend)).toMatchObject({
      status: 'rewarded',
      referrer_days: 7,
      referee_days: 7,
    });
  });

  it('ignores a deleted expense and one the friend did not create', async () => {
    const referrer = await person();
    const friend = await person();
    await claim(friend, await myCode(referrer));
    const other = await person();
    const g = await group([friend, other]);

    await expense(g.groupId, g.members[1]!);
    expect((await referralRow(friend))?.status).toBe('claimed');

    const mine = await expense(g.groupId, g.members[0]!);
    expect((await referralRow(friend))?.status).toBe('rewarded');
    expect(mine).toBeTruthy();
  });

  it('does not count an expense that is already deleted', async () => {
    const referrer = await person();
    const friend = await person();
    await claim(friend, await myCode(referrer));
    const g = await group([friend, await person()]);
    await client.query(
      `INSERT INTO expenses (id, group_id, created_by, deleted_at) VALUES ($1, $2, $3, now())`,
      [randomUUID(), g.groupId, g.members[0]],
    );
    expect((await referralRow(friend))?.status).toBe('claimed');
  });

  it('rewards both with 7 days of Plus that the plan logic sees, exactly once', async () => {
    const referrer = await person();
    const friend = await friendUsesWaves(referrer);

    expect(await referralRow(friend)).toMatchObject({
      status: 'rewarded',
      referrer_days: 7,
      referee_days: 7,
    });
    expect(await promoDays(referrer)).toBe(7);
    expect(await promoDays(friend)).toBe(7);

    for (const profile of [referrer, friend]) {
      const { rows } = await client.query(
        `SELECT public.waves_my_plan($1) AS p, public.waves_profile_is_paid($1) AS paid`,
        [profile],
      );
      expect(rows[0].p.tier).toBe('plus');
      expect(rows[0].paid).toBe(true);
    }

    // A replay, and a further expense, grant nothing more.
    await client.query(`SELECT public.waves_referral_try_qualify($1)`, [friend]);
    expect(await promoDays(referrer)).toBe(7);
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM subscriptions WHERE store_txn_id LIKE 'referral:%'`,
    );
    expect(rows[0].n).toBe(2);
    expect(await summary(referrer)).toMatchObject({
      rewarded: 1,
      pending: 0,
      days_earned: 7,
      days_remaining: 23,
    });
  });

  it('rewards a friend who signed up with a verified email identity (OAuth)', async () => {
    const referrer = await person();
    const friend = await friendUsesWaves(referrer, { email: `f${randomUUID()}@example.com` });
    expect((await referralRow(friend))?.status).toBe('rewarded');
  });

  it('puts referral days after an existing coverage instead of overlapping it', async () => {
    const referrer = await person();
    await client.query(
      `INSERT INTO subscriptions (profile_id, tier, period, status, current_period_end, store, store_txn_id)
       VALUES ($1, 'plus', 'monthly', 'active', now() + interval '10 days', 'play', $2)`,
      [referrer, `GPA.${randomUUID()}`],
    );
    await friendUsesWaves(referrer);
    const { rows } = await client.query(
      `SELECT round(extract(epoch FROM max(current_period_end) - now()) / 86400)::int AS d
         FROM subscriptions WHERE profile_id = $1`,
      [referrer],
    );
    expect(rows[0].d).toBe(17);
  });
});

describe('the 30 day cap', () => {
  it('gives 7, 7, 7, 7, then 2, then nothing', async () => {
    const referrer = await person();
    const given: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const friend = await friendUsesWaves(referrer);
      given.push((await referralRow(friend))!.referrer_days);
    }
    expect(given).toEqual([7, 7, 7, 7, 2, 0]);
    expect(await summary(referrer)).toMatchObject({
      days_earned: 30,
      days_remaining: 0,
      rewarded: 6,
    });
    // Coverage chains: the last grant ends 30 days from now.
    expect(await promoDays(referrer)).toBe(30);
  });

  it('counts the days a friend earned as a friend toward their own cap', async () => {
    const star = await person();
    // Earned as a friend of someone else: 7. Then refers four people: 7+7+7+7 = 28 -> total 35 > 30.
    const sponsor = await person();
    const starAsFriend = await person();
    await claim(starAsFriend, await myCode(sponsor));
    await expense(
      (await group([starAsFriend, await person()])).groupId,
      (await client.query(`SELECT id FROM group_members WHERE profile_id = $1`, [starAsFriend]))
        .rows[0].id,
    );
    expect((await referralRow(starAsFriend))?.referee_days).toBe(7);

    const given: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const friend = await person();
      await claim(friend, await myCode(starAsFriend));
      const g = await group([friend, await person()]);
      await expense(g.groupId, g.members[0]!);
      given.push((await referralRow(friend))!.referrer_days);
    }
    expect(given).toEqual([7, 7, 7, 2]);
    expect(star).toBeTruthy();
  });
});

describe('one reward per phone / identity', () => {
  it('refuses a friend whose verified phone is the referrer', async () => {
    const referrer = await person({ phone: '919800000001' });
    const friend = await friendUsesWaves(referrer, { phone: '+91 98000 00001' });
    expect(await referralRow(friend)).toMatchObject({
      status: 'rejected',
      reject_reason: 'SAME_IDENTITY',
    });
    expect(await promoDays(referrer)).toBe(0);
    expect(await promoDays(friend)).toBe(0);
  });

  it('refuses a second friend on a phone that was already rewarded', async () => {
    const referrer = await person();
    const first = await friendUsesWaves(referrer, { phone: '919800000002' });
    expect((await referralRow(first))?.status).toBe('rewarded');

    const other = await person();
    const second = await friendUsesWaves(other, { phone: '919800000002' });
    expect(await referralRow(second)).toMatchObject({
      status: 'rejected',
      reject_reason: 'IDENTITY_REUSED',
    });
    expect(await promoDays(other)).toBe(0);
  });
});

describe('never breaks the expense', () => {
  it('still inserts the expense when the qualification logic errors', async () => {
    const referrer = await person();
    const friend = await person();
    await claim(friend, await myCode(referrer));
    const g = await group([friend, await person()]);

    await client.query(`
      CREATE OR REPLACE FUNCTION public.waves_referral_try_qualify(p_referee uuid) RETURNS jsonb
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$`);

    const id = await expense(g.groupId, g.members[0]!);
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM expenses WHERE id = $1`, [
      id,
    ]);
    expect(rows[0].n).toBe(1);
    expect((await referralRow(friend))?.status).toBe('claimed');
  });
});

describe('group invite attribution', () => {
  it('counts joining through a group invite as a claim of the inviter', async () => {
    const inviter = await person();
    const g = await group([inviter]);
    const inviteId = randomUUID();
    await client.query(
      `INSERT INTO invites (id, group_id, token_hash, created_by, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 day')`,
      [inviteId, g.groupId, randomUUID(), inviter],
    );
    const friend = await person();
    const { rows } = await client.query(`SELECT public.waves_join_via_invite($1, $2) AS r`, [
      inviteId,
      friend,
    ]);
    expect(rows[0].r.ok).toBe(true);
    const row = await client.query(
      `SELECT referrer_id, source, status FROM referrals WHERE referee_id = $1`,
      [friend],
    );
    expect(row.rows[0]).toMatchObject({
      referrer_id: inviter,
      source: 'group_invite',
      status: 'claimed',
    });

    // They are now in a two-person group: their first expense there earns the reward.
    const [friendMember] = (
      await client.query(`SELECT id FROM group_members WHERE profile_id = $1`, [friend])
    ).rows;
    await expense(g.groupId, friendMember.id);
    expect((await referralRow(friend))?.status).toBe('rewarded');
  });

  it('does not attribute an existing member or a person who already has a referral', async () => {
    const inviter = await person();
    const other = await person();
    const g = await group([inviter]);
    const inviteId = randomUUID();
    await client.query(
      `INSERT INTO invites (id, group_id, token_hash, created_by, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 day')`,
      [inviteId, g.groupId, randomUUID(), inviter],
    );
    const friend = await person();
    await claim(friend, await myCode(other));
    await client.query(`SELECT public.waves_join_via_invite($1, $2)`, [inviteId, friend]);
    const row = await client.query(`SELECT referrer_id FROM referrals WHERE referee_id = $1`, [
      friend,
    ]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].referrer_id).toBe(other);
  });
});

describe('access', () => {
  it('lets a person read only their own rows and write none', async () => {
    const referrer = await person();
    const friend = await friendUsesWaves(referrer);
    const stranger = await person();
    await myCode(stranger);

    await client.query(`SET LOCAL ROLE authenticated`);
    await asUser(stranger, async () => {
      expect((await client.query(`SELECT count(*)::int AS n FROM referrals`)).rows[0].n).toBe(0);
      expect((await client.query(`SELECT count(*)::int AS n FROM referral_codes`)).rows[0].n).toBe(
        1,
      );
    });
    await asUser(friend, async () => {
      expect((await client.query(`SELECT count(*)::int AS n FROM referrals`)).rows[0].n).toBe(1);
    });
    await client.query(`SAVEPOINT s`);
    await expect(
      client.query(
        `INSERT INTO referrals (referrer_id, referee_id, code) VALUES ($1, $2, 'AAAAAAAA')`,
        [stranger, friend],
      ),
    ).rejects.toThrow();
    await client.query(`ROLLBACK TO SAVEPOINT s`);
    await client.query(`SAVEPOINT t`);
    await expect(
      client.query(`SELECT public.waves_referral_try_qualify($1)`, [friend]),
    ).rejects.toThrow();
    await client.query(`ROLLBACK TO SAVEPOINT t`);
    await client.query(`RESET ROLE`);
  });

  it("never shows a referrer their friend's phone or email", async () => {
    const referrer = await person();
    const friend = await friendUsesWaves(referrer, { phone: '919800000077' });
    const stored = await client.query(`SELECT identity_keys FROM referrals WHERE referee_id = $1`, [
      friend,
    ]);
    expect(stored.rows[0].identity_keys.length).toBeGreaterThan(0);
    for (const key of stored.rows[0].identity_keys as string[]) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    }

    await client.query(`SET LOCAL ROLE authenticated`);
    await asUser(referrer, async () => {
      const visible = await client.query(`SELECT status FROM referrals`);
      expect(visible.rows).toHaveLength(1);
      await client.query(`SAVEPOINT k`);
      await expect(client.query(`SELECT identity_keys FROM referrals`)).rejects.toThrow(
        /permission denied/i,
      );
      await client.query(`ROLLBACK TO SAVEPOINT k`);
    });
    await client.query(`RESET ROLE`);
  });
});
