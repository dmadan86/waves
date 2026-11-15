/**
 * G44: Billing – storage packs, duplicate transaction idempotency, cross-company.
 *
 * waves_company_storage_pack_apply(event_id, type, app_user_id, event_at, action)
 * where action = { group_id, pack_bytes, store_txn_id }
 * pack_bytes > 0 → add storage; pack_bytes = 0 → end subscription.
 */
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, seedGroup } from './helpers';

let db: Client;
let ga: Awaited<ReturnType<typeof seedGroup>>;
let gb: Awaited<ReturnType<typeof seedGroup>>;

const GB1 = 1073741824; // 1 GB in bytes
const GB5 = 5368709120; // 5 GB in bytes

const packApply = (
  eventId: string,
  groupId: string,
  profileId: string,
  packBytes: number = GB1,
  txnId?: string,
) =>
  db.query('SELECT waves_company_storage_pack_apply($1,$2,$3,$4,$5)', [
    eventId,
    'INITIAL_PURCHASE',
    profileId,
    new Date().toISOString(),
    JSON.stringify({
      group_id: groupId,
      pack_bytes: packBytes,
      store_txn_id: txnId ?? `txn-${eventId}`,
    }),
  ]);

async function setupCompany(seed: Awaited<ReturnType<typeof seedGroup>>) {
  await db.query('DELETE FROM groups WHERE id=$1', [seed.groupId]);
  const groupId = randomUUID();
  seed.groupId = groupId;
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
    [groupId, seed.profileIds[0]],
  );
  await db.query('INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,$4)', [
    seed.memberIds[0],
    groupId,
    seed.profileIds[0],
    'admin',
  ]);
  await db.query(
    "INSERT INTO company_plans(group_id,plan) VALUES($1,'free') ON CONFLICT DO NOTHING",
    [groupId],
  );
  return seed;
}

beforeAll(async () => {
  db = await connect();
  ga = await setupCompany(await seedGroup(db, { memberCount: 1 }));
  gb = await setupCompany(await seedGroup(db, { memberCount: 1 }));
});

afterAll(async () => {
  if (db) await db.end();
});

describe('G44: billing – storage packs, idempotency, cross-company attribution', () => {
  it('pack apply increases quota for the target company only', async () => {
    // Reset both companies to no override
    await db.query('UPDATE company_plans SET storage_quota_bytes=NULL WHERE group_id=ANY($1)', [
      [ga.groupId, gb.groupId],
    ]);

    const beforeA = parseInt(
      (await db.query('SELECT waves_company_storage_quota($1) AS q', [ga.groupId])).rows[0].q,
      10,
    );
    const beforeB = parseInt(
      (await db.query('SELECT waves_company_storage_quota($1) AS q', [gb.groupId])).rows[0].q,
      10,
    );

    await packApply(`billing-only-a-${randomUUID()}`, ga.groupId, ga.profileIds[0]!, GB1);

    const afterA = parseInt(
      (await db.query('SELECT waves_company_storage_quota($1) AS q', [ga.groupId])).rows[0].q,
      10,
    );
    const afterB = parseInt(
      (await db.query('SELECT waves_company_storage_quota($1) AS q', [gb.groupId])).rows[0].q,
      10,
    );

    expect(afterA).toBeGreaterThan(beforeA);
    expect(afterB).toBe(beforeB); // company B unaffected
  });

  it('pack apply with same event_id is idempotent (quota increases only once)', async () => {
    await db.query('UPDATE company_plans SET storage_quota_bytes=NULL WHERE group_id=$1', [
      ga.groupId,
    ]);
    const eventId = `billing-idempotent-${randomUUID()}`;

    await packApply(eventId, ga.groupId, ga.profileIds[0]!, GB1);
    const after1 = parseInt(
      (await db.query('SELECT waves_company_storage_quota($1) AS q', [ga.groupId])).rows[0].q,
      10,
    );

    // Apply same event again - should be duplicate / no-op
    const result = await db.query('SELECT waves_company_storage_pack_apply($1,$2,$3,$4,$5) AS r', [
      eventId,
      'INITIAL_PURCHASE',
      ga.profileIds[0]!,
      new Date().toISOString(),
      JSON.stringify({
        group_id: ga.groupId,
        pack_bytes: GB1,
        store_txn_id: `txn-${eventId}`,
      }),
    ]);
    const outcome = result.rows[0].r as string;
    expect(outcome).toBe('duplicate');

    const after2 = parseInt(
      (await db.query('SELECT waves_company_storage_quota($1) AS q', [ga.groupId])).rows[0].q,
      10,
    );

    expect(after2).toBe(after1); // idempotent
  });

  it('5GB pack gives more quota than 1GB pack', async () => {
    // Apply 1gb to company A
    await db.query('UPDATE company_plans SET storage_quota_bytes=NULL WHERE group_id=$1', [
      ga.groupId,
    ]);
    await packApply(`billing-1gb-${randomUUID()}`, ga.groupId, ga.profileIds[0]!, GB1);
    const after1gb = parseInt(
      (await db.query('SELECT waves_company_storage_quota($1) AS q', [ga.groupId])).rows[0].q,
      10,
    );

    // Apply 5gb to company B
    await db.query('UPDATE company_plans SET storage_quota_bytes=NULL WHERE group_id=$1', [
      gb.groupId,
    ]);
    await packApply(`billing-5gb-${randomUUID()}`, gb.groupId, gb.profileIds[0]!, GB5);
    const after5gb = parseInt(
      (await db.query('SELECT waves_company_storage_quota($1) AS q', [gb.groupId])).rows[0].q,
      10,
    );

    expect(after5gb).toBeGreaterThan(after1gb);
  });

  it('non-owner profile cannot apply a pack to a company', async () => {
    await db.query('UPDATE company_plans SET storage_quota_bytes=NULL WHERE group_id=$1', [
      ga.groupId,
    ]);
    const eventId = `billing-non-owner-${randomUUID()}`;
    const outsider = randomUUID();
    await db.query(
      "INSERT INTO profiles(id,display_name,default_currency) VALUES($1,'Outsider','INR')",
      [outsider],
    );

    const r = await db.query('SELECT waves_company_storage_pack_apply($1,$2,$3,$4,$5) AS r', [
      eventId,
      'INITIAL_PURCHASE',
      outsider,
      new Date().toISOString(),
      JSON.stringify({ group_id: ga.groupId, pack_bytes: GB1, store_txn_id: `txn-${eventId}` }),
    ]);
    const outcome = r.rows[0].r as string;
    expect(outcome).toBe('not_owner');
  });

  it('admin can view and set quota override independent of packs', async () => {
    await db.query('SELECT waves_admin_company_storage_set($1,$2)', [ga.groupId, 9999]);
    const info = (await db.query('SELECT waves_admin_company_storage($1) AS j', [ga.groupId]))
      .rows[0].j;
    expect(info.override_bytes).toBe(9999);

    await db.query('SELECT waves_admin_company_storage_set($1,NULL)', [ga.groupId]);
    const reset = (await db.query('SELECT waves_admin_company_storage($1) AS j', [ga.groupId]))
      .rows[0].j;
    expect(reset.override_bytes).toBeNull();
  });
});
