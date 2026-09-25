/**
 * A device's push token follows whoever is signed in on it.
 *
 * One device, one Expo token, whoever is holding it. Registering through a
 * plain RLS-scoped upsert let only the first account on a device own the row:
 * the next account's write was refused, its notifications all closed out as
 * "no device", and the first account's kept arriving on a device someone else
 * now held. Pinned here:
 *
 *   - registering a token the caller has never seen stores it for them;
 *   - signing in on the same device moves the token to the new account, and
 *     un-revokes it;
 *   - the push claim then delivers the new account's notifications to it, and
 *     no longer the old account's;
 *   - a signed-out caller, and something that is not an Expo token, are refused.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { asRole, connect } from './helpers.js';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client?.end();
});

async function person(): Promise<string> {
  const id = randomUUID();
  await client.query(`INSERT INTO profiles (id, display_name) VALUES ($1, 'Someone')`, [id]);
  return id;
}

/** Register as that person, and keep it (`asRole` would roll it back). */
async function registerFor(profileId: string, token: string, platform = 'ios'): Promise<void> {
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  await client.query(`SET ROLE authenticated`);
  try {
    await client.query(`SELECT waves_register_push_token($1, $2, 'iPad Air')`, [token, platform]);
  } finally {
    await client.query(`RESET ROLE`);
    await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

async function owner(token: string): Promise<{ profile_id: string; revoked: boolean } | null> {
  const { rows } = await client.query(
    `SELECT profile_id, revoked_at IS NOT NULL AS revoked FROM push_tokens WHERE expo_push_token = $1`,
    [token],
  );
  return rows[0] ? { profile_id: String(rows[0].profile_id), revoked: rows[0].revoked } : null;
}

function token(): string {
  return `ExponentPushToken[${randomUUID()}]`;
}

describe('waves_register_push_token', () => {
  it('stores a new token for the signed-in person', async () => {
    const me = await person();
    const t = token();
    await registerFor(me, t);
    expect(await owner(t)).toEqual({ profile_id: me, revoked: false });
  });

  it('moves the device to whoever signs in on it next', async () => {
    const first = await person();
    const second = await person();
    const t = token();
    await registerFor(first, t);
    // The first account signs out (its revoke stamps the row) …
    await client.query(`UPDATE push_tokens SET revoked_at = now() WHERE expo_push_token = $1`, [t]);
    // … and the next one signs in on the same device.
    await registerFor(second, t);
    expect(await owner(t)).toEqual({ profile_id: second, revoked: false });
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM push_tokens WHERE expo_push_token = $1`,
      [t],
    );
    expect(rows[0].n).toBe(1);
  });

  it('then pushes the new account’s notifications to it, not the old one’s', async () => {
    const first = await person();
    const second = await person();
    const t = token();
    await registerFor(first, t);
    await registerFor(second, t);

    const enqueue = async (profileId: string): Promise<string> => {
      const { rows } = await client.query(
        `INSERT INTO notifications (profile_id, kind, title, body, dedupe_key)
         VALUES ($1, 'expense_added', 't', 'b', $2) RETURNING id`,
        [profileId, `push-follow:${randomUUID()}`],
      );
      return String(rows[0].id);
    };
    const mine = await enqueue(second);
    const theirs = await enqueue(first);
    const { rows } = await client.query(
      `SELECT id, tokens FROM waves_claim_push_notifications(500) WHERE id = ANY($1::uuid[])`,
      [[mine, theirs]],
    );
    const byId = new Map(rows.map((r) => [String(r.id), r.tokens as string[]]));
    expect(byId.get(mine)).toEqual([t]);
    expect(byId.has(theirs)).toBe(false);
  });

  it('refuses a caller who is not signed in', async () => {
    const t = token();
    await expect(
      asRole(client, 'authenticated', { role: 'authenticated' }, () =>
        client.query(`SELECT waves_register_push_token($1, 'ios', NULL)`, [t]),
      ),
    ).rejects.toThrow(/NOT_SIGNED_IN/);
  });

  it('refuses something that is not an Expo push token', async () => {
    const me = await person();
    await expect(
      asRole(client, 'authenticated', { sub: me, role: 'authenticated' }, () =>
        client.query(`SELECT waves_register_push_token('not-a-token', 'ios', NULL)`),
      ),
    ).rejects.toThrow(/INVALID_TOKEN/);
  });

  it('is not callable by anon', async () => {
    const t = token();
    await expect(
      asRole(client, 'anon', { role: 'anon' }, () =>
        client.query(`SELECT waves_register_push_token($1, 'ios', NULL)`, [t]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
