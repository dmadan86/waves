/**
 * WAV-04 / H2: "one trial per person" was one per raw lower-cased email, so
 * me+1@gmail.com, m.e@gmail.com and me@googlemail.com were three people; a
 * phone confirmed after the trial was never part of the trial's keys; and
 * nothing looked at the device.
 *
 * Now identity keys are canonical (waves_canonical_email) and salted, later
 * keys are unioned in, the legacy keys still match older rows, and the device
 * is a signal: on its own it only marks the row, with nothing but an Apple
 * relay email behind it the trial is refused.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect } from '../helpers';
import { asUser, person, registerDevice, stubAuthUsers } from './_people';

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
  await client.query(`UPDATE pro_trial_settings SET launched_at = now() - interval '1 day'`);
});
afterEach(async () => {
  await client.query('ROLLBACK');
});

const grant = async (id: string) =>
  (await client.query(`SELECT waves_pro_trial_grant($1) AS g`, [id])).rows[0].g as {
    granted: boolean;
    reason?: string;
    device_reused?: boolean;
  };
const canonical = async (email: string) =>
  (await client.query(`SELECT waves_canonical_email($1) AS e`, [email])).rows[0].e as string;

describe('WAV-04 canonical email', () => {
  it('lower-cases, strips +tags, folds Gmail dots and googlemail', async () => {
    expect(await canonical('Me+promo@Gmail.com')).toBe('me@gmail.com');
    expect(await canonical('m.e.e@googlemail.com')).toBe('mee@gmail.com');
    expect(await canonical('a.b+x@example.com')).toBe('a.b@example.com');
    expect(await canonical('  Plain@Example.COM ')).toBe('plain@example.com');
  });
});

describe('WAV-04 one trial per canonical identity', () => {
  it('refuses a Gmail alias of an email that already had a trial', async () => {
    const first = await person(client, { phone: null, email: 'me@gmail.com' });
    expect(await grant(first)).toMatchObject({ granted: true });
    for (const alias of [
      'me+1@gmail.com',
      'M.E@gmail.com',
      'me@googlemail.com',
      'm.e+x@googlemail.com',
    ]) {
      const again = await person(client, { phone: null, email: alias });
      expect(await grant(again), alias).toMatchObject({
        granted: false,
        reason: 'IDENTITY_REUSED',
      });
    }
  });

  it('strips +tags everywhere, but keeps dots outside Gmail', async () => {
    const first = await person(client, { phone: null, email: 'ab@example.com' });
    expect(await grant(first)).toMatchObject({ granted: true });
    const tagged = await person(client, { phone: null, email: 'ab+two@example.com' });
    expect(await grant(tagged)).toMatchObject({ granted: false, reason: 'IDENTITY_REUSED' });
    const dotted = await person(client, { phone: null, email: 'a.b@example.com' });
    expect(await grant(dotted)).toMatchObject({ granted: true });
  });

  it('a phone confirmed after the trial travels with it: deleted, re-registered on the phone, nothing', async () => {
    const phone = `9188${Math.floor(Math.random() * 1e8)}`;
    const first = await person(client, { phone: null, email: 'later@example.com' });
    expect(await grant(first)).toMatchObject({ granted: true });
    // The phone is attached and confirmed; the auth trigger runs this.
    await client.query(
      `UPDATE auth.users SET phone = $2, phone_confirmed_at = now() WHERE id = $1`,
      [first, phone],
    );
    await client.query(`SELECT waves_identity_after_verify($1)`, [first]);
    await asUser(client, first, () => client.query(`SELECT waves_delete_my_account()`));
    await client.query(`DELETE FROM auth.users WHERE id = $1`, [first]);

    const second = await person(client, { phone });
    expect(await grant(second)).toMatchObject({ granted: false, reason: 'IDENTITY_REUSED' });
  });

  it('still matches a row stamped with the legacy unsalted key', async () => {
    const phone = `9166${Math.floor(Math.random() * 1e8)}`;
    const { rows } = await client.query(
      `SELECT encode(sha256(convert_to('phone:' || $1, 'UTF8')), 'hex') AS k`,
      [phone],
    );
    await client.query(
      `INSERT INTO pro_trials (profile_id, outcome, granted_at, expires_at, identity_keys)
       VALUES ($1, 'granted', now() - interval '40 days', now() - interval '25 days', ARRAY[$2::text])`,
      [randomUUID(), rows[0].k],
    );
    const again = await person(client, { phone });
    expect(await grant(again)).toMatchObject({ granted: false, reason: 'IDENTITY_REUSED' });
  });
});

describe('WAV-04 the device signal', () => {
  it('marks, but does not refuse, a new identity on a phone that already had a trial', async () => {
    const first = await person(client, { deviceId: 'device-A' });
    expect(await grant(first)).toMatchObject({ granted: true, device_reused: false });
    const second = await person(client, { deviceId: 'device-A' });
    expect(await grant(second)).toMatchObject({ granted: true, device_reused: true });
    const { rows } = await client.query(
      `SELECT device_reused FROM pro_trials WHERE profile_id = $1`,
      [second],
    );
    expect(rows[0].device_reused).toBe(true);
  });

  it('refuses a relay-only Apple email on a phone that already had a trial', async () => {
    const first = await person(client, {
      phone: null,
      email: 'abc123@privaterelay.appleid.com',
      deviceId: 'device-B',
    });
    expect(await grant(first)).toMatchObject({ granted: true });
    const second = await person(client, {
      phone: null,
      email: 'xyz789@privaterelay.appleid.com',
      deviceId: 'device-B',
    });
    expect(await grant(second)).toMatchObject({ granted: false, reason: 'DEVICE_REUSED' });
    const { rows } = await client.query(`SELECT outcome FROM pro_trials WHERE profile_id = $1`, [
      second,
    ]);
    expect(rows[0].outcome).toBe('refused_device');
    expect(
      (
        await client.query(`SELECT count(*)::int AS n FROM subscriptions WHERE profile_id = $1`, [
          second,
        ])
      ).rows[0].n,
    ).toBe(0);
  });

  it('a relay email on a fresh phone is still granted (residual risk, by design)', async () => {
    const one = await person(client, {
      phone: null,
      email: 'q1@privaterelay.appleid.com',
      deviceId: 'd1',
    });
    expect(await grant(one)).toMatchObject({ granted: true });
  });

  it('a device registered after the grant is stamped onto the trial', async () => {
    const first = await person(client);
    expect(await grant(first)).toMatchObject({ granted: true });
    await registerDevice(client, first, 'device-late');
    const second = await person(client, {
      phone: null,
      email: 'late@privaterelay.appleid.com',
      deviceId: 'device-late',
    });
    expect(await grant(second)).toMatchObject({ granted: false, reason: 'DEVICE_REUSED' });
  });
});
