/** waves_company_storage_pack_apply: a pack sets the quota, the end of it reverts, files are never touched. */

import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, seedGroup } from './helpers';

const GB = 1024 ** 3;
const FREE = 262144000;
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
let company: string;

const apply = async (
  event: string,
  action: Record<string, unknown>,
  at = new Date(),
  user = g.profileIds[0],
) =>
  (
    await db.query('SELECT waves_company_storage_pack_apply($1,$2,$3,$4,$5) AS o', [
      event,
      'TEST',
      user,
      at,
      JSON.stringify({ kind: 'company_storage', ...action }),
    ])
  ).rows[0].o as string;
const quota = async () =>
  (await db.query('SELECT storage_quota_bytes q FROM company_plans WHERE group_id=$1', [company]))
    .rows[0].q as string | null;

beforeAll(async () => {
  db = await connect();
  g = await seedGroup(db, { memberCount: 2 });
  company = randomUUID();
  await db.query(`INSERT INTO groups(id,type,created_by) VALUES($1,'company',$2)`, [
    company,
    g.profileIds[0],
  ]);
  await db.query(`INSERT INTO group_members(group_id,profile_id,role) VALUES($1,$2,'admin')`, [
    company,
    g.profileIds[0],
  ]);
});
afterAll(async () => {
  if (db) await db.end();
});

describe('company storage packs', () => {
  it('applies a pack for an owner, switches, ignores a stranger and duplicates', async () => {
    const txn = `GPA.${randomUUID()}`;
    const base = { group_id: company, store_txn_id: txn };
    const t0 = Date.now();
    expect(await apply(randomUUID(), { ...base, pack_bytes: GB }, new Date(t0))).toBe('applied');
    expect(await quota()).toBe(String(FREE + GB));
    expect(await apply(randomUUID(), { ...base, pack_bytes: 5 * GB }, new Date(t0 + 1000))).toBe(
      'applied',
    );
    expect(await quota()).toBe(String(FREE + 5 * GB));
    expect(
      await apply(randomUUID(), { ...base, pack_bytes: GB }, new Date(), g.profileIds[1]),
    ).toBe('not_owner');
    const dup = randomUUID();
    await apply(dup, { ...base, pack_bytes: 5 * GB }, new Date(t0 + 2000));
    expect(await apply(dup, { ...base, pack_bytes: GB })).toBe('duplicate');
  });
  it('reverts to the default on expiry, found by subscription, and keeps stored files', async () => {
    const txn = `GPA.${randomUUID()}`;
    await db.query(
      `INSERT INTO storage_objects(logical_bucket,path,owner_profile_id,group_id,company_group_id,bytes,content_type,counted,pending)
       VALUES('company-entry-images',$1,$2,$3,$3,100,'image/jpeg',false,false)`,
      [`${randomUUID()}/${randomUUID()}/${randomUUID()}.jpg`, g.profileIds[0], company],
    );
    const t0 = Date.now() + 10_000;
    await apply(
      randomUUID(),
      { group_id: company, store_txn_id: txn, pack_bytes: GB },
      new Date(t0),
    );
    // An older, different subscription ending later must not undo this pack.
    expect(
      await apply(
        randomUUID(),
        { group_id: null, store_txn_id: 'other', pack_bytes: 0 },
        new Date(t0 + 1),
      ),
    ).toBe('unknown_company');
    expect(
      await apply(
        randomUUID(),
        { group_id: null, store_txn_id: txn, pack_bytes: 0 },
        new Date(t0 + 2),
      ),
    ).toBe('applied');
    expect(await quota()).toBeNull();
    const files = await db.query(
      'SELECT count(*)::int n FROM storage_objects WHERE company_group_id=$1',
      [company],
    );
    expect(files.rows[0].n).toBeGreaterThan(0);
  });
});
