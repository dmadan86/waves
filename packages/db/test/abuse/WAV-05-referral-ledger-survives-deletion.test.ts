/**
 * WAV-05 / M5: referral rows cascaded with either account, so deleting a
 * rewarded friend erased the referrer's lifetime cap and the friend's identity
 * evidence; the same device on both sides was not a self-referral.
 *
 * Now the rows outlive both accounts (FKs SET NULL), carry the referrer's keys,
 * the cap is summed by identity, and SAME_DEVICE rejects.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect } from '../helpers';
import { asUser, expense, group, person, stubAuthUsers } from './_people';

let client: Client;

beforeAll(async () => {
  client = await connect();
});
afterAll(async () => {
  await client.end();
});
beforeEach(async () => {
  await client.query('BEGIN');
  await stubAuthUsers(client);
});
afterEach(async () => {
  await client.query('ROLLBACK');
});

const myCode = async (id: string) =>
  (
    (await asUser(client, id, () => client.query(`SELECT waves_my_referral() AS r`))).rows[0].r as {
      code: string;
    }
  ).code;
const claim = async (id: string, code: string) =>
  (await asUser(client, id, () => client.query(`SELECT waves_claim_referral($1) AS r`, [code])))
    .rows[0].r as { ok: boolean; reason?: string };
const earned = async (id: string) =>
  (await client.query(`SELECT waves_referral_days_earned($1) AS d`, [id])).rows[0].d as number;
const row = async (referee: string) =>
  (
    await client.query(
      `SELECT status, reject_reason, referrer_id, referee_id, referrer_days, referee_days
         FROM referrals WHERE referee_id = $1`,
      [referee],
    )
  ).rows[0] as Record<string, unknown> | undefined;

/** Friend claims, then records an expense in a group with somebody else. */
async function friendQualifies(referrer: string, friend: string): Promise<void> {
  expect((await claim(friend, await myCode(referrer))).ok).toBe(true);
  const other = await person(client);
  const g = await group(client, [friend, other]);
  await expense(client, g.groupId, g.members[0]!);
}

describe('WAV-05 the referral ledger outlives the accounts', () => {
  it("deleting the rewarded friend keeps the row and the referrer's earned days", async () => {
    const referrer = await person(client);
    const friend = await person(client);
    await friendQualifies(referrer, friend);
    expect(await row(friend)).toMatchObject({ status: 'rewarded', referrer_days: 7 });
    expect(await earned(referrer)).toBe(7);

    await asUser(client, friend, () => client.query(`SELECT waves_delete_my_account()`));
    const kept = await client.query(
      `SELECT status, referee_id, referrer_days FROM referrals WHERE referrer_id = $1`,
      [referrer],
    );
    expect(kept.rows).toEqual([{ status: 'rewarded', referee_id: null, referrer_days: 7 }]);
    expect(await earned(referrer)).toBe(7);
  });

  it('the friend cannot be referred again on the same phone after deleting the account', async () => {
    const referrer = await person(client);
    const phone = `9155${Math.floor(Math.random() * 1e8)}`;
    const friend = await person(client, { phone });
    await friendQualifies(referrer, friend);
    await asUser(client, friend, () => client.query(`SELECT waves_delete_my_account()`));
    await client.query(`DELETE FROM auth.users WHERE id = $1`, [friend]);

    const again = await person(client, { phone });
    const other = await person(client);
    await friendQualifies(other, again);
    expect(await row(again)).toMatchObject({
      status: 'rejected',
      reject_reason: 'IDENTITY_REUSED',
    });
    expect(await earned(other)).toBe(0);
  });

  it('a referrer who deletes and signs up again on the same phone keeps the cap they used', async () => {
    const phone = `9144${Math.floor(Math.random() * 1e8)}`;
    const referrer = await person(client, { phone });
    for (let i = 0; i < 2; i += 1) await friendQualifies(referrer, await person(client));
    expect(await earned(referrer)).toBe(14);
    await asUser(client, referrer, () => client.query(`SELECT waves_delete_my_account()`));
    await client.query(`DELETE FROM auth.users WHERE id = $1`, [referrer]);

    const reborn = await person(client, { phone });
    expect(await earned(reborn)).toBe(14);
    for (let i = 0; i < 3; i += 1) await friendQualifies(reborn, await person(client));
    // 14 + 7 + 7 + 2 = 30, the lifetime cap, across both accounts.
    expect(await earned(reborn)).toBe(30);
    await friendQualifies(reborn, await person(client));
    expect(await earned(reborn)).toBe(30);
  });

  it('the same device on both sides is a self-referral', async () => {
    const referrer = await person(client, { deviceId: 'shared-phone' });
    const friend = await person(client, { deviceId: 'shared-phone' });
    await friendQualifies(referrer, friend);
    expect(await row(friend)).toMatchObject({ status: 'rejected', reject_reason: 'SAME_DEVICE' });
    expect(await earned(referrer)).toBe(0);
  });

  it('a Gmail alias of the referrer is the referrer', async () => {
    const referrer = await person(client, { phone: null, email: 'me@gmail.com' });
    const friend = await person(client, { phone: null, email: 'm.e+friend@googlemail.com' });
    await friendQualifies(referrer, friend);
    expect(await row(friend)).toMatchObject({ status: 'rejected', reject_reason: 'SAME_IDENTITY' });
  });

  it('the admin list still reads a row whose people are gone', async () => {
    const referrer = await person(client);
    const friend = await person(client);
    await friendQualifies(referrer, friend);
    await asUser(client, friend, () => client.query(`SELECT waves_delete_my_account()`));
    const { rows } = await client.query(`SELECT referee_name FROM waves_admin_referrals(5)`);
    expect(rows.map((r) => r.referee_name)).toContain('(deleted)');
  });

  it('never grants a client the identity or device hashes', async () => {
    for (const column of [
      'identity_keys',
      'referrer_keys',
      'device_keys',
      'referrer_device_keys',
    ]) {
      const { rows } = await client.query(
        `SELECT has_column_privilege('authenticated', 'public.referrals', $1, 'SELECT') AS ok`,
        [column],
      );
      expect(rows[0].ok, column).toBe(false);
    }
  });
});
