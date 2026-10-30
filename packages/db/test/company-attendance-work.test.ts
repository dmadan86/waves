import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

// Members: 0 owner, 1 manager, 2 employee (team of 1), 3 employee (owners), 4 manager (no team).
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
const site = randomUUID();
const today = new Date().toISOString().slice(0, 10);

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
const mark = (caller: number, member: number, status: string | null, day = today) =>
  user(caller, () =>
    db.query('SELECT waves_company_attendance_set($1,$2,$3,$4,NULL)', [
      g.groupId,
      g.memberIds[member],
      day,
      status,
    ]),
  );
const seenAttendance = (caller: number) =>
  user(caller, async () =>
    (await db.query('SELECT member_id FROM company_attendance WHERE deleted_at IS NULL')).rows.map(
      (r) => r.member_id as string,
    ),
  );
const setTask = (
  caller: number,
  member: number,
  id: string,
  status = 'todo',
  extra: { title?: string; reason?: string | null } = {},
) =>
  user(caller, () =>
    db.query('SELECT waves_company_work_set($1,$2,$3,$4,$5,NULL,$6,$7,NULL)', [
      g.groupId,
      id,
      g.memberIds[member],
      today,
      extra.title ?? 'Fix the gate',
      status,
      extra.reason ?? null,
    ]),
  );
const seenTasks = (caller: number) =>
  user(caller, async () =>
    (
      await db.query('SELECT id FROM company_work_tasks WHERE deleted_at IS NULL ORDER BY id')
    ).rows.map((r) => r.id as string),
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
  for (let i = 0; i < 5; i++)
    await db.query(
      'INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)',
      [g.memberIds[i], g.groupId, g.profileIds[i], roles[i], i === 2 ? g.memberIds[1] : null],
    );
});
afterAll(async () => {
  if (db) await db.end();
});

describe('company attendance: who marks and who sees', () => {
  it('owner and the person’s manager mark; others are refused; the unique day updates in place', () =>
    isolated(async () => {
      await mark(0, 3, 'present');
      await mark(1, 2, 'half');
      await mark(1, 2, 'absent');
      await denied(() => mark(1, 3, 'present')); // not their team
      await denied(() => mark(4, 2, 'present')); // a manager with no team
      await denied(() => mark(2, 2, 'present')); // an employee never marks, not even self
      await denied(() => mark(0, 2, 'late'));
      const rows = await db.query('SELECT status FROM company_attendance WHERE member_id=$1', [
        g.memberIds[2],
      ]);
      expect(rows.rows).toEqual([{ status: 'absent' }]);
    }));

  it('owner reads all, manager their team, employee only their own', () =>
    isolated(async () => {
      await mark(0, 2, 'present');
      await mark(0, 3, 'half');
      expect((await seenAttendance(0)).sort()).toEqual([g.memberIds[2], g.memberIds[3]].sort());
      expect(await seenAttendance(1)).toEqual([g.memberIds[2]]);
      expect(await seenAttendance(2)).toEqual([g.memberIds[2]]);
      expect(await seenAttendance(3)).toEqual([g.memberIds[3]]);
      expect(await seenAttendance(4)).toEqual([]);
    }));

  it('clearing a mark hides it; direct writes are not granted', () =>
    isolated(async () => {
      await mark(0, 2, 'present');
      await mark(0, 2, null);
      expect(await seenAttendance(0)).toEqual([]);
      await denied(() =>
        user(0, () =>
          db.query(
            'INSERT INTO company_attendance(group_id,member_id,day,status,marked_by) VALUES($1,$2,$3,$4,$5)',
            [g.groupId, g.memberIds[3], today, 'present', g.memberIds[0]],
          ),
        ),
      );
    }));

  it('a new manager receives the history (re-stamp on reassignment)', () =>
    isolated(async () => {
      await mark(0, 2, 'present');
      const before = await db.query('SELECT updated_seq FROM company_attendance');
      await db.query('UPDATE group_members SET manager_id=$1 WHERE id=$2', [
        g.memberIds[4],
        g.memberIds[2],
      ]);
      const after = await db.query('SELECT updated_seq FROM company_attendance');
      expect(BigInt(after.rows[0].updated_seq)).toBeGreaterThan(BigInt(before.rows[0].updated_seq));
      expect(await seenAttendance(1)).toEqual([]);
      expect(await seenAttendance(4)).toEqual([g.memberIds[2]]);
    }));
});

describe('company daily work: who adds, who moves it, who sees', () => {
  it('owner and manager add; an employee cannot add', () =>
    isolated(async () => {
      const a = randomUUID();
      await setTask(0, 3, randomUUID());
      await setTask(1, 2, a);
      await denied(() => setTask(1, 3, randomUUID())); // not their team
      await denied(() => setTask(2, 2, randomUUID())); // an employee cannot add
      await denied(() => setTask(0, 2, randomUUID(), 'blocked')); // blocked needs a reason
      await denied(() => setTask(0, 2, randomUUID(), 'todo', { title: '   ' }));
    }));

  it('the employee moves only the status/reason/note of their own task', () =>
    isolated(async () => {
      const a = randomUUID();
      const b = randomUUID();
      await setTask(1, 2, a);
      await setTask(0, 3, b);
      await setTask(2, 2, a, 'doing', { title: 'Hijacked' }); // the title is the manager's: ignored
      await setTask(2, 2, a, 'blocked', { reason: 'No cement' });
      const row = (
        await db.query('SELECT title,status,blocked_reason FROM company_work_tasks WHERE id=$1', [
          a,
        ])
      ).rows[0];
      expect(row).toEqual({
        title: 'Fix the gate',
        status: 'blocked',
        blocked_reason: 'No cement',
      });
      await denied(() => setTask(2, 3, b, 'done')); // someone else's task
      await denied(() => setTask(3, 3, a, 'done')); // not theirs
      await denied(() => setTask(4, 2, a, 'done')); // a manager outside the team
    }));

  it('owner reads all tasks, manager their team’s, employee only their own', () =>
    isolated(async () => {
      const a = randomUUID();
      const b = randomUUID();
      await setTask(0, 2, a);
      await setTask(0, 3, b);
      expect(await seenTasks(0)).toEqual([a, b].sort());
      expect(await seenTasks(1)).toEqual([a]);
      expect(await seenTasks(2)).toEqual([a]);
      expect(await seenTasks(3)).toEqual([b]);
      expect(await seenTasks(4)).toEqual([]);
    }));

  it('only owner or the manager removes a task', () =>
    isolated(async () => {
      const a = randomUUID();
      await setTask(0, 2, a);
      await denied(() =>
        user(2, () => db.query('SELECT waves_company_work_remove($1,$2)', [g.groupId, a])),
      );
      await user(1, () => db.query('SELECT waves_company_work_remove($1,$2)', [g.groupId, a]));
      expect(await seenTasks(0)).toEqual([]);
    }));
});
