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
const setType = (caller: number, member: number, type: string | null) =>
  user(caller, () =>
    db.query('SELECT waves_company_employment_type_set($1,$2,$3)', [
      g.groupId,
      g.memberIds[member],
      type,
    ]),
  );
const typeOf = async (member: number) =>
  (await db.query('SELECT employment_type FROM group_members WHERE id=$1', [g.memberIds[member]]))
    .rows[0].employment_type as string | null;

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

describe('company employment type', () => {
  it('owner sets anyone, a manager only their team, an employee no one; bad value refused', () =>
    isolated(async () => {
      await setType(0, 3, 'contractor');
      expect(await typeOf(3)).toBe('contractor');
      await setType(1, 2, 'part_time');
      expect(await typeOf(2)).toBe('part_time');
      await setType(1, 2, null);
      expect(await typeOf(2)).toBeNull();
      await denied(() => setType(1, 3, 'full_time')); // not their team
      await denied(() => setType(4, 2, 'full_time')); // a manager without that employee
      await denied(() => setType(2, 2, 'full_time')); // an employee
      await denied(() => setType(0, 2, 'intern')); // not in the list
    }));

  it('direct writes by a signed-in user are refused or change nothing', () =>
    isolated(async () => {
      await db.query('SAVEPOINT direct');
      await user(0, () =>
        db.query("UPDATE group_members SET employment_type='full_time' WHERE id=$1", [
          g.memberIds[2],
        ]),
      ).catch(() => db.query('ROLLBACK TO SAVEPOINT direct'));
      expect(await typeOf(2)).toBeNull();
    }));

  it('a blocked company cannot change it', () =>
    isolated(async () => {
      await db.query('UPDATE groups SET suspended_at=now() WHERE id=$1', [g.groupId]);
      await denied(() => setType(0, 2, 'full_time'));
    }));
});
