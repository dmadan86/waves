/**
 * The two mails that got producers: a sign-in alert and a Monday digest.
 *
 * What is pinned here is the part that cannot be seen from the app — when a row
 * is written at all, and which rows survive the email claim:
 *
 *   - a device signing in for the first time writes `new_device_login`, the
 *     same device signing in again does not, and a device coming back after a
 *     sign-out does (that is somebody's "wait, I revoked that");
 *   - a guest is never told: an anonymous account has no address to warn;
 *   - the alert ignores the "email me" preference, because turning off ledger
 *     mail is not a request to stop being told your account was opened
 *     somewhere — while an actual bounce/complaint still suppresses it;
 *   - the weekly digest only writes for accounts with something to report, is
 *     idempotent inside one week, and skips an account with no address.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

import { addEqualSplitExpense, addSplitExpense, connect, seedGroup } from './helpers.js';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client?.end();
});

afterEach(async () => {
  await client.query(`DELETE FROM notifications`);
  await client.query(`DELETE FROM device_sessions`);
  await client.query(`DELETE FROM email_suppressions`);
});

async function makeProfile(email = true): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO profiles (id, display_name, default_currency) VALUES ($1, 'X', 'INR')`,
    [id],
  );
  if (email) await setEmail(id, `${id}@example.test`);
  return id;
}

/**
 * `waves_email_for` reads the address off `auth.users`, which the local test
 * database stubs. Writing straight into the stub is what the other suites do —
 * there is no signup path to call here.
 */
async function setEmail(profileId: string, address: string | null): Promise<void> {
  await client.query(
    `INSERT INTO auth.users (id, email, email_confirmed_at)
     VALUES ($1, $2, now())
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email,
                                    email_confirmed_at = EXCLUDED.email_confirmed_at`,
    [profileId, address],
  );
}

async function register(profileId: string, deviceId: string, label = 'A phone'): Promise<void> {
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  await client.query(`SELECT public.waves_register_device($1, $2, 'android', null)`, [
    deviceId,
    label,
  ]);
  await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
}

async function alertsFor(profileId: string): Promise<{ title: string; payload: unknown }[]> {
  const { rows } = await client.query(
    `SELECT title, payload FROM notifications
      WHERE profile_id = $1 AND kind = 'new_device_login' ORDER BY created_at`,
    [profileId],
  );
  return rows as { title: string; payload: unknown }[];
}

/** Run the claim the fanout runs, and report what it decided for one row. */
async function claimEmail(profileId: string, kind: string): Promise<string | null> {
  await client.query(`SELECT public.waves_claim_email_notifications(100)`);
  const { rows } = await client.query(
    `SELECT email_status FROM notifications WHERE profile_id = $1 AND kind = $2`,
    [profileId, kind],
  );
  return (rows[0]?.email_status as string | undefined) ?? null;
}

describe('new device sign-in alerts', () => {
  it('writes one alert the first time a device is seen, and none on a repeat', async () => {
    const profile = await makeProfile();
    const device = randomUUID();

    await register(profile, device);
    expect(await alertsFor(profile)).toHaveLength(1);

    // The app calls this on every launch. A heartbeat is not a sign-in.
    await register(profile, device);
    expect(await alertsFor(profile)).toHaveLength(1);
  });

  it('names the device in the title and carries it as a fact', async () => {
    const profile = await makeProfile();
    await register(profile, randomUUID(), 'Pixel 9');

    const [alert] = await alertsFor(profile);
    expect(alert!.title).toBe('New sign-in on Pixel 9');
    expect(alert!.payload).toMatchObject({ device: 'Pixel 9 · android' });
  });

  it('alerts again when a signed-out device comes back', async () => {
    const profile = await makeProfile();
    const device = randomUUID();
    await register(profile, device);

    await client.query(`UPDATE device_sessions SET revoked_at = now() WHERE device_id = $1`, [
      device,
    ]);
    // Yesterday's alert must not dedupe today's: the key carries the date.
    await client.query(
      `UPDATE notifications SET dedupe_key = dedupe_key || ':old' WHERE profile_id = $1`,
      [profile],
    );

    await register(profile, device);
    expect(await alertsFor(profile)).toHaveLength(2);
  });

  /**
   * The guest skip itself cannot be proven here: this database stubs
   * `auth.users` and the stub has no `is_anonymous` column, which is exactly the
   * shape CI runs in. What *is* worth pinning is that the guard holds — a
   * missing column answers "not a guest" instead of throwing, which is the
   * difference between an alert nobody needed and a sign-in that fails.
   */
  it('treats a missing is_anonymous column as "not a guest" rather than an error', async () => {
    const profile = await makeProfile();
    const { rows } = await client.query(`SELECT public.waves_is_guest($1) AS guest`, [profile]);
    expect(rows[0].guest).toBe(false);

    await register(profile, randomUUID());
    expect(await alertsFor(profile)).toHaveLength(1);
  });

  it('mails the alert even when the account has turned email off', async () => {
    const profile = await makeProfile();
    await client.query(
      `UPDATE profiles SET notification_prefs = '{"email": false}'::jsonb WHERE id = $1`,
      [profile],
    );

    await register(profile, randomUUID());
    expect(await claimEmail(profile, 'new_device_login')).toBe('queued');
  });

  it('still respects a mailbox that bounced or complained', async () => {
    const profile = await makeProfile();
    const { rows } = await client.query(`SELECT email FROM auth.users WHERE id = $1`, [profile]);
    await client.query(
      `INSERT INTO email_suppressions (address, reason) VALUES (lower($1), 'bounced')
       ON CONFLICT (address) DO NOTHING`,
      [rows[0].email],
    );

    await register(profile, randomUUID());
    expect(await claimEmail(profile, 'new_device_login')).toBe('suppressed');
  });
});

describe('the weekly digest', () => {
  /**
   * Counted per profile rather than from the function's return value: this
   * database is shared with the rest of the suite, and "how many digests were
   * written in total" is a number the neighbouring tests can change. What this
   * suite is actually about is whether *this* account got one.
   */
  async function runDigest(): Promise<void> {
    await client.query(`SELECT public.waves_enqueue_weekly_digest()`);
  }

  async function digestsFor(profileId: string): Promise<{ payload: unknown }[]> {
    const { rows } = await client.query(
      `SELECT payload FROM notifications WHERE kind = 'digest_weekly' AND profile_id = $1`,
      [profileId],
    );
    return rows as { payload: unknown }[];
  }

  it('writes nothing for an account with no week to report', async () => {
    const profile = await makeProfile();
    await optIn(profile);
    await runDigest();
    expect(await digestsFor(profile)).toHaveLength(0);
  });

  /**
   * The screen says "Off by default" and has said so since before there was a
   * producer. An account that never turned it on gets nothing, however busy its
   * week was.
   */
  it('writes nothing for an account that never opted in', async () => {
    const group = await seedGroup(client, { memberCount: 1 });
    await setEmail(group.profileIds[0]!, `${group.profileIds[0]!}@example.test`);
    await addEqualSplitExpense(client, {
      groupId: group.groupId,
      payers: { [group.memberIds[0]!]: 10000n },
      participants: group.memberIds,
      amount: 10000n,
    });

    await runDigest();
    expect(await digestsFor(group.profileIds[0]!)).toHaveLength(0);
  });

  /** The digest is opt-in — `weeklyEmail` is false in the shipped defaults. */
  async function optIn(profileId: string): Promise<void> {
    await client.query(
      `UPDATE profiles SET notification_prefs = notification_prefs || '{"weeklyEmail": true}'::jsonb
        WHERE id = $1`,
      [profileId],
    );
  }

  it('writes one row per account with activity, counting the week', async () => {
    const group = await seedGroup(client, { memberCount: 2 });
    for (const profileId of group.profileIds) {
      await setEmail(profileId, `${profileId}@example.test`);
      await optIn(profileId);
    }
    await addEqualSplitExpense(client, {
      groupId: group.groupId,
      payers: { [group.memberIds[0]!]: 40000n },
      participants: group.memberIds,
      amount: 40000n,
    });

    await runDigest();

    // Both parties to the expense, not just whoever filed it: a digest is what
    // changed around your balance.
    for (const profileId of group.profileIds) {
      expect(await digestsFor(profileId)).toHaveLength(1);
    }
    const [digest] = await digestsFor(group.profileIds[0]!);
    expect(digest!.payload).toMatchObject({ count: '1', currency: 'INR' });
  });

  it('counts payer-only financers and share-only riders/travellers, not bystander users', async () => {
    const group = await seedGroup(client, { memberCount: 4 });
    const [financerProfile, riderProfile, travellerProfile, bystanderProfile] =
      group.profileIds as [string, string, string, string];
    const [financer, rider, traveller] = group.memberIds as [string, string, string, string];
    for (const profileId of group.profileIds) {
      await setEmail(profileId, `${profileId}@example.test`);
      await optIn(profileId);
    }

    await addSplitExpense(client, {
      groupId: group.groupId,
      payers: { [financer]: 12000n },
      participants: [rider, traveller],
      amount: 12000n,
      params: { kind: 'exact', amounts: { [rider]: 7000n, [traveller]: 5000n } },
      description: 'Cab ride',
    });

    await runDigest();

    expect(await digestsFor(financerProfile)).toHaveLength(1);
    expect(await digestsFor(riderProfile)).toHaveLength(1);
    expect(await digestsFor(travellerProfile)).toHaveLength(1);
    expect(await digestsFor(bystanderProfile)).toHaveLength(0);
    const [financerDigest] = await digestsFor(financerProfile);
    const [riderDigest] = await digestsFor(riderProfile);
    const [travellerDigest] = await digestsFor(travellerProfile);
    expect(financerDigest!.payload).toMatchObject({ count: '1', amount: '12000' });
    expect(riderDigest!.payload).toMatchObject({ count: '1', amount: '-7000' });
    expect(travellerDigest!.payload).toMatchObject({ count: '1', amount: '-5000' });
  });

  it('counts an author-only user even when they are not a payer or participant', async () => {
    const group = await seedGroup(client, { memberCount: 2 });
    const [authorProfile, bystanderProfile] = group.profileIds as [string, string];
    const [author] = group.memberIds as [string, string];
    for (const profileId of group.profileIds) {
      await setEmail(profileId, `${profileId}@example.test`);
      await optIn(profileId);
    }

    const expenseId = randomUUID();
    const versionId = randomUUID();
    await client.query('BEGIN');
    await client.query(`INSERT INTO expenses (id, group_id, created_by) VALUES ($1, $2, $3)`, [
      expenseId,
      group.groupId,
      author,
    ]);
    await client.query(
      `INSERT INTO expense_versions
         (id, expense_id, version_no, author_member_id, description, category, expense_date,
          currency, amount, split_type, split_params)
       VALUES ($1, $2, 1, $3, 'Trip note', NULL, '2026-03-01', 'INR', 0, 'equal', '{"kind":"equal"}'::jsonb)`,
      [versionId, expenseId, author],
    );
    await client.query(`UPDATE expenses SET current_version_id = $1 WHERE id = $2`, [
      versionId,
      expenseId,
    ]);
    await client.query('COMMIT');

    await runDigest();

    const [digest] = await digestsFor(authorProfile);
    expect(digest!.payload).toMatchObject({ count: '1', amount: '0' });
    expect(await digestsFor(bystanderProfile)).toHaveLength(0);
  });

  it('is idempotent inside one week', async () => {
    const group = await seedGroup(client, { memberCount: 1 });
    await setEmail(group.profileIds[0]!, `${group.profileIds[0]!}@example.test`);
    await optIn(group.profileIds[0]!);
    await addEqualSplitExpense(client, {
      groupId: group.groupId,
      payers: { [group.memberIds[0]!]: 10000n },
      participants: group.memberIds,
      amount: 10000n,
    });

    await runDigest();
    expect(await digestsFor(group.profileIds[0]!)).toHaveLength(1);

    // Cron running twice, or a retry after a timeout: the dedupe key is what
    // makes the second run a no-op rather than a second mail.
    await runDigest();
    expect(await digestsFor(group.profileIds[0]!)).toHaveLength(1);
  });

  it('skips an account with no address at all', async () => {
    const group = await seedGroup(client, { memberCount: 1 });
    await optIn(group.profileIds[0]!);
    await addEqualSplitExpense(client, {
      groupId: group.groupId,
      payers: { [group.memberIds[0]!]: 10000n },
      participants: group.memberIds,
      amount: 10000n,
    });

    await runDigest();
    expect(await digestsFor(group.profileIds[0]!)).toHaveLength(0);
  });
});
