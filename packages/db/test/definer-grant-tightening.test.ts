/** Grants closed by 20261026160000_definer_grant_tightening. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { asRole, connect, seedGroup } from './helpers.js';

let client: Client;
beforeAll(async () => {
  client = await connect();
});
afterAll(async () => {
  await client?.end();
});

describe('definer grant tightening', () => {
  it('no trigger function in public is executable by anon or authenticated', async () => {
    const { rows } = await client.query<{ proname: string }>(`
      SELECT p.proname FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.prorettype = 'trigger'::regtype
         AND (has_function_privilege('anon', p.oid, 'EXECUTE')
              OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))`);
    expect(rows.map((r) => r.proname)).toEqual([]);
  });

  it('internal-only helpers are not callable by a signed-in client', async () => {
    const { rows } = await client.query<{ proname: string }>(`
      SELECT p.proname FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname IN ('waves_profiles_share_group','waves_group_is_paid',
             'waves_voice_stt_free_seconds','waves_member_group_id','waves_spend_person_lookup')
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')`);
    expect(rows.map((r) => r.proname)).toEqual([]);
  });

  it('waves_my_member_id_for answers only for the caller, whatever profile is passed', async () => {
    const g = await seedGroup(client, { memberCount: 2 });
    const [me, other] = g.profileIds;
    const seen = await asRole(
      client,
      'authenticated',
      { sub: me, role: 'authenticated' },
      async () =>
        (await client.query(`SELECT waves_my_member_id_for($1, $2) AS m`, [g.groupId, other]))
          .rows[0].m,
    );
    expect(seen).toBe(g.memberIds[0]);
  });
});
