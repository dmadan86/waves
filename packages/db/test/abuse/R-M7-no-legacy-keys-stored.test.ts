/**
 * Review M7 of PR #1350: new rows carried the unsalted legacy hashes beside the
 * salted ones (a phone number is enumerable from sha256('phone:' || digits)),
 * and the salt sat in the public schema.
 *
 * Now only canonical salted keys are stored; legacy hashes are computed for
 * matching and never written; the salt lives in waves_private, a schema no API
 * role can use.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect } from '../helpers';
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
  await client.query(`UPDATE pro_trial_settings SET launched_at = now() - interval '1 day'`);
});
afterEach(async () => {
  await client.query('ROLLBACK');
});

describe('M7 legacy hashes are matched, never stored', () => {
  it('a new trial, tombstone and carry-over hold one salted key per identity and no legacy hash', async () => {
    const phone = `9100${Math.floor(Math.random() * 1e8)}`;
    const me = await person(client, { phone, email: 'someone@example.com' });
    const { rows: l } = await client.query(
      `SELECT encode(sha256(convert_to('phone:' || $1, 'UTF8')), 'hex') AS p,
              encode(sha256(convert_to('email:someone@example.com', 'UTF8')), 'hex') AS e`,
      [phone],
    );
    const legacy = [l[0].p as string, l[0].e as string];
    expect(await client.query(`SELECT waves_pro_trial_grant($1)`, [me])).toBeTruthy();
    await client.query(`SELECT waves_identity_after_verify($1)`, [me]);
    const trial = (
      await client.query(`SELECT identity_keys FROM pro_trials WHERE profile_id = $1`, [me])
    ).rows[0] as { identity_keys: string[] };
    expect(trial.identity_keys).toHaveLength(2);
    for (const k of legacy) expect(trial.identity_keys).not.toContain(k);

    const tomb = await client.query(
      `SELECT identity_key FROM identity_tombstones WHERE last_auth_user_id = $1`,
      [me],
    );
    expect(tomb.rows.map((r) => r.identity_key).sort()).toEqual([...trial.identity_keys].sort());

    await client.query(`SELECT waves_ai_usage_reserve($1, 'receipt_scan', 20)`, [me]);
    await asUser(client, me, () => client.query(`SELECT waves_delete_my_account()`));
    const carried = await client.query(
      `SELECT DISTINCT unnest(identity_keys) AS k FROM usage_carryover WHERE auth_user_id = $1`,
      [me],
    );
    expect(carried.rows.map((r) => r.k).sort()).toEqual([...trial.identity_keys].sort());
  });

  it('the lookup still matches a legacy-only row', async () => {
    const phone = `9101${Math.floor(Math.random() * 1e8)}`;
    const me = await person(client, { phone });
    const { rows } = await client.query(
      `SELECT waves_identity_lookup_keys($1) AS lookup, waves_identity_keys($1) AS stored,
              encode(sha256(convert_to('phone:' || $2, 'UTF8')), 'hex') AS legacy`,
      [me, phone],
    );
    expect(rows[0].stored).toHaveLength(1);
    expect(rows[0].lookup).toHaveLength(2);
    expect(rows[0].lookup).toContain(rows[0].legacy);
  });

  it('the salt is outside the public schema and no API role can reach it', async () => {
    const { rows } = await client.query(
      `SELECT to_regclass('public.identity_settings') IS NULL AS no_public,
              to_regclass('waves_private.identity_salt') IS NOT NULL AS private_exists,
              has_schema_privilege('anon', 'waves_private', 'USAGE') AS anon_usage,
              has_schema_privilege('authenticated', 'waves_private', 'USAGE') AS auth_usage,
              has_schema_privilege('service_role', 'waves_private', 'USAGE') AS service_usage,
              has_table_privilege('service_role', 'waves_private.identity_salt', 'SELECT') AS service_select`,
    );
    expect(rows[0]).toEqual({
      no_public: true,
      private_exists: true,
      anon_usage: false,
      auth_usage: false,
      service_usage: false,
      service_select: false,
    });
  });
});
