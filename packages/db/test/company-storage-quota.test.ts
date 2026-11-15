import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, connect, expectDenied, seedGroup } from './helpers';

let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
const entry = randomUUID();
const store = (bytes: number) =>
  db.query(`SELECT waves_storage_reserve($1,$2,'company-entry-images',$3,$4,'image/jpeg')`, [
    g.profileIds[0],
    g.groupId,
    `${entry}/${randomUUID()}/${randomUUID()}.jpg`,
    bytes,
  ]);
const setDefault = (bytes: number) =>
  db.query(`UPDATE app_config SET value=$1 WHERE key='company_free_storage_bytes'`, [bytes]);
const setQuota = (q: number | null) =>
  db.query('UPDATE company_plans SET storage_quota_bytes=$2 WHERE group_id=$1', [g.groupId, q]);

beforeAll(async () => {
  db = await connect();
  const seed = await seedGroup(db, { memberCount: 2 });
  g = { ...seed, groupId: randomUUID(), memberIds: seed.memberIds.map(() => randomUUID()) };
  await db.query(`INSERT INTO groups(id,type,created_by) VALUES($1,'company',$2)`, [
    g.groupId,
    g.profileIds[0],
  ]);
  await db.query(
    `INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,'admin')`,
    [g.memberIds[0], g.groupId, g.profileIds[0]],
  );
  await db.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: g.profileIds[0], role: 'authenticated' }),
  ]);
  await db.query(
    `SELECT waves_company_entry_create($1,$2,$3,'expense','{"amount":"1","occurredOn":"2026-11-05"}')`,
    [g.groupId, entry, g.memberIds[0]],
  );
});
afterAll(async () => {
  if (db) {
    await setDefault(262144000);
    await db.end();
  }
});

describe('company storage quota', () => {
  it('defaults to 250 MB and falls back when the company has no override', async () => {
    await setQuota(null);
    const q = (await db.query('SELECT waves_company_storage_quota($1) AS q', [g.groupId])).rows[0]
      .q;
    expect(q).toBe('262144000');
  });
  it('refuses new uploads at the shared default, an override lifts it, usage reports it', async () => {
    await setQuota(null);
    await setDefault(150);
    await store(100);
    expect(await expectDenied(store(100))).toMatch(/STORAGE_CAP/);
    await setQuota(1000);
    await store(100);
    await setQuota(null);
    const u = await asRole(
      db,
      'authenticated',
      { sub: g.profileIds[0], role: 'authenticated' },
      () => db.query('SELECT * FROM waves_company_storage_usage($1)', [g.groupId]),
    );
    expect(u.rows[0]).toMatchObject({ used_bytes: '0', reserved_bytes: '200', quota_bytes: '150' });
  });
  it('admin reads the figures and sets or resets the quota', async () => {
    await db.query('SELECT waves_admin_company_storage_set($1,5000)', [g.groupId]);
    const set = (await db.query('SELECT waves_admin_company_storage($1) AS j', [g.groupId])).rows[0]
      .j;
    expect(set).toMatchObject({ quota_bytes: 5000, override_bytes: 5000 });
    await db.query('SELECT waves_admin_company_storage_set($1,NULL)', [g.groupId]);
    const reset = (await db.query('SELECT waves_admin_company_storage($1) AS j', [g.groupId]))
      .rows[0].j;
    expect(reset.override_bytes).toBeNull();
  });
});
