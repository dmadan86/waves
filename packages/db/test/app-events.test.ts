/**
 * First-party analytics events: what the write path lets in, and what it keeps out.
 *
 * `waves_track_event` is callable signed-out, so everything it stores is
 * decided here rather than trusted from the client.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, expectDenied, seedGroup } from './helpers';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client.end();
});

async function asRole<T>(role: string, sub: string | null, run: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    if (sub) await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [sub]);
    return await run();
  } finally {
    await client.query('ROLLBACK');
  }
}

async function track(
  installId: string,
  name: string,
  props: unknown = {},
  platform: string | null = 'android',
  version: string | null = '1.2.3',
): Promise<boolean> {
  const { rows } = await client.query(`SELECT public.waves_track_event($1, $2, $3, $4, $5) AS ok`, [
    installId,
    name,
    platform,
    version,
    JSON.stringify(props),
  ]);
  return rows[0].ok;
}

const rowsFor = async (installId: string) =>
  (
    await client.query('SELECT * FROM public.app_events WHERE install_id = $1 ORDER BY id', [
      installId,
    ])
  ).rows;

describe('waves_track_event', () => {
  it('stores an allowed event, signed out, with no profile', async () => {
    const install = randomUUID();
    const ok = await asRole('anon', null, async () => {
      const { rows } = await client.query(
        `SELECT public.waves_track_event($1, 'app_installed', 'ios', '1.0.0', '{}') AS ok`,
        [install],
      );
      return rows[0].ok;
    });
    expect(ok).toBe(true);
    // The rollback above undid it; write for real as the owner to inspect.
    expect(await track(install, 'app_installed', {}, 'ios', '1.0.0')).toBe(true);
    const [row] = await rowsFor(install);
    expect(row.profile_id).toBeNull();
    expect(row.platform).toBe('ios');
    expect(row.app_version).toBe('1.0.0');
  });

  it('records the signed-in profile, and drops a profile that does not exist', async () => {
    const { profileIds } = await seedGroup(client, { memberCount: 1 });
    const install = randomUUID();
    await client.query('BEGIN');
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [profileIds[0]]);
    await client.query(
      `SELECT public.waves_track_event($1, 'signup_started', 'ios', '1.0.0', '{"method":"phone"}')`,
      [install],
    );
    await client.query('COMMIT');
    const [row] = await rowsFor(install);
    expect(row.profile_id).toBe(profileIds[0]);

    const ghost = randomUUID();
    await client.query('BEGIN');
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [randomUUID()]);
    await client.query(
      `SELECT public.waves_track_event($1, 'premium_viewed', 'ios', '1.0.0', '{}')`,
      [ghost],
    );
    await client.query('COMMIT');
    expect((await rowsFor(ghost))[0].profile_id).toBeNull();
  });

  it('refuses a name that is not on the list', async () => {
    const message = await expectDenied(track(randomUUID(), 'expense_added'));
    expect(message).toMatch(/UNKNOWN_EVENT/);
  });

  it('keeps one app_installed per install and ignores the repeat', async () => {
    const install = randomUUID();
    expect(await track(install, 'app_installed')).toBe(true);
    expect(await track(install, 'app_installed')).toBe(false);
    expect(await rowsFor(install)).toHaveLength(1);
    // Other events are not deduplicated.
    expect(await track(install, 'premium_viewed', { screen: 'paywall' })).toBe(true);
    expect(await track(install, 'premium_viewed', { screen: 'paywall' })).toBe(true);
    expect(await rowsFor(install)).toHaveLength(3);
  });

  it('keeps only short enum words under known keys', async () => {
    const install = randomUUID();
    await track(install, 'signup_started', {
      method: 'phone',
      screen: 'paywall',
      phone: '+919999999999',
      email: 'a@b.co',
      amount: 4200,
      description: 'Dinner at Taj',
      source: 'A long sentence with spaces and Capitals',
      nested: { method: 'phone' },
    });
    const [row] = await rowsFor(install);
    expect(row.props).toEqual({ method: 'phone', screen: 'paywall' });
  });

  it('stores nothing in props for a non-object, and a null for a bad platform or version', async () => {
    const install = randomUUID();
    await track(install, 'premium_viewed', ['a', 'b'], 'symbian', 'not a version!');
    const [row] = await rowsFor(install);
    expect(row.props).toEqual({});
    expect(row.platform).toBeNull();
    expect(row.app_version).toBeNull();
  });

  it('stops an install that has sent 200 events in an hour', async () => {
    const install = randomUUID();
    await client.query(
      `INSERT INTO public.app_events (install_id, name)
       SELECT $1, 'premium_viewed' FROM generate_series(1, 200)`,
      [install],
    );
    expect(await track(install, 'premium_viewed')).toBe(false);
    expect(await rowsFor(install)).toHaveLength(200);
    // An older burst does not count.
    const other = randomUUID();
    await client.query(
      `INSERT INTO public.app_events (install_id, name, occurred_at)
       SELECT $1, 'premium_viewed', now() - interval '2 hours' FROM generate_series(1, 200)`,
      [other],
    );
    expect(await track(other, 'premium_viewed')).toBe(true);
  });
});

describe('the table itself', () => {
  it('cannot be read or written directly by anon or a signed-in user', async () => {
    for (const role of ['anon', 'authenticated']) {
      const read = await asRole(role, null, () =>
        expectDenied(client.query('SELECT * FROM public.app_events')),
      );
      expect(read, role).toMatch(/permission denied/i);
      const write = await asRole(role, null, () =>
        expectDenied(
          client.query(
            `INSERT INTO public.app_events (install_id, name) VALUES ($1, 'app_installed')`,
            [randomUUID()],
          ),
        ),
      );
      expect(write, role).toMatch(/permission denied/i);
    }
  });

  it('refuses a props blob that is too big even from the owner', async () => {
    await expect(
      client.query(
        `INSERT INTO public.app_events (install_id, name, props) VALUES ($1, 'premium_viewed', $2::jsonb)`,
        [randomUUID(), JSON.stringify({ x: 'y'.repeat(4000) })],
      ),
    ).rejects.toThrow(/app_events_props_small/);
  });

  it('keeps the event after the account is deleted, with the profile cleared', async () => {
    const profileId = randomUUID();
    await client.query(`INSERT INTO public.profiles (id, display_name) VALUES ($1, 'Gone')`, [
      profileId,
    ]);
    const install = randomUUID();
    await client.query(
      `INSERT INTO public.app_events (install_id, profile_id, name) VALUES ($1, $2, 'premium_viewed')`,
      [install, profileId],
    );
    await client.query('DELETE FROM public.profiles WHERE id = $1', [profileId]);
    const [row] = await rowsFor(install);
    expect(row.profile_id).toBeNull();
  });
});
