import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connect, seedGroup } from './helpers';
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
async function as<T>(i: number, run: () => Promise<T>): Promise<T> {
  await db.query('SAVEPOINT actor');
  try {
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: g.profileIds[i], role: 'authenticated' }),
    ]);
    await db.query('SET LOCAL ROLE authenticated');
    return await run();
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT actor');
    throw e;
  } finally {
    await db.query('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claims','',true)");
    await db.query('RELEASE SAVEPOINT actor');
  }
}
async function scenario(fn: () => Promise<void>) {
  await db.query('BEGIN');
  try {
    await fn();
  } finally {
    await db.query('ROLLBACK');
  }
}
async function setup() {
  g = await seedGroup(db, { memberCount: 5 });
  await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
  g.groupId = randomUUID();
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
    [g.groupId, g.profileIds[0]],
  );
  for (let i = 0; i < 5; i++)
    await db.query(
      'INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)',
      [
        g.memberIds[i],
        g.groupId,
        g.profileIds[i],
        ['admin', 'manager', 'member', 'member', 'member'][i],
        i === 2 ? g.memberIds[1] : null,
      ],
    );
}
beforeAll(async () => {
  db = await connect();
});
beforeEach(setup);
afterAll(async () => {
  if (db) await db.end();
});
describe('membership lifecycle compositions', () => {
  it('adds an employee, records expense task and attendance, removes and re-adds while preserving history', () =>
    scenario(async () => {
      const sourceGroup = randomUUID(),
        source = randomUUID();
      await db.query('DELETE FROM group_members WHERE id=$1', [g.memberIds[4]]);
      await db.query(
        "INSERT INTO groups(id,type,default_currency,created_by) VALUES($1,'company','INR',$2)",
        [sourceGroup, g.profileIds[0]],
      );
      await db.query(
        "INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,$4),($5,$2,$6,'member')",
        [randomUUID(), sourceGroup, g.profileIds[0], 'admin', source, g.profileIds[4]],
      );
      await as(0, () =>
        db.query('SELECT waves_company_add_past_people($1,$2::uuid[])', [g.groupId, [source]]),
      );
      const row = (
        await db.query(
          'SELECT id FROM group_members WHERE group_id=$1 AND profile_id=(SELECT profile_id FROM group_members WHERE id=$2)',
          [g.groupId, source],
        )
      ).rows[0];
      expect(row).toBeDefined();
      const member = row.id;
      const e = randomUUID();
      await as(0, () =>
        db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [
          g.groupId,
          e,
          member,
          'expense',
          '{"amount":"140","occurredOn":"2026-10-01"}',
        ]),
      );
      const t = randomUUID();
      await as(0, () =>
        db.query(
          "SELECT waves_company_work_set($1,$2,$3,'2026-10-01','Inventory',NULL,'todo',NULL,NULL)",
          [g.groupId, t, member],
        ),
      );
      await as(0, () =>
        db.query("SELECT waves_company_attendance_set($1,$2,'2026-10-01','present',NULL)", [
          g.groupId,
          member,
        ]),
      );
      await as(0, () => db.query('SELECT waves_remove_member($1)', [member]));
      expect(
        (await as(0, () => db.query('SELECT id FROM company_entries WHERE id=$1', [e]))).rows,
      ).toHaveLength(1);
      // Ended employment is intentionally blocked from invite-based joining;
      // restore this historical member through the employment RPC instead.
      await as(0, () =>
        db.query('SELECT waves_company_employment_set($1,$2,true)', [g.groupId, member]),
      );
      expect(
        (await db.query('SELECT count(*)::int n FROM company_entries WHERE member_id=$1', [member]))
          .rows[0].n,
      ).toBe(1);
      expect(
        (
          await db.query('SELECT count(*)::int n FROM company_work_tasks WHERE member_id=$1', [
            member,
          ])
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await db.query('SELECT count(*)::int n FROM company_attendance WHERE member_id=$1', [
            member,
          ])
        ).rows[0].n,
      ).toBe(1);
    }));
  it('role promotion to manager grants manager operations and demotion removes them', () =>
    scenario(async () => {
      await as(0, () => db.query("SELECT waves_set_member_role($1,'manager')", [g.memberIds[2]]));
      expect(
        (await db.query('SELECT role::text r FROM group_members WHERE id=$1', [g.memberIds[2]]))
          .rows[0].r,
      ).toBe('manager');
      await as(2, () =>
        db.query('SELECT waves_company_vendor_set($1,$2,$3)', [
          g.groupId,
          randomUUID(),
          '{"name":"New supplier"}',
        ]),
      );
      await as(0, () => db.query("SELECT waves_set_member_role($1,'member')", [g.memberIds[2]]));
      let denied = false;
      try {
        await as(2, () =>
          db.query('SELECT waves_company_vendor_set($1,$2,$3)', [g.groupId, randomUUID(), '{}']),
        );
      } catch {
        denied = true;
      }
      expect(denied).toBe(true);
    }));
  it('employee to owner promotion gives owner visibility and demotion restores employee boundary', () =>
    scenario(async () => {
      await as(0, () => db.query("SELECT waves_set_member_role($1,'admin')", [g.memberIds[2]]));
      expect(
        (await db.query('SELECT role::text FROM group_members WHERE id=$1', [g.memberIds[2]]))
          .rows[0].role,
      ).toBe('admin');
      await as(2, () =>
        db.query('SELECT waves_company_employee_id_set($1,$2,$3)', [
          g.groupId,
          g.memberIds[3],
          'E-3',
        ]),
      );
      await as(0, () => db.query("SELECT waves_set_member_role($1,'member')", [g.memberIds[2]]));
      let denied = false;
      try {
        await as(2, () =>
          db.query('SELECT waves_company_employee_id_set($1,$2,$3)', [
            g.groupId,
            g.memberIds[3],
            'E-4',
          ]),
        );
      } catch {
        denied = true;
      }
      expect(denied).toBe(true);
    }));
  it('manager promoted to owner can act across teams and loses that authority on demotion', () =>
    scenario(async () => {
      await db.query('UPDATE group_members SET manager_id=NULL WHERE id=$1', [g.memberIds[2]]);
      await as(0, () => db.query("SELECT waves_set_member_role($1,'admin')", [g.memberIds[1]]));
      await as(1, () =>
        db.query('SELECT waves_company_employee_id_set($1,$2,$3)', [
          g.groupId,
          g.memberIds[3],
          'X-4',
        ]),
      );
      await as(0, () => db.query("SELECT waves_set_member_role($1,'manager')", [g.memberIds[1]]));
      let denied = false;
      try {
        await as(1, () =>
          db.query('SELECT waves_company_employee_id_set($1,$2,$3)', [
            g.groupId,
            g.memberIds[3],
            'X-5',
          ]),
        );
      } catch {
        denied = true;
      }
      expect(denied).toBe(true);
    }));
  it('cannot demote the sole owner', () =>
    scenario(async () => {
      let failed = false;
      try {
        await as(0, () => db.query("SELECT waves_set_member_role($1,'member')", [g.memberIds[0]]));
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
      expect(
        (await db.query('SELECT role::text r FROM group_members WHERE id=$1', [g.memberIds[0]]))
          .rows[0].r,
      ).toBe('admin');
    }));
  it('cannot remove the sole owner through employment changes', () =>
    scenario(async () => {
      let failed = false;
      try {
        await as(0, () =>
          db.query('SELECT waves_company_employment_set($1,$2,false,NULL,NULL)', [
            g.groupId,
            g.memberIds[0],
          ]),
        );
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
      expect(
        (await db.query('SELECT left_at FROM group_members WHERE id=$1', [g.memberIds[0]])).rows[0]
          .left_at,
      ).toBeNull();
    }));
  it('employee id uniqueness is case insensitive within a company and reusable in another', () =>
    scenario(async () => {
      await as(0, () =>
        db.query('SELECT waves_company_employee_id_set($1,$2,$3)', [
          g.groupId,
          g.memberIds[2],
          'Staff-7',
        ]),
      );
      let failed = false;
      try {
        await as(0, () =>
          db.query('SELECT waves_company_employee_id_set($1,$2,$3)', [
            g.groupId,
            g.memberIds[3],
            'staff-7',
          ]),
        );
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
      const other = await setupOtherCompany();
      await as(0, () =>
        db.query('SELECT waves_company_employee_id_set($1,$2,$3)', [
          other.groupId,
          other.memberIds[0],
          'staff-7',
        ]),
      );
      expect(
        (await db.query('SELECT employee_id FROM group_members WHERE id=$1', [other.memberIds[0]]))
          .rows[0].employee_id,
      ).toBe('staff-7');
    }));
  it('removed employee cannot write and an old identity does not become active from stale membership state', () =>
    scenario(async () => {
      await as(0, () =>
        db.query('SELECT waves_company_employment_set($1,$2,false,NULL,NULL)', [
          g.groupId,
          g.memberIds[2],
        ]),
      );
      let failed = false;
      try {
        await as(2, () =>
          db.query("SELECT waves_company_attendance_set($1,$2,'2026-10-01','present',NULL)", [
            g.groupId,
            g.memberIds[2],
          ]),
        );
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
      expect(
        (await db.query('SELECT left_at FROM group_members WHERE id=$1', [g.memberIds[2]])).rows[0]
          .left_at,
      ).not.toBeNull();
    }));
  it('employee and manager membership boundaries stay company scoped', () =>
    scenario(async () => {
      const foreign = randomUUID();
      let denied = false;
      try {
        await as(0, () =>
          db.query('SELECT waves_company_employment_set($1,$2,false,NULL,NULL)', [
            g.groupId,
            foreign,
          ]),
        );
      } catch {
        denied = true;
      }
      expect(denied).toBe(true);
      expect(
        (await db.query('SELECT count(*)::int n FROM group_members WHERE group_id=$1', [g.groupId]))
          .rows[0].n,
      ).toBe(5);
    }));
});
async function setupOtherCompany() {
  const h = await seedGroup(db, { memberCount: 1 });
  await db.query('DELETE FROM groups WHERE id=$1', [h.groupId]);
  h.groupId = randomUUID();
  const member = randomUUID();
  await db.query(
    "INSERT INTO groups(id,type,default_currency,created_by) VALUES($1,'company','INR',$2)",
    [h.groupId, g.profileIds[0]],
  );
  await db.query(
    "INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,'admin'),($4,$2,$5,'member')",
    [randomUUID(), h.groupId, g.profileIds[0], member, g.profileIds[3]],
  );
  h.memberIds = [member];
  return h;
}
