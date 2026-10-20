/**
 * Review H5 of PR #1350: the referral reuse and lifetime-cap checks ran before
 * any lock, and the locks covered account ids, not identities — two alias
 * accounts qualifying together could both pass.
 *
 * Now waves_referral_try_qualify locks both profiles and every identity key of
 * both sides (sorted) before those checks. This pins the locks: while one
 * qualification is in flight (its transaction open), the identity key of the
 * friend and the profile locks are held against anyone else.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('H5 identity keys are locked through a qualification', () => {
  it('holds the friend’s and the referrer’s identity locks and profile locks until commit', async () => {
    const other = await connect();
    try {
      await client.query('BEGIN');
      await stubAuthUsers(client);
      const refPhone = `9111${Math.floor(Math.random() * 1e8)}`;
      const friendPhone = `9112${Math.floor(Math.random() * 1e8)}`;
      const referrer = await person(client, { phone: refPhone });
      const friend = await person(client, { phone: friendPhone });
      const code = (
        (await asUser(client, referrer, () => client.query(`SELECT waves_my_referral() AS r`)))
          .rows[0].r as { code: string }
      ).code;
      await asUser(client, friend, () => client.query(`SELECT waves_claim_referral($1)`, [code]));
      const third = await person(client);
      const g = await group(client, [friend, third]);
      // The expense trigger runs waves_referral_try_qualify inside this
      // transaction; its locks are held until the transaction ends.
      await expense(client, g.groupId, g.members[0]!);
      const row = await client.query(`SELECT status FROM referrals WHERE referee_id = $1`, [
        friend,
      ]);
      expect(row.rows[0].status).toBe('rewarded');

      // The hashes are deterministic: the other session computes the same keys
      // without seeing this transaction's rows.
      const keys = (
        await other.query(
          `SELECT waves_identity_hash('phone', $1) AS f, waves_identity_hash('phone', $2) AS r`,
          [friendPhone, refPhone],
        )
      ).rows[0] as { f: string; r: string };
      await other.query('BEGIN');
      const held = await other.query(
        `SELECT pg_try_advisory_xact_lock(hashtextextended('referral_key:' || $1, 0)) AS friend_key,
                pg_try_advisory_xact_lock(hashtextextended('referral_key:' || $2, 0)) AS referrer_key,
                pg_try_advisory_xact_lock(hashtextextended('profile:' || $3::text, 0)) AS friend_profile,
                pg_try_advisory_xact_lock(hashtextextended('profile:' || $4::text, 0)) AS referrer_profile`,
        [keys.f, keys.r, friend, referrer],
      );
      expect(held.rows[0]).toEqual({
        friend_key: false,
        referrer_key: false,
        friend_profile: false,
        referrer_profile: false,
      });
      await other.query('ROLLBACK');

      await client.query('ROLLBACK');
      await other.query('BEGIN');
      const free = await other.query(
        `SELECT pg_try_advisory_xact_lock(hashtextextended('referral_key:' || $1, 0)) AS friend_key`,
        [keys.f],
      );
      expect(free.rows[0].friend_key).toBe(true);
      await other.query('ROLLBACK');
    } finally {
      await other.end();
    }
  });
});
