/**
 * Server-side hardening: company rates are not client-trusted, guests cannot enumerate people or brute-force promo
 * codes, promo attempts are capped, and a company's reusable join link is admin-only.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, seedGroup } from './helpers';

let db: Client;
let trip: Awaited<ReturnType<typeof seedGroup>>;
let co: { groupId: string; profileIds: string[]; memberIds: string[] };

// Every test runs in a transaction that is rolled back; `as` switches the caller for one statement block.
async function isolated(run: () => Promise<void>) {
  await db.query('BEGIN');
  try {
    await run();
  } finally {
    await db.query('ROLLBACK');
  }
}
async function as<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  await db.query('SET LOCAL ROLE authenticated');
  try {
    return await run();
  } finally {
    await db.query('RESET ROLE');
  }
}
// Rejection inside the transaction needs a savepoint so later statements still run.
async function rejects(run: () => Promise<unknown>): Promise<string> {
  await db.query('SAVEPOINT s');
  try {
    await run();
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT s');
    return (e as Error).message;
  }
  throw new Error('expected the statement to be refused');
}
// CI's auth stub has no auth.users, so a guest needs one (transaction-local, rolled back with the test).
async function makeGuest(profileId: string) {
  await db.query('CREATE SCHEMA IF NOT EXISTS auth');
  await db.query('CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)');
  await db.query('ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_anonymous boolean');
  await db.query('INSERT INTO auth.users (id, is_anonymous) VALUES ($1, true) ON CONFLICT (id) DO UPDATE SET is_anonymous = true', [profileId]);
}

beforeAll(async () => {
  db = await connect();
  trip = await seedGroup(db, { memberCount: 2 });
  const seed = await seedGroup(db, { memberCount: 3 });
  co = { groupId: randomUUID(), profileIds: seed.profileIds, memberIds: seed.memberIds.map(() => randomUUID()) };
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by,company_default_daily_rate_minor,company_default_mileage_rate_minor) VALUES($1,'company','INR','IN',$2,100000,700)",
    [co.groupId, co.profileIds[0]],
  );
  for (let i = 0; i < 3; i++)
    await db.query('INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,$4)', [
      co.memberIds[i],
      co.groupId,
      co.profileIds[i],
      i === 0 ? 'admin' : 'member',
    ]);
});
afterAll(async () => {
  if (db) await db.end();
});

const create = async (data: Record<string, unknown>, kind = 'allowance') => {
  const id = randomUUID();
  await db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [
    co.groupId,
    id,
    co.memberIds[1],
    kind,
    JSON.stringify({ occurredOn: '2026-12-01', ...data }),
  ]);
  return (await db.query('SELECT amount, rate_minor FROM company_entries WHERE id=$1', [id])).rows[0];
};

describe('company rates are server-side', () => {
  const days = { calcMode: 'days_rate', days: '3', rateMinor: '500000' };
  it('ignores an employee-supplied day rate', () =>
    isolated(async () => {
      const r = await as(co.profileIds[1], () => create(days));
      expect(r).toMatchObject({ amount: '300000', rate_minor: '100000' });
    }));
  it('honours an admin-supplied day rate', () =>
    isolated(async () => {
      const r = await as(co.profileIds[0], () => create(days));
      expect(r).toMatchObject({ amount: '1500000', rate_minor: '500000' });
    }));
  it('uses the stored mileage rate for an employee, the supplied one for an admin', () =>
    isolated(async () => {
      const km = { calcMode: 'distance_rate', category: 'fuel', distanceKm: '10', rateMinor: '99999' };
      expect(await as(co.profileIds[1], () => create(km, 'expense'))).toMatchObject({ amount: '7000', rate_minor: '700' });
      expect(await as(co.profileIds[0], () => create(km, 'expense'))).toMatchObject({ amount: '999990', rate_minor: '99999' });
    }));
});

describe('guests', () => {
  it('cannot look people up', () =>
    isolated(async () => {
      await makeGuest(trip.profileIds[0]);
      const msg = await as(trip.profileIds[0], () =>
        rejects(() => db.query("SELECT * FROM waves_find_person('email','someone@example.com')")),
      );
      expect(msg).toContain('NOT_ALLOWED');
    }));
  it('cannot redeem promo codes', () =>
    isolated(async () => {
      await makeGuest(trip.profileIds[0]);
      const msg = await as(trip.profileIds[0], () =>
        rejects(() => db.query("SELECT waves_redeem_promo('ABCD1234')")),
      );
      expect(msg).toContain('NOT_ALLOWED');
    }));
});

describe('promo redemption attempts', () => {
  it('refuses the 11th attempt in a day, even for a real code', () =>
    isolated(async () => {
      await db.query("INSERT INTO promo_codes(code) VALUES ('SECTEST1')");
      const redeem = (code: string) =>
        db.query('SELECT waves_redeem_promo($1) AS r', [code]).then((x) => x.rows[0].r);
      await as(trip.profileIds[1], async () => {
        for (let i = 0; i < 10; i++) expect((await redeem('NOPE' + i)).reason).toBe('UNKNOWN_CODE');
        expect(await redeem('SECTEST1')).toEqual({ ok: false, reason: 'RATE_LIMITED' });
      });
    }));
});

describe('company join link', () => {
  const token = (g: string) => db.query('SELECT waves_ensure_group_join_token($1) AS t', [g]);
  it('is refused to an employee, given to an admin', () =>
    isolated(async () => {
      const msg = await as(co.profileIds[1], () => rejects(() => token(co.groupId)));
      expect(msg).toContain('NOT_ALLOWED');
      expect((await as(co.profileIds[0], () => token(co.groupId))).rows[0].t).toBeTruthy();
    }));
  it('is still available to any member of an ordinary group', () =>
    isolated(async () => {
      expect((await as(trip.profileIds[1], () => token(trip.groupId))).rows[0].t).toBeTruthy();
    }));
});
