/**
 * WAV-07: the only memory of an AdMob transaction id was the ad_rewards row,
 * which cascaded with the profile; and a refused callback was never recorded,
 * so one held back could be replayed on a day the account qualified.
 *
 * Now every verified transaction id lands in ad_ssv_transactions (no FK) on
 * first sight, with its outcome, and is a duplicate forever after.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { asRole, connect } from '../helpers';
import { asUser, person, stubAuthUsers } from './_people';

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
  await client.query(
    `UPDATE feature_flags SET enabled = true, rollout_percent = 100 WHERE key = 'ads_rewarded'`,
  );
});
afterEach(async () => {
  await client.query('ROLLBACK');
});

const grant = async (profile: string, tx: string) =>
  (await client.query(`SELECT waves_ads_grant($1, 'voice', $2, 'unit-1') AS g`, [profile, tx]))
    .rows[0].g as { outcome: string; reason?: string };
const ledger = async (tx: string) =>
  (
    await client.query(
      `SELECT outcome, profile_id FROM ad_ssv_transactions WHERE transaction_id = $1`,
      [tx],
    )
  ).rows[0] as { outcome: string; profile_id: string | null } | undefined;

describe('WAV-07 the SSV transaction ledger', () => {
  it('a transaction id rewarded once is a duplicate after the profile is deleted and re-created', async () => {
    const me = await person(client, { verifiedDaysAgo: 30 });
    const tx = `TX-${randomUUID()}`;
    expect(await grant(me, tx)).toMatchObject({ outcome: 'granted' });
    expect(await ledger(tx)).toMatchObject({ outcome: 'granted', profile_id: me });

    await asUser(client, me, () => client.query(`SELECT waves_delete_my_account()`));
    expect(
      (
        await client.query(`SELECT count(*)::int AS n FROM ad_rewards WHERE transaction_id = $1`, [
          tx,
        ])
      ).rows[0].n,
    ).toBe(0);
    await client.query(
      `INSERT INTO profiles (id, display_name, default_currency, created_at)
       VALUES ($1, 'Again', 'INR', now() - interval '30 days')`,
      [me],
    );
    expect(await grant(me, tx)).toEqual({ outcome: 'duplicate' });
    expect(
      (await client.query(`SELECT count(*)::int AS n FROM ad_rewards WHERE profile_id = $1`, [me]))
        .rows[0].n,
      // The restored reward from the carry-over, never a second grant.
    ).toBeLessThanOrEqual(1);
  });

  it('a refused callback is terminal: the same id cannot be cashed on a better day', async () => {
    const me = await person(client, { verifiedDaysAgo: 1 }); // too new
    const tx = `TX-${randomUUID()}`;
    expect(await grant(me, tx)).toMatchObject({ outcome: 'ineligible', reason: 'too_new' });
    expect(await ledger(tx)).toMatchObject({ outcome: 'ineligible:too_new' });
    await client.query(
      `UPDATE auth.users SET phone_confirmed_at = now() - interval '30 days' WHERE id = $1`,
      [me],
    );
    await client.query(
      `UPDATE profiles SET created_at = now() - interval '30 days' WHERE id = $1`,
      [me],
    );
    expect(await grant(me, `TX-${randomUUID()}`)).toMatchObject({ outcome: 'granted' });
    expect(await grant(me, tx)).toEqual({ outcome: 'duplicate' });
  });

  it('a transaction id seen for one person is a duplicate for another', async () => {
    const a = await person(client, { verifiedDaysAgo: 30 });
    const b = await person(client, { verifiedDaysAgo: 30 });
    const tx = `TX-${randomUUID()}`;
    expect(await grant(a, tx)).toMatchObject({ outcome: 'granted' });
    expect(await grant(b, tx)).toEqual({ outcome: 'duplicate' });
  });

  it('the ledger is closed to clients', async () => {
    const me = await person(client);
    const denied = await asRole(
      client,
      'authenticated',
      { sub: me, role: 'authenticated' },
      async () => {
        try {
          await client.query(`SELECT * FROM ad_ssv_transactions`);
        } catch (error) {
          return (error as Error).message;
        }
        return 'allowed';
      },
    );
    expect(denied).toMatch(/permission denied/i);
  });
});
