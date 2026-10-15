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

  it('keeps a short lowercase variant prop, for the Plus price test', async () => {
    const install = randomUUID();
    await track(install, 'premium_viewed', { screen: 'paywall', variant: 'p79' });
    await track(install, 'premium_viewed', { variant: 'P 79!' });
    const rows = await rowsFor(install);
    expect(rows[0].props).toEqual({ screen: 'paywall', variant: 'p79' });
    expect(rows[1].props).toEqual({});
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

const rand = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo));
const runPrefix = `${rand(11, 223)}.${rand(0, 255)}`;
/** An address that is new on every run, so reruns on a used database stay independent. */
const ip = (n: number) => `${runPrefix}.0.${n}`;

/** One call with the proxy headers PostgREST would have set. */
async function trackFrom(
  headers: Record<string, string> | null,
  installId: string,
  name = 'premium_viewed',
): Promise<boolean> {
  await client.query('BEGIN');
  try {
    if (headers) {
      await client.query(`SELECT set_config('request.headers', $1, true)`, [
        JSON.stringify(headers),
      ]);
    }
    const ok = await track(installId, name);
    await client.query('COMMIT');
    return ok;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

const hitsFor = async (ipHash: string) =>
  Number(
    (
      await client.query('SELECT count(*) AS n FROM public.app_event_ip_hits WHERE ip_hash = $1', [
        ipHash,
      ])
    ).rows[0].n,
  );

const hashOf = async (value: string) =>
  (
    await client.query(
      `SELECT encode(sha256(convert_to('waves-app-events-ip-v1:' || $1, 'UTF8')), 'hex') AS h`,
      [value],
    )
  ).rows[0].h as string;

describe('the per-address flood guard', () => {
  it('lets 20 installs an hour through from one address and drops the 21st', async () => {
    const xff = { 'x-forwarded-for': ip(10) };
    for (let i = 0; i < 20; i++) {
      expect(await trackFrom(xff, randomUUID(), 'app_installed'), `install ${i}`).toBe(true);
    }
    const extra = randomUUID();
    expect(await trackFrom(xff, extra, 'app_installed')).toBe(false);
    expect(await rowsFor(extra)).toHaveLength(0);
    // Other events from the same address are still fine until the total cap.
    expect(await trackFrom(xff, randomUUID())).toBe(true);
  });

  it('drops the 301st event of any kind from one address', async () => {
    const headers = { 'x-forwarded-for': ip(20) };
    const hash = await hashOf(ip(20));
    await client.query(
      `INSERT INTO public.app_event_ip_hits (ip_hash) SELECT $1 FROM generate_series(1, 300)`,
      [hash],
    );
    expect(await trackFrom(headers, randomUUID())).toBe(false);
    // An older burst does not count.
    const old = await hashOf(ip(21));
    await client.query(
      `INSERT INTO public.app_event_ip_hits (ip_hash, at)
       SELECT $1, now() - interval '2 hours' FROM generate_series(1, 300)`,
      [old],
    );
    expect(await trackFrom({ 'x-forwarded-for': ip(21) }, randomUUID())).toBe(true);
  });

  it('keeps different addresses independent', async () => {
    const a = { 'x-forwarded-for': ip(1) };
    for (let i = 0; i < 20; i++) await trackFrom(a, randomUUID(), 'app_installed');
    expect(await trackFrom(a, randomUUID(), 'app_installed')).toBe(false);
    expect(await trackFrom({ 'x-forwarded-for': ip(2) }, randomUUID(), 'app_installed')).toBe(true);
  });

  it('prefers cf-connecting-ip, and otherwise the first x-forwarded-for entry', async () => {
    const cf = ip(50);
    await trackFrom(
      { 'cf-connecting-ip': cf, 'x-forwarded-for': '10.9.9.9, 10.8.8.8' },
      randomUUID(),
    );
    expect(await hitsFor(await hashOf(cf))).toBe(1);
    expect(await hitsFor(await hashOf('10.9.9.9'))).toBe(0);

    await trackFrom({ 'x-forwarded-for': ` ${ip(60)} , 10.8.8.8` }, randomUUID());
    expect(await hitsFor(await hashOf(ip(60)))).toBe(1);
  });

  it('applies no per-address limit, and logs nothing, without a usable header', async () => {
    const before = Number(
      (await client.query('SELECT count(*) AS n FROM public.app_event_ip_hits')).rows[0].n,
    );
    const cases: Array<Record<string, string> | null> = [
      null,
      {},
      { 'x-forwarded-for': '' },
      { 'user-agent': 'x' },
    ];
    for (const headers of cases) {
      expect(await trackFrom(headers, randomUUID(), 'app_installed')).toBe(true);
    }
    // Garbage in the setting is "no address", not an error.
    await client.query('BEGIN');
    await client.query(`SELECT set_config('request.headers', 'not json', true)`);
    expect(await track(randomUUID(), 'app_installed')).toBe(true);
    await client.query('COMMIT');
    const after = Number(
      (await client.query('SELECT count(*) AS n FROM public.app_event_ip_hits')).rows[0].n,
    );
    expect(after).toBe(before);
  });

  it('never stores the raw address anywhere', async () => {
    const addr = ip(99);
    const install = randomUUID();
    await trackFrom(
      { 'x-forwarded-for': addr, 'cf-connecting-ip': addr },
      install,
      'app_installed',
    );
    const { rows } = await client.query(
      `SELECT t::text AS dump FROM public.app_event_ip_hits t WHERE ip_hash = $1`,
      [await hashOf(addr)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].dump).not.toContain(addr);
    const all = await client.query(
      `SELECT (SELECT string_agg(t::text, ' ') FROM public.app_event_ip_hits t) AS h,
              (SELECT string_agg(e::text, ' ') FROM public.app_events e WHERE install_id = $1) AS e`,
      [install],
    );
    expect(all.rows[0].h).not.toContain(addr);
    expect(all.rows[0].e).not.toContain(addr);
  });

  it('sweeps address rows older than two days', async () => {
    const hash = await hashOf(ip(77));
    await client.query(
      `INSERT INTO public.app_event_ip_hits (ip_hash, at) VALUES ($1, now() - interval '3 days')`,
      [hash],
    );
    // The sweep runs on about one call in a hundred; 1000 calls make a miss
    // astronomically unlikely (0.99^1000).
    for (let i = 0; i < 1000 && (await hitsFor(hash)) > 0; i++) {
      await trackFrom({ 'x-forwarded-for': `100.64.${i % 250}.${(i >> 8) + 1}` }, randomUUID());
    }
    expect(await hitsFor(hash)).toBe(0);
  });
});

describe('the global install ceiling', () => {
  it('drops installs past 5000 an hour, but not other events', async () => {
    const marker = randomUUID();
    await client.query(
      `INSERT INTO public.app_events (install_id, name, app_version)
       SELECT gen_random_uuid(), 'app_installed', 'ceiling-test' FROM generate_series(1, 5000)`,
    );
    try {
      const install = randomUUID();
      expect(await track(install, 'app_installed')).toBe(false);
      expect(await track(marker, 'premium_viewed')).toBe(true);
    } finally {
      await client.query(`DELETE FROM public.app_events WHERE app_version = 'ceiling-test'`);
    }
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

describe('the Plus price test', () => {
  it('ships the plus_price flag off, at 0%, with the three arms', async () => {
    const { rows } = await client.query(
      `SELECT enabled, rollout_percent, variants FROM public.feature_flags WHERE key = 'plus_price'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(false);
    expect(rows[0].rollout_percent).toBe(0);
    expect(rows[0].variants).toEqual(['p49', 'p79', 'p99']);
  });

  it('counts plans-screen installs per arm, and is closed to anon and signed-in users', async () => {
    const install = randomUUID();
    await track(install, 'premium_viewed', { screen: 'paywall', variant: 'p79' });
    await track(install, 'premium_viewed', { screen: 'upgrade', variant: 'p79' });
    const { rows } = await client.query(`SELECT * FROM public.waves_admin_plus_price_results()`);
    const p79 = rows.find((row) => row.variant === 'p79');
    expect(Number(p79.premium_viewed_installs)).toBeGreaterThanOrEqual(1);
    for (const role of ['anon', 'authenticated']) {
      const denied = await asRole(role, null, () =>
        expectDenied(client.query(`SELECT * FROM public.waves_admin_plus_price_results()`)),
      );
      expect(denied, role).toMatch(/permission denied/i);
    }
  });
});
