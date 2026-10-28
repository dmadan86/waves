import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { asRole, connect, expectDenied, seedGroup } from './helpers.js';

let client: Client;
beforeAll(async () => {
  client = await connect();
});
afterAll(async () => {
  await client?.end();
});

function asUser<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  return asRole(client, 'authenticated', { sub: profileId, role: 'authenticated' }, run);
}

describe('security DB hardening', () => {
  it('normalizes a client-created admin placeholder to member', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 2 });
    await asUser(profileIds[1]!, async () => {
      const { rows } = await client.query(
        `INSERT INTO group_members (id, group_id, profile_id, ghost_name, role, joined_via)
         VALUES ($1, $2, NULL, 'Guest', 'admin', 'ghost') RETURNING role, profile_id`,
        [randomUUID(), groupId],
      );
      expect(rows[0]?.role).toBe('member');
      expect(rows[0]?.profile_id).toBeNull();
    });
  });

  it('reserves placeholder payment details for admins but allows members to rename', async () => {
    const { profileIds, memberIds } = await seedGroup(client, { memberCount: 2, ghostCount: 1 });
    const placeholder = memberIds[2]!;
    const patch = (profileId: string, column: string, value: string) =>
      asUser(profileId, () =>
        client.query(`UPDATE group_members SET ${column} = $1 WHERE id = $2 RETURNING ${column}`, [
          value,
          placeholder,
        ]),
      );

    expect(await expectDenied(patch(profileIds[1]!, 'vpa', 'guest@upi'))).toMatch(
      /FORBIDDEN_COLUMN/,
    );
    expect((await patch(profileIds[1]!, 'ghost_name', 'Renamed guest')).rows[0]?.ghost_name).toBe(
      'Renamed guest',
    );
    expect((await patch(profileIds[0]!, 'vpa', 'guest@upi')).rows[0]?.vpa).toBe('guest@upi');
  });

  it('clamps client invite limits, usage and expiry', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 2 });
    const inviteId = randomUUID();
    await asUser(profileIds[1]!, async () => {
      await client.query(
        `INSERT INTO invites (id, group_id, token_hash, created_by, max_uses, use_count, expires_at)
         VALUES ($1, $2, $3, $4, 9999, 5, now() + interval '1 year')`,
        [inviteId, groupId, `hash-${randomUUID()}`, profileIds[1]],
      );
      // Invites have no client SELECT policy. Inspect within the rolled-back transaction as owner.
      await client.query('RESET ROLE');
      const { rows } = await client.query(
        `SELECT max_uses, use_count, expires_at > now() AS future,
                expires_at <= now() + interval '30 days' AS capped
           FROM invites WHERE id = $1`,
        [inviteId],
      );
      expect(rows[0]).toEqual({ max_uses: 100, use_count: 0, future: true, capped: true });
    });
  });
});
