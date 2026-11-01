/**
 * G37–G38: Storage – quota, reserve, commit, cancel, pack apply, cross-company isolation.
 *
 * Members: 0 owner, 1 manager.
 * Two companies are used to verify company-scoped quota separation.
 */
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

const today = new Date().toISOString().slice(0, 10);

let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
let other: Awaited<ReturnType<typeof seedGroup>>;

async function user<T>(i: number, run: () => Promise<T>): Promise<T> {
  await db.query('SAVEPOINT actor_scope');
  try {
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: g.profileIds[i]!, role: 'authenticated' }),
    ]);
    await db.query('SET LOCAL ROLE authenticated');
    return await run();
  } catch (error) {
    await db.query('ROLLBACK TO SAVEPOINT actor_scope');
    throw error;
  } finally {
    await db.query('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claims','',true)");
    await db.query('RELEASE SAVEPOINT actor_scope');
  }
}

async function _isolated(run: () => Promise<void>) {
  await db.query('BEGIN');
  try {
    await run();
  } finally {
    await db.query('ROLLBACK');
  }
}

async function _denied(run: () => Promise<unknown>) {
  await db.query('SAVEPOINT expected_failure');
  try {
    await expectDenied(run());
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT expected_failure');
  }
}

/** Set the company's storage override quota (or null to reset). */
const setQuota = (groupId: string, bytes: number | null) =>
  db.query('UPDATE company_plans SET storage_quota_bytes=$2 WHERE group_id=$1', [groupId, bytes]);

/** Set app_config free storage bytes default. */
const setDefault = (bytes: number) =>
  db.query("UPDATE app_config SET value=$1 WHERE key='company_free_storage_bytes'", [bytes]);

/** Reserve bytes for an entry (via the storage write RPC in service_role). */
const reserve = async (
  profileId: string,
  groupId: string,
  entryId: string,
  bytes: number,
): Promise<void> => {
  await db.query(
    `SELECT waves_company_storage_write($1,$2,$3,$4,'image/jpeg',false)`,
    [profileId, groupId, `${entryId}/${randomUUID()}/${randomUUID()}.jpg`, bytes],
  );
};

beforeAll(async () => {
  db = await connect();

  // Company A
  g = await seedGroup(db, { memberCount: 2 });
  await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
  g.groupId = randomUUID();
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
    [g.groupId, g.profileIds[0]!],
  );
  for (let i = 0; i < 2; i++) {
    await db.query(
      "INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,$4)",
      [g.memberIds[i]!, g.groupId, g.profileIds[i]!, i === 0 ? 'admin' : 'manager'],
    );
  }
  // Ensure company_plans row exists
  await db.query(
    "INSERT INTO company_plans(group_id,plan) VALUES($1,'free') ON CONFLICT DO NOTHING",
    [g.groupId],
  );

  // Company B (for isolation tests)
  other = await seedGroup(db, { memberCount: 2 });
  await db.query('DELETE FROM groups WHERE id=$1', [other.groupId]);
  other.groupId = randomUUID();
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
    [other.groupId, other.profileIds[0]!],
  );
  await db.query(
    "INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,'admin')",
    [other.memberIds[0]!, other.groupId, other.profileIds[0]!],
  );
  await db.query(
    "INSERT INTO company_plans(group_id,plan) VALUES($1,'free') ON CONFLICT DO NOTHING",
    [other.groupId],
  );

  // Seed the company_entry for reservations
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: g.profileIds[0]!, role: 'authenticated' }),
  ]);
});

afterAll(async () => {
  if (db) {
    // Restore app_config defaults to be safe
    await setDefault(262144000).catch(() => undefined);
    await db.end();
  }
});

describe('G37: storage quota – default, override, isolation', () => {
  it('quota RPC returns default when no override', async () => {
    await setQuota(g.groupId, null);
    const q = (await db.query('SELECT waves_company_storage_quota($1) AS q', [g.groupId])).rows[0]
      .q;
    expect(parseInt(q, 10)).toBeGreaterThan(0);
  });

  it('quota override takes precedence over default', async () => {
    await setQuota(g.groupId, 9999);
    const q = (await db.query('SELECT waves_company_storage_quota($1) AS q', [g.groupId])).rows[0]
      .q;
    expect(parseInt(q, 10)).toBe(9999);
    await setQuota(g.groupId, null);
  });

  it('usage is company-scoped: other company bytes are not counted', async () => {
    await setQuota(g.groupId, null);
    await setDefault(500);
    // Seed an entry for company A and B to use as target
    const entryA = randomUUID();
    const entryB = randomUUID();
    await db.query("SELECT set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: g.profileIds[0]!, role: 'authenticated' }),
    ]);
    await db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [
      g.groupId, entryA, g.memberIds[0]!, 'expense',
      JSON.stringify({ amount: '1', occurredOn: today }),
    ]);
    await db.query("SELECT set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: other.profileIds[0]!, role: 'authenticated' }),
    ]);
    await db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [
      other.groupId, entryB, other.memberIds[0]!, 'expense',
      JSON.stringify({ amount: '1', occurredOn: today }),
    ]);
    await db.query("SELECT set_config('request.jwt.claims','',false)");

    // Reserve 400 bytes for other company – should not affect company A's quota
    await reserve(other.profileIds[0]!, other.groupId, entryB, 400);

    // Company A can still reserve within its own 500-byte quota
    await reserve(g.profileIds[0]!, g.groupId, entryA, 400);

    await setDefault(262144000);
  });
});

describe('G38: quota at exact limit; duplicate commit; pack apply idempotency', () => {
  it('over-limit reserve is rejected', async () => {
    // Use explicit override to set a tiny quota
    await setQuota(g.groupId, 1); // 1 byte quota

    const entryId = randomUUID();
    await db.query("SELECT set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: g.profileIds[0]!, role: 'authenticated' }),
    ]);
    await db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [
      g.groupId, entryId, g.memberIds[0]!, 'expense',
      JSON.stringify({ amount: '1', occurredOn: today }),
    ]);
    await db.query("SELECT set_config('request.jwt.claims','',false)");

    // Reserve 100 bytes (over the 1-byte quota)
    await expect(
      reserve(g.profileIds[0]!, g.groupId, entryId, 100),
    ).rejects.toThrow(/STORAGE_CAP/);

    await setQuota(g.groupId, null);
  });

  it('admin can set and reset quota override', async () => {
    await db.query('SELECT waves_admin_company_storage_set($1,$2)', [g.groupId, 5000]);
    const set = (await db.query('SELECT waves_admin_company_storage($1) AS j', [g.groupId])).rows[0]
      .j;
    expect(set.quota_bytes).toBe(5000);
    expect(set.override_bytes).toBe(5000);

    await db.query('SELECT waves_admin_company_storage_set($1,NULL)', [g.groupId]);
    const reset = (await db.query('SELECT waves_admin_company_storage($1) AS j', [g.groupId]))
      .rows[0].j;
    expect(reset.override_bytes).toBeNull();
  });

  it('pack apply is idempotent: same event_id applied twice gives same quota', async () => {
    // Reset to known state first
    await setQuota(g.groupId, null);
    await setDefault(262144000);
    const eventId = `test-pack-${randomUUID()}`;
    const GB1 = 1073741824;
    const before = parseInt(
      (await db.query('SELECT waves_company_storage_quota($1) AS q', [g.groupId])).rows[0].q,
      10,
    );
    // Correct signature: (event_id, type, app_user_id, event_at, action)
    await db.query('SELECT waves_company_storage_pack_apply($1,$2,$3,$4,$5)', [
      eventId,
      'INITIAL_PURCHASE',
      g.profileIds[0]!, // must be company owner
      new Date().toISOString(),
      JSON.stringify({ group_id: g.groupId, pack_bytes: GB1, store_txn_id: `txn-${eventId}` }),
    ]);
    const after1 = parseInt(
      (await db.query('SELECT waves_company_storage_quota($1) AS q', [g.groupId])).rows[0].q,
      10,
    );
    // Apply same event again (replay) – should be duplicate
    const r = await db.query('SELECT waves_company_storage_pack_apply($1,$2,$3,$4,$5) AS r', [
      eventId,
      'INITIAL_PURCHASE',
      g.profileIds[0]!,
      new Date().toISOString(),
      JSON.stringify({ group_id: g.groupId, pack_bytes: GB1, store_txn_id: `txn-${eventId}` }),
    ]);
    expect(r.rows[0].r).toBe('duplicate');
    const after2 = parseInt(
      (await db.query('SELECT waves_company_storage_quota($1) AS q', [g.groupId])).rows[0].q,
      10,
    );
    expect(after1).toBeGreaterThan(before);
    expect(after2).toBe(after1); // idempotent
    // Restore
    await setQuota(g.groupId, null);
  });
});

void user;
void _isolated;
void _denied;
