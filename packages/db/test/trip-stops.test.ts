/**
 * The trip's itinerary, at the trust boundary.
 *
 * The calendar arithmetic (which stop a day falls in, what a stop costs) lives
 * in @waves/core; what has to be proven in the database is what every
 * group-visible-admin-set field has to prove: only an admin can move it, the
 * column cannot be written around the RPC, and the RPC refuses an itinerary
 * that is not one — a bad country, days the wrong way round, two stops on one
 * day, a stop outside the trip, too many of them.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, expectDenied, seedGroup, type SeededGroup } from './helpers';

let client: Client;
let group: SeededGroup;

beforeAll(async () => {
  client = await connect();
  // profile 0 = admin, 1 and 2 = members.
  group = await seedGroup(client, { memberCount: 3, name: 'South-east Asia' });
});

afterAll(async () => {
  await client.end();
});

beforeEach(async () => {
  await client.query(
    `UPDATE groups SET trip_stops = NULL, start_date = NULL, end_date = NULL WHERE id = $1`,
    [group.groupId],
  );
});

/** Committed as a signed-in profile, the way an RLS write really happens. */
async function as<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  await client.query('SET ROLE authenticated');
  try {
    return await run();
  } finally {
    await client.query('RESET ROLE');
  }
}

type Stop = { country: string; start: string; end: string };

const set = (profileId: string, stops: Stop[]) =>
  as(profileId, () =>
    client.query(`SELECT waves_set_trip_stops($1, $2::jsonb)`, [
      group.groupId,
      JSON.stringify(stops),
    ]),
  );

const stored = async (): Promise<Stop[] | null> => {
  const { rows } = await client.query(`SELECT trip_stops FROM groups WHERE id = $1`, [
    group.groupId,
  ]);
  return (rows[0]?.trip_stops ?? null) as Stop[] | null;
};

const bali: Stop = { country: 'ID', start: '2026-10-01', end: '2026-10-05' };
const singapore: Stop = { country: 'SG', start: '2026-10-06', end: '2026-10-08' };
const vietnam: Stop = { country: 'VN', start: '2026-10-09', end: '2026-10-14' };

describe('an admin sets the itinerary', () => {
  it('stores the stops sorted by start, countries upper-cased', async () => {
    await set(group.profileIds[0] as string, [vietnam, { ...bali, country: 'id' }, singapore]);
    expect(await stored()).toEqual([bali, singapore, vietnam]);
  });

  it('clears it with an empty list', async () => {
    await set(group.profileIds[0] as string, [bali]);
    await set(group.profileIds[0] as string, []);
    expect(await stored()).toBeNull();
  });

  it('bumps the row revision so every member pulls the change', async () => {
    const before = await client.query(`SELECT updated_seq FROM groups WHERE id = $1`, [
      group.groupId,
    ]);
    await set(group.profileIds[0] as string, [bali]);
    const after = await client.query(`SELECT updated_seq FROM groups WHERE id = $1`, [
      group.groupId,
    ]);
    expect(Number(after.rows[0].updated_seq)).toBeGreaterThan(Number(before.rows[0].updated_seq));
  });
});

describe('the RPC refuses an itinerary that is not one', () => {
  const admin = () => group.profileIds[0] as string;

  it('a country that is not two letters', async () => {
    const message = await expectDenied(set(admin(), [{ ...bali, country: 'IDN' }]));
    expect(message).toContain('BAD_COUNTRY');
  });

  it('a day that is not a day', async () => {
    const message = await expectDenied(set(admin(), [{ ...bali, end: '2026-10-32' }]));
    expect(message).toContain('BAD_DATE');
    const shape = await expectDenied(set(admin(), [{ ...bali, start: '1 Oct' }]));
    expect(shape).toContain('BAD_DATE');
  });

  it('an end before its start', async () => {
    const message = await expectDenied(
      set(admin(), [{ country: 'SG', start: '2026-10-08', end: '2026-10-06' }]),
    );
    expect(message).toContain('END_BEFORE_START');
  });

  it('two stops on the same day', async () => {
    const message = await expectDenied(
      set(admin(), [bali, { country: 'SG', start: '2026-10-05', end: '2026-10-08' }]),
    );
    expect(message).toContain('OVERLAP');
    expect(await stored()).toBeNull();
  });

  it('a stop outside the trip dates, when the trip has them', async () => {
    await client.query(
      `UPDATE groups SET start_date = '2026-10-02', end_date = '2026-10-14' WHERE id = $1`,
      [group.groupId],
    );
    const message = await expectDenied(set(admin(), [bali, singapore]));
    expect(message).toContain('OUTSIDE_TRIP');
    await set(admin(), [singapore, vietnam]);
    expect(await stored()).toEqual([singapore, vietnam]);
  });

  it('more than fifteen stops', async () => {
    const many = Array.from({ length: 16 }, (_, i) => ({
      country: 'ID',
      start: `2026-01-${String(i + 1).padStart(2, '0')}`,
      end: `2026-01-${String(i + 1).padStart(2, '0')}`,
    }));
    const message = await expectDenied(set(admin(), many));
    expect(message).toContain('TOO_MANY');
  });

  it('something that is not a list', async () => {
    const message = await expectDenied(
      as(admin(), () =>
        client.query(`SELECT waves_set_trip_stops($1, $2::jsonb)`, [
          group.groupId,
          JSON.stringify({ country: 'ID' }),
        ]),
      ),
    );
    expect(message).toContain('BAD_STOPS');
  });
});

describe('only an admin, and only through the RPC', () => {
  it('refuses an ordinary member', async () => {
    const message = await expectDenied(set(group.profileIds[1] as string, [bali]));
    expect(message).toContain('NOT_AN_ADMIN');
    expect(await stored()).toBeNull();
  });

  it('refuses a direct write to the column, even by the admin', async () => {
    const message = await expectDenied(
      as(group.profileIds[0] as string, () =>
        client.query(`UPDATE groups SET trip_stops = $1::jsonb WHERE id = $2`, [
          JSON.stringify([bali]),
          group.groupId,
        ]),
      ),
    );
    expect(message).toContain('FORBIDDEN_COLUMN');
    expect(await stored()).toBeNull();
  });

  it('keeps the column an array even for a privileged writer', async () => {
    await expect(
      client.query(`UPDATE groups SET trip_stops = '{"country":"ID"}'::jsonb WHERE id = $1`, [
        group.groupId,
      ]),
    ).rejects.toThrow(/groups_trip_stops_shape/);
  });

  it('is not callable anonymously', async () => {
    const { rows } = await client.query<{ ok: boolean }>(
      `SELECT has_function_privilege('anon', 'public.waves_set_trip_stops(uuid, jsonb)', 'EXECUTE') AS ok`,
    );
    expect(rows[0]?.ok).toBe(false);
  });
});
