import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

// Members: 0 owner, 1 manager, 2 employee (team of manager), 3 vendor login, 4 outsider (not in the company).
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
const ravi = randomUUID();
const mine = randomUUID();

async function as<T>(i: number, run: () => Promise<T>, role: 'authenticated' | 'service_role' = 'authenticated'): Promise<T> {
  await db.query('SAVEPOINT actor_scope');
  try {
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify(role === 'service_role' ? { role } : { sub: g.profileIds[i], role }),
    ]);
    await db.query(`SET LOCAL ROLE ${role}`);
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
const admin = <T>(run: () => Promise<T>) => as(0, run, 'service_role');
async function isolated(run: () => Promise<void>) {
  await db.query('BEGIN');
  try {
    await run();
  } finally {
    await db.query('ROLLBACK');
  }
}
async function denied(run: () => Promise<unknown>, match = /COMPANY_BLOCKED/) {
  await db.query('SAVEPOINT expected_failure');
  try {
    expect(await expectDenied(run())).toMatch(match);
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT expected_failure');
  }
}
const block = (reason = 'Complaint from staff') =>
  admin(() => db.query("SELECT waves_admin_company_block($1,'complaint',$2)", [g.groupId, reason]));
const expense = (i: number, member: number) =>
  as(i, () =>
    db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [
      g.groupId, randomUUID(), g.memberIds[member], 'expense', JSON.stringify({ amount: '100', occurredOn: '2026-11-10' }),
    ]),
  );
const vendorSet = (i: number) =>
  as(i, () => db.query('SELECT waves_company_vendor_set($1,$2,$3)', [g.groupId, randomUUID(), JSON.stringify({ name: 'Late Vendor' })]));
const vendorBill = (i: number) =>
  as(i, () =>
    db.query('SELECT waves_company_vendor_entry_create($1,$2,$3,$4,$5)', [
      g.groupId, randomUUID(), ravi, 'bill', JSON.stringify({ amount: '50', occurredOn: '2026-11-10' }),
    ]),
  );

beforeAll(async () => {
  db = await connect();
  g = await seedGroup(db, { memberCount: 5 });
  await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
  g.groupId = randomUUID();
  await db.query("INSERT INTO groups(id,name,type,default_currency,country_code,created_by) VALUES($1,'Acme Works','company','INR','IN',$2)", [g.groupId, g.profileIds[0]]);
  const roles = ['admin', 'manager', 'member', 'vendor'];
  for (let i = 0; i < 4; i++)
    await db.query('INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)', [
      g.memberIds[i], g.groupId, g.profileIds[i], roles[i], i === 2 ? g.memberIds[1] : null,
    ]);
  await db.query('BEGIN');
  await as(0, () => db.query('SELECT waves_company_vendor_set($1,$2,$3)', [g.groupId, ravi, JSON.stringify({ name: 'Ravi Traders' })]));
  await db.query('UPDATE company_vendors SET member_id=$1 WHERE id=$2', [g.memberIds[3], ravi]);
  await as(1, () => db.query('SELECT waves_company_vendor_set($1,$2,$3)', [g.groupId, mine, JSON.stringify({ name: 'A Hardware' })]));
  await db.query('COMMIT');
});
afterAll(async () => {
  if (db) await db.end();
});

describe('blocked company is read-only', () => {
  it('works normally before the block', () =>
    isolated(async () => {
      await expense(0, 2);
      await vendorSet(1);
      await vendorBill(3);
    }));

  it('refuses writes for owner, manager, employee and vendor, and invites and joins', () =>
    isolated(async () => {
      await block();
      await denied(() => expense(0, 2));
      await denied(() => expense(2, 2));
      await denied(() => vendorSet(0));
      await denied(() => vendorSet(1));
      await denied(() => vendorBill(3));
      await denied(() => as(0, () => db.query('SELECT waves_company_vendor_invite($1)', [mine])));
      await denied(() =>
        as(0, () => db.query("INSERT INTO invites(group_id,token_hash,expires_at,created_by) VALUES($1,$2,now()+interval '7 days',$3)", [g.groupId, randomUUID(), g.profileIds[0]])),
      );
      await denied(() => db.query('INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,$4)', [randomUUID(), g.groupId, g.profileIds[4], 'member']));
      await denied(() => as(0, () => db.query("SELECT waves_set_member_role($1,'manager')", [g.memberIds[2]])));
      await denied(() => as(0, () => db.query("UPDATE groups SET name='Renamed' WHERE id=$1", [g.groupId])));
      await denied(() => as(0, () => db.query('UPDATE groups SET suspended_at=NULL WHERE id=$1', [g.groupId])), /NOT_ALLOWED/);
    }));

  it('a suspended company invite link no longer admits anyone', () =>
    isolated(async () => {
      await as(0, () => db.query('SELECT waves_company_vendor_invite($1)', [mine]));
      const inv = (await db.query('SELECT id FROM invites WHERE company_vendor_id=$1', [mine])).rows[0].id;
      await block();
      expect((await db.query('SELECT waves_consume_invite($1) AS ok', [inv])).rows[0].ok).toBeNull();
    }));

  it('reads, the group row and leaving still work; unblock restores everything', () =>
    isolated(async () => {
      await as(0, () => db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [g.groupId, randomUUID(), g.memberIds[2], 'expense', JSON.stringify({ amount: '100', occurredOn: '2026-11-10' })]));
      await block();
      expect(await as(2, async () => (await db.query('SELECT id FROM company_entries')).rows.length)).toBe(1);
      expect(await as(3, async () => (await db.query('SELECT id FROM company_vendors')).rows.length)).toBe(1);
      expect(await as(2, async () => (await db.query('SELECT suspended_at FROM groups WHERE id=$1', [g.groupId])).rows[0].suspended_at)).not.toBeNull();
      await as(2, () => db.query('UPDATE group_members SET left_at=now() WHERE id=$1', [g.memberIds[2]]));
      await db.query('UPDATE group_members SET left_at=NULL WHERE id=$1', [g.memberIds[2]]);
      await admin(() => db.query("SELECT waves_admin_company_unblock($1,'Resolved')", [g.groupId]));
      await expense(0, 2);
      await vendorSet(1);
      await vendorBill(3);
    }));

  it('blocking and unblocking notify the owner and are logged', () =>
    isolated(async () => {
      await block('Staff complaint');
      await admin(() => db.query("SELECT waves_admin_company_unblock($1,'Resolved')", [g.groupId]));
      const kinds = (await db.query("SELECT kind FROM notifications WHERE profile_id=$1 AND group_id=$2 ORDER BY created_at", [g.profileIds[0], g.groupId])).rows.map((r) => r.kind);
      expect(kinds).toEqual(['company_suspended', 'company_restored']);
      const log = (await db.query('SELECT action,reason FROM company_moderation_log WHERE group_id=$1 ORDER BY id', [g.groupId])).rows;
      expect(log.map((r) => r.action)).toEqual(['block', 'unblock']);
      expect(log[0].reason).toBe('Staff complaint');
    }));

  it('block needs a reason', () =>
    isolated(async () => {
      await denied(() => block('  '), /INVALID_DATA/);
    }));
});

describe('reports and the log', () => {
  const report = (i: number, text = 'They have not paid wages') =>
    as(i, async () => (await db.query("SELECT waves_company_report($1,'wages',$2) AS r", [g.groupId, text])).rows[0].r);

  it('any member or vendor can report, even when blocked; outsiders cannot', () =>
    isolated(async () => {
      await db.query("DELETE FROM rate_limit_hits WHERE bucket='company-report'");
      expect((await report(2)).ok).toBe(true);
      expect((await report(3)).ok).toBe(true);
      await block();
      expect((await report(1)).ok).toBe(true);
      await denied(() => report(4), /NOT_A_MEMBER/);
      await denied(() => report(2, '   '), /INVALID_DATA/);
    }));

  it('is rate limited per person', () =>
    isolated(async () => {
      await db.query("DELETE FROM rate_limit_hits WHERE bucket='company-report'");
      for (let i = 0; i < 5; i++) expect((await report(2)).ok).toBe(true);
      expect(await report(2)).toMatchObject({ ok: false, reason: 'RATE_LIMITED' });
      expect((await report(3)).ok).toBe(true);
    }));

  it('non-admins cannot read complaints, the log or the admin functions', () =>
    isolated(async () => {
      await db.query("DELETE FROM rate_limit_hits WHERE bucket='company-report'");
      await report(2);
      await block();
      for (const i of [0, 1, 2, 3, 4]) {
        await denied(() => as(i, () => db.query('SELECT * FROM company_complaints')), /permission denied/);
        await denied(() => as(i, () => db.query('SELECT * FROM company_moderation_log')), /permission denied/);
        await denied(() => as(i, () => db.query('SELECT waves_admin_companies()')), /permission denied/);
        await denied(() => as(i, () => db.query('SELECT waves_admin_company_block($1,$2,$3)', [g.groupId, 'other', 'x'])), /permission denied/);
      }
    }));

  it('the log is append-only, even for the service role', () =>
    isolated(async () => {
      await block();
      await denied(() => admin(() => db.query('UPDATE company_moderation_log SET reason=$1', ['x'])), /LOG_APPEND_ONLY/);
      await denied(() => admin(() => db.query('DELETE FROM company_moderation_log')), /LOG_APPEND_ONLY|permission denied/);
      await denied(() => db.query('TRUNCATE company_moderation_log'), /LOG_APPEND_ONLY/);
    }));
});

describe('admin monitoring vs content', () => {
  it('lists metadata and aggregates but no content; records need a logged reason; export includes entries only after', () =>
    isolated(async () => {
      await db.query("DELETE FROM rate_limit_hits WHERE bucket='company-report'");
      await expense(2, 2);
      await as(2, () => db.query("SELECT waves_company_report($1,'fraud','x')", [g.groupId]));
      const list = await admin(async () => (await db.query("SELECT waves_admin_companies('acme','complaints') AS r")).rows[0].r);
      expect(list.total).toBe(1);
      expect(list.rows[0]).toMatchObject({ name: 'Acme Works', owners: 1, managers: 1, employees: 1, vendors: 2, entries_30d: 1, open_complaints: 1 });
      const detail = await admin(async () => (await db.query('SELECT waves_admin_company_detail($1) AS r', [g.groupId])).rows[0].r);
      expect(JSON.stringify(detail)).not.toContain('Late');
      expect(detail.members).toHaveLength(4);
      expect(detail.complaints[0].reporter_profile_id).toBeUndefined();
      await denied(() => admin(() => db.query('SELECT waves_admin_company_records($1)', [g.groupId])), /REASON_REQUIRED/);
      await denied(() => admin(() => db.query("SELECT waves_admin_company_open_records($1,'no')", [g.groupId])), /INVALID_DATA/);
      const before = await admin(async () => (await db.query('SELECT waves_admin_company_export($1) AS r', [g.groupId])).rows[0].r);
      expect(before.records_included).toBe(false);
      expect(before.entries).toBeUndefined();
      await admin(() => db.query("SELECT waves_admin_company_open_records($1,'Police request FIR 12')", [g.groupId]));
      const recs = await admin(async () => (await db.query('SELECT waves_admin_company_records($1) AS r', [g.groupId])).rows[0].r);
      expect(recs.entries).toHaveLength(1);
      const after = await admin(async () => (await db.query('SELECT waves_admin_company_export($1) AS r', [g.groupId])).rows[0].r);
      expect(after.records_included).toBe(true);
      expect(after.entries).toHaveLength(1);
      const actions = (await db.query('SELECT action FROM company_moderation_log WHERE group_id=$1 ORDER BY id', [g.groupId])).rows.map((r) => r.action);
      expect(actions).toEqual(['export', 'records_opened', 'export']);
    }));
});
