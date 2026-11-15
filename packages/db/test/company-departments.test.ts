import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

// Members: 0 owner, 1 manager, 2 employee (team of 1), 3 employee (owners), 4 manager (no team).
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
const sales = randomUUID();
const setList = (caller: number, list: { id: string; name: string }[]) =>
  user(caller, () =>
    db.query('SELECT waves_company_departments_set($1,$2)', [g.groupId, JSON.stringify(list)]),
  );
const setDept = (caller: number, member: number, id: string | null) =>
  user(caller, () =>
    db.query('SELECT waves_company_department_set($1,$2,$3)', [g.groupId, g.memberIds[member], id]),
  );
const dept = async (member: number) =>
  (await db.query('SELECT department_id FROM group_members WHERE id=$1', [g.memberIds[member]]))
    .rows[0].department_id as string | null;

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
  for (let i = 0; i < 5; i++)
    await db.query(
      'INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)',
      [g.memberIds[i], g.groupId, g.profileIds[i], roles[i], i === 2 ? g.memberIds[1] : null],
    );
});
afterAll(async () => {
  if (db) await db.end();
});

describe('company departments', () => {
  it('only the owner edits the list; a bad list is refused', () =>
    isolated(async () => {
      await setList(0, [{ id: sales, name: 'Sales' }]);
      await denied(() => setList(1, [{ id: sales, name: 'Sales' }]));
      await denied(() => setList(0, [{ id: sales, name: ' ' }]));
      await denied(() =>
        setList(0, [
          { id: sales, name: 'Sales' },
          { id: randomUUID(), name: 'sales' },
        ]),
      );
    }));

  it('owner sets anyone, a manager only their team, an employee no one; unknown id refused', () =>
    isolated(async () => {
      await setList(0, [{ id: sales, name: 'Sales' }]);
      await setDept(0, 3, sales);
      await setDept(1, 2, sales);
      expect(await dept(2)).toBe(sales);
      await denied(() => setDept(1, 3, sales)); // not their team
      await denied(() => setDept(2, 2, null)); // an employee
      await denied(() => setDept(0, 2, randomUUID())); // not in the list
      await db.query('SAVEPOINT direct');
      await user(2, () =>
        db.query('UPDATE group_members SET department_id=NULL WHERE id=$1', [g.memberIds[2]]),
      ).catch(() => db.query('ROLLBACK TO SAVEPOINT direct')); // refused or filtered: either way unchanged
      expect(await dept(2)).toBe(sales);
    }));

  it('removing a department clears whoever was on it', () =>
    isolated(async () => {
      await setList(0, [{ id: sales, name: 'Sales' }]);
      await setDept(0, 2, sales);
      await setList(0, []);
      expect(await dept(2)).toBeNull();
    }));
});
