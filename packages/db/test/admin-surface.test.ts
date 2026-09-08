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
