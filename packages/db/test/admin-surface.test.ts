/**
 * The admin console API is service-role only, and stays that way.
 *
 * Under ADR-013 the grant *is* the boundary: the `waves_admin_*` functions carry
 * no internal caller check, because the only thing that may call them is a
 * process holding the service-role key (`apps/admin/src/lib/data.ts`). That
 * design is fine right up until one of them acquires a grant it should not have,
 * at which point there is nothing else in the way.
 *
 * This is asserted as a whole set rather than function by function, because the
 * failure it guards against is *addition* — and the repo has already produced
 * that failure twice by two different routes:
 *
 *   * Supabase ships default privileges on `public` that grant EXECUTE to `anon`
 *     and `authenticated` as each function is created, so a new admin RPC is
 *     reachable the moment it exists unless its migration says otherwise.
 *   * `20260904200000_authenticated_surface_on_hosted` re-granted the whole
 *     schema by replaying a local build — faithfully reproducing a stray
 *     `GRANT ... TO authenticated` on `waves_admin_voice_attempts` that had been
 *     in the baseline since the squash. A replay copies mistakes as carefully as
 *     it copies intent.
 *
 * A per-function test would have caught neither. This one fails on the next
 * admin RPC that arrives with the default grant attached, which is the point.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect } from './helpers.js';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client?.end();
});

describe('the admin console surface', () => {
  it('has admin RPCs to check at all', async () => {
    // Guards the two tests below against passing vacuously if the naming
    // convention ever changes and the pattern stops matching anything.
    const { rows } = await client.query<{ count: string }>(`
      SELECT count(*)::text AS count
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname LIKE 'waves\\_admin\\_%'
    `);
    expect(Number(rows[0]?.count)).toBeGreaterThan(10);
  });

  it('grants no admin RPC to anon or authenticated', async () => {
    const { rows } = await client.query<{ proname: string; grantee: string }>(`
      SELECT p.proname, r.rolname AS grantee
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN (VALUES ('anon'), ('authenticated')) AS roles(rolname)
        JOIN pg_roles r ON r.rolname = roles.rolname
       WHERE n.nspname = 'public'
         AND p.proname LIKE 'waves\\_admin\\_%'
         AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
       ORDER BY p.proname, r.rolname
    `);

    // Named in the failure so the diff says which function and which role,
    // rather than only that a count moved.
    expect(rows.map((row) => `${row.proname} -> ${row.grantee}`)).toEqual([]);
  });

  it('keeps voice transcripts unreadable by a signed-in caller', async () => {
    // The belt to the grant's braces, and the reason the grant mattered even
    // while it was harmless: `waves_admin_voice_attempts` is not SECURITY
    // DEFINER, so it can only ever read what its caller could read directly.
    // If a SELECT policy or grant is ever added to `voice_attempts`, this fails
    // and points at the transcripts before anyone can reach them.
    const { rows } = await client.query<{
      is_definer: boolean;
      auth_select: boolean;
      select_policies: string;
    }>(`
      SELECT
        (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'waves_admin_voice_attempts') AS is_definer,
        has_table_privilege('authenticated', 'public.voice_attempts', 'SELECT') AS auth_select,
        (SELECT count(*)::text FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'voice_attempts'
            AND cmd IN ('SELECT', 'ALL')) AS select_policies
    `);

    expect(rows[0]?.is_definer).toBe(false);
    expect(rows[0]?.auth_select).toBe(false);
    expect(rows[0]?.select_policies).toBe('0');
  });
});

/**
 * The three tables that answer before there is a session — the version gate the
 * app reads before its own sign-in screen, the country denylist on the phone
 * sign-in screen, and public feature configuration. They are public *read*;
 * every write is service-role.
 *
 * `app_releases` is the one that matters most: `minimum_version` is the single
 * row in this database that can stop every install of Waves at once. It carried
 * INSERT and UPDATE grants for `authenticated` from the baseline until
 * `20260908140000`, which RLS happened to neutralise — an UPDATE matched zero
 * rows because the only policy is `FOR SELECT`. Redundant is not harmless: an
 * UPDATE policy added later for a good reason would have turned a leftover
 * grant into a product-wide denial of service by any signed-in account.
 */
describe('the pre-sign-in config surface', () => {
  it('is read-only for anon and authenticated', async () => {
    const { rows } = await client.query<{
      table_name: string;
      grantee: string;
      privilege: string;
    }>(`
      SELECT t.table_name, r.rolname AS grantee, p.privilege
        FROM (VALUES ('app_releases'), ('country_settings'), ('feature_flags')) AS t(table_name)
        CROSS JOIN (VALUES ('anon'), ('authenticated')) AS roles(rolname)
        CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(privilege)
        JOIN pg_roles r ON r.rolname = roles.rolname
       WHERE has_table_privilege(r.rolname, 'public.' || t.table_name, p.privilege)
       ORDER BY t.table_name, r.rolname, p.privilege
    `);

    expect(rows.map((row) => `${row.table_name} -> ${row.grantee} ${row.privilege}`)).toEqual([]);
  });

  it('still lets a signed-out client read the version gate', async () => {
    // The other half of the same property: revoking the writes must not take
    // the read with it, or the app cannot check its own minimum version before
    // sign-in and every launch fails closed.
    const { rows } = await client.query<{ anon_read: boolean; auth_read: boolean }>(`
      SELECT has_table_privilege('anon', 'public.app_releases', 'SELECT') AS anon_read,
             has_table_privilege('authenticated', 'public.app_releases', 'SELECT') AS auth_read
    `);
    expect(rows[0]?.anon_read).toBe(true);
    expect(rows[0]?.auth_read).toBe(true);
  });
});
