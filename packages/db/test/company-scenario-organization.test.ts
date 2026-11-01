/**
 * G30–G31: Departments, projects/sites, member transfers, budget, visibility.
 *
 * Members: 0 owner, 1 manager, 2 employee (team of 1), 3 employee (owner pool),
 *          4 manager (no team).
 */
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;

async function user<T>(i: number, run: () => Promise<T>): Promise<T> {
  await db.query('SAVEPOINT actor_scope');
  try {
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: g.profileIds[i], role: 'authenticated' }),
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

async function isolated(run: () => Promise<void>) {
  await db.query('BEGIN');
  try {
    await run();
  } finally {
    await db.query('ROLLBACK');
  }
}

async function denied(run: () => Promise<unknown>) {
  await db.query('SAVEPOINT expected_failure');
  try {
    await expectDenied(run());
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT expected_failure');
  }
}

const depId1 = randomUUID();
const depId2 = randomUUID();

const setDepts = (caller: number, depts: { id: string; name: string }[]) =>
  user(caller, () =>
    db.query('SELECT waves_company_departments_set($1,$2)', [
      g.groupId,
      JSON.stringify(depts),
    ]),
  );

const setDept = (caller: number, member: number, deptId: string | null) =>
  user(caller, () =>
    db.query('SELECT waves_company_department_set($1,$2,$3)', [
      g.groupId,
      g.memberIds[member],
      deptId,
    ]),
  );

beforeAll(async () => {
  db = await connect();

  g = await seedGroup(db, { memberCount: 5 });
  await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
  g.groupId = randomUUID();
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
    [g.groupId, g.profileIds[0]],
  );
  const roles = ['admin', 'manager', 'member', 'member', 'manager'];
  for (let i = 0; i < 5; i++) {
    await db.query(
      'INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)',
      [g.memberIds[i], g.groupId, g.profileIds[i], roles[i], i === 2 ? g.memberIds[1] : null],
    );
  }
});

afterAll(async () => {
  if (db) await db.end();
});

// ---------------------------------------------------------------------------
// G30: Departments – create, remove, reassign, stale references
// ---------------------------------------------------------------------------
describe('G30: departments – CRUD, reassignment, stale reference cleanup', () => {
  it('owner sets departments list; member gets a department; non-owner cannot set list', () =>
    isolated(async () => {
      await setDepts(0, [
        { id: depId1, name: 'Engineering' },
        { id: depId2, name: 'Finance' },
      ]);
      const row = (
        await db.query('SELECT company_departments FROM groups WHERE id=$1', [g.groupId])
      ).rows[0];
      const depts = row.company_departments as { id: string; name: string }[];
      expect(depts.map((d) => d.id).sort()).toEqual([depId1, depId2].sort());

      // Assign member 2 to Engineering
      await setDept(0, 2, depId1);
      const mem = (
        await db.query('SELECT department_id FROM group_members WHERE id=$1', [g.memberIds[2]])
      ).rows[0];
      expect(mem.department_id).toBe(depId1);

      // Manager 1 can set department for their team member
      await setDept(1, 2, depId2);
      const memAfter = (
        await db.query('SELECT department_id FROM group_members WHERE id=$1', [g.memberIds[2]])
      ).rows[0];
      expect(memAfter.department_id).toBe(depId2);

      // Manager 4 (no team) cannot set department for member 2
      await denied(() => setDept(4, 2, depId1));

      // Employee cannot set their own department
      await denied(() => setDept(2, 2, depId1));
    }));

  it('removing a department from the list clears it from members (trigger)', () =>
    isolated(async () => {
      await setDepts(0, [{ id: depId1, name: 'Engineering' }]);
      await setDept(0, 2, depId1);
      const before = (
        await db.query('SELECT department_id FROM group_members WHERE id=$1', [g.memberIds[2]])
      ).rows[0];
      expect(before.department_id).toBe(depId1);

      // Remove depId1 from the list
      await setDepts(0, [{ id: depId2, name: 'Finance' }]);
      const after = (
        await db.query('SELECT department_id FROM group_members WHERE id=$1', [g.memberIds[2]])
      ).rows[0];
      // stale reference should be cleared
      expect(after.department_id).toBeNull();
    }));

  it('invalid department ID in member assignment is rejected', () =>
    isolated(async () => {
      const badDept = randomUUID();
      await denied(() => setDept(0, 2, badDept));
    }));

  it('invalid departments structure is rejected', () =>
    isolated(async () => {
      await denied(() =>
        user(0, () =>
          db.query('SELECT waves_company_departments_set($1,$2)', [
            g.groupId,
            JSON.stringify([{ id: 'not-a-uuid', name: '' }]), // invalid
          ]),
        ),
      );
    }));
});

// ---------------------------------------------------------------------------
// G31: Manager-owner visibility for projects (uses company_projects table)
// ---------------------------------------------------------------------------
describe('G31: project visibility by role', () => {
  it('owner can see all projects; employee can only see projects where they are a project member', () =>
    isolated(async () => {
      const projId = randomUUID();
      await db.query(
        "INSERT INTO company_projects(id,group_id,name) VALUES($1,$2,'Site Alpha')",
        [projId, g.groupId],
      );

      // Owner (admin) can see it via waves_company_project_visible (admin short-circuit)
      const ownerSeen = await user(0, async () =>
        (await db.query('SELECT id FROM company_projects WHERE id=$1', [projId])).rows,
      );
      expect(ownerSeen).toHaveLength(1);

      // Employee cannot see it yet (not in company_project_members)
      const empNoSeen = await user(2, async () =>
        (await db.query('SELECT id FROM company_projects WHERE id=$1', [projId])).rows,
      );
      expect(empNoSeen).toHaveLength(0);

      // Add employee 2 to project members
      await db.query(
        'INSERT INTO company_project_members(group_id,project_id,member_id) VALUES($1,$2,$3)',
        [g.groupId, projId, g.memberIds[2]],
      );

      // Now employee 2 can see it
      const empSeen = await user(2, async () =>
        (await db.query('SELECT id FROM company_projects WHERE id=$1', [projId])).rows,
      );
      expect(empSeen).toHaveLength(1);
    }));

  it('project budget is only visible to the admin (owner)', () =>
    isolated(async () => {
      const projId = randomUUID();
      await db.query(
        "INSERT INTO company_projects(id,group_id,name) VALUES($1,$2,'Budget Project')",
        [projId, g.groupId],
      );
      await db.query(
        'INSERT INTO company_project_budgets(project_id,group_id,budget_minor) VALUES($1,$2,$3)',
        [projId, g.groupId, 100000],
      );

      // Owner (admin) can see budget
      const ownerSeen = await user(0, async () =>
        (await db.query('SELECT project_id FROM company_project_budgets WHERE project_id=$1', [projId])).rows,
      );
      expect(ownerSeen).toHaveLength(1);

      // Employee cannot see budget (policy: waves_company_detail AND is_group_admin)
      const empSeen = await user(2, async () =>
        (await db.query('SELECT project_id FROM company_project_budgets WHERE project_id=$1', [projId])).rows,
      );
      expect(empSeen).toHaveLength(0);
    }));
});
