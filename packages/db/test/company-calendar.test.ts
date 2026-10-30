import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

// Members: 0 owner, 1 manager, 2 employee (team of 1), 3 employee (no manager), 4 manager (no team).
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
const iso = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

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
const q = (i: number, sql: string, args: unknown[] = []) => user(i, () => db.query(sql, args));
const ids = async (i: number, table: string) =>
  (await q(i, `SELECT id FROM ${table} WHERE deleted_at IS NULL ORDER BY id`)).rows.map(
    (r) => r.id as string,
  );
const leave = (caller: number, member: number, id = randomUUID(), start = iso(2), end = iso(3)) =>
  q(caller, 'SELECT waves_company_leave_set($1,$2,$3,$4,$5,false,$6,$7)', [
    g.groupId,
    id,
    g.memberIds[member],
    start,
    end,
    'sick',
    'Fever',
  ]).then(() => id);
const decide = (caller: number, id: string, approve = true) =>
  q(caller, 'SELECT waves_company_leave_decide($1,$2,$3,NULL)', [g.groupId, id, approve]);
const holiday = (caller: number, id = randomUUID()) =>
  q(caller, 'SELECT waves_company_holiday_set($1,$2,$3,$3,$4)', [
    g.groupId,
    id,
    iso(5),
    'Diwali',
  ]).then(() => id);
const event = (caller: number, people: number[], id = randomUUID()) =>
  q(caller, 'SELECT waves_company_event_set($1,$2,$3,$4,NULL,NULL,$5)', [
    g.groupId,
    id,
    'Site visit',
    iso(4),
    people.map((p) => g.memberIds[p]),
  ]).then(() => id);
const dates = (caller: number, member: number, show: boolean, day = 14, month = 2) =>
  q(caller, 'SELECT waves_company_dates_set($1,$2,$3,$4,$5,$6)', [
    g.groupId,
    g.memberIds[member],
    day,
    month,
    '2024-01-01',
    show,
  ]);

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

describe('holidays', () => {
  it('only the owner writes; every live member reads', () =>
    isolated(async () => {
      await denied(() => holiday(1));
      await denied(() => holiday(2));
      const id = await holiday(0);
      for (const i of [0, 1, 2, 3, 4]) expect(await ids(i, 'company_holidays')).toEqual([id]);
      await q(0, 'SELECT waves_company_holiday_remove($1,$2)', [g.groupId, id]);
      expect(await ids(2, 'company_holidays')).toEqual([]);
    }));
  it('a former member reads nothing', () =>
    isolated(async () => {
      await holiday(0);
      await db.query(
        'UPDATE group_members SET left_at=now(),removed_at=now(),employment_ended_on=current_date,manager_id=NULL WHERE id=$1',
        [g.memberIds[3]],
      ); // not employed: the employment RPC sets all three
      expect(await ids(3, 'company_holidays')).toEqual([]);
    }));
});

describe('leave', () => {
  it('the employee requests (pending); only their own manager or the owner decides', () =>
    isolated(async () => {
      const id = await leave(2, 2);
      expect((await q(2, 'SELECT status FROM company_leave')).rows).toEqual([
        { status: 'pending' },
      ]);
      await denied(() => decide(2, id)); // never self
      await denied(() => decide(4, id)); // another manager
      await denied(() => decide(3, id)); // another employee
      await decide(1, id);
      expect((await q(0, 'SELECT status,decided_by FROM company_leave')).rows).toEqual([
        { status: 'approved', decided_by: g.memberIds[1] },
      ]);
      await decide(1, id); // a retry is harmless
      await denied(() => decide(1, id, false)); // already decided
    }));
  it('the owner can approve anyone; a manager cannot approve their own leave', () =>
    isolated(async () => {
      const a = await leave(3, 3);
      await decide(0, a, false);
      const b = await leave(1, 1);
      await denied(() => decide(1, b));
      await decide(0, b);
    }));
  it('reads: owner all, manager their team plus own, employee own only', () =>
    isolated(async () => {
      const a = await leave(2, 2);
      const b = await leave(3, 3);
      const c = await leave(1, 1);
      expect(await ids(0, 'company_leave')).toEqual([a, b, c].sort());
      expect(await ids(1, 'company_leave')).toEqual([a, c].sort());
      expect(await ids(2, 'company_leave')).toEqual([a]);
      expect(await ids(3, 'company_leave')).toEqual([b]);
      expect(await ids(4, 'company_leave')).toEqual([]);
    }));
  it('owner or the person’s manager records leave directly (approved); others cannot', () =>
    isolated(async () => {
      await leave(1, 2);
      await leave(0, 3);
      expect((await q(0, 'SELECT DISTINCT status FROM company_leave')).rows).toEqual([
        { status: 'approved' },
      ]);
      await denied(() => leave(1, 3)); // not their team
      await denied(() => leave(2, 3)); // an employee for someone else
    }));
  it('rejects overlap, bad ranges and departed people', () =>
    isolated(async () => {
      await leave(2, 2);
      await denied(() => leave(2, 2, randomUUID(), iso(3), iso(4)));
      await denied(() => leave(2, 2, randomUUID(), iso(9), iso(8)));
      await denied(() =>
        q(2, 'SELECT waves_company_leave_set($1,$2,$3,$4,$5,true,$6,NULL)', [
          g.groupId,
          randomUUID(),
          g.memberIds[2],
          iso(20),
          iso(21),
          'casual',
        ]),
      );
      await db.query('UPDATE group_members SET left_at=now(),manager_id=NULL WHERE id=$1', [
        g.memberIds[2],
      ]);
      await denied(() => leave(0, 2, randomUUID(), iso(30), iso(31)));
      await denied(() => leave(2, 2, randomUUID(), iso(30), iso(31)));
    }));
  it('the requester can withdraw only while pending', () =>
    isolated(async () => {
      const a = await leave(2, 2);
      await q(2, 'SELECT waves_company_leave_remove($1,$2)', [g.groupId, a]);
      const b = await leave(2, 2);
      await decide(0, b);
      await denied(() => q(2, 'SELECT waves_company_leave_remove($1,$2)', [g.groupId, b]));
    }));
});

describe('ghost employees and leaving a suspended company', () => {
  it('the owner can record leave for an employee without an account', () =>
    isolated(async () => {
      const ghost = randomUUID();
      await db.query(
        "INSERT INTO group_members(id,group_id,ghost_name,role,joined_via) VALUES($1,$2,'Ravi','member','ghost')",
        [ghost, g.groupId],
      );
      await q(0, 'SELECT waves_company_leave_set($1,$2,$3,$4,$4,false,$5,NULL)', [
        g.groupId,
        randomUUID(),
        ghost,
        iso(2),
        'casual',
      ]);
      expect((await q(0, 'SELECT status FROM company_leave')).rows).toEqual([
        { status: 'approved' },
      ]);
    }));
  it('an employee with a manager can still leave while the company is suspended', () =>
    isolated(async () => {
      await leave(2, 2);
      await db.query('UPDATE groups SET suspended_at=now() WHERE id=$1', [g.groupId]);
      await db.query('UPDATE group_members SET left_at=now(),manager_id=NULL WHERE id=$1', [
        g.memberIds[2],
      ]);
      expect(
        (await db.query('SELECT left_at FROM group_members WHERE id=$1', [g.memberIds[2]])).rows[0]
          .left_at,
      ).not.toBeNull();
    }));
});

describe('events', () => {
  it('employees see company-wide events and those they are in; managers their team’s', () =>
    isolated(async () => {
      const all = await event(0, []);
      const withEmp = await event(0, [2]);
      const other = await event(0, [3]);
      expect(await ids(0, 'company_events')).toEqual([all, withEmp, other].sort());
      expect(await ids(2, 'company_events')).toEqual([all, withEmp].sort());
      expect(await ids(3, 'company_events')).toEqual([all, other].sort());
      expect(await ids(1, 'company_events')).toEqual([all, withEmp].sort()); // employee 2 is on their team
      expect(await ids(4, 'company_events')).toEqual([all]);
    }));
  it('employees never write; a manager is limited to their team and must name someone', () =>
    isolated(async () => {
      await denied(() => event(2, [2]));
      await denied(() => event(1, [])); // company-wide is the owner’s
      await denied(() => event(1, [3])); // not their team
      const id = await event(1, [2]);
      await denied(() => q(4, 'SELECT waves_company_event_remove($1,$2)', [g.groupId, id]));
      await q(1, 'SELECT waves_company_event_remove($1,$2)', [g.groupId, id]);
    }));
});

describe('birthdays and joining dates', () => {
  it('a birthday is private until the person opts in; the owner and manager always see', () =>
    isolated(async () => {
      await dates(0, 2, true); // owner sets: the choice is not theirs to make, stays off
      expect((await q(2, 'SELECT show_birthday FROM company_member_dates')).rows).toEqual([
        { show_birthday: false },
      ]);
      expect(await ids(3, 'company_member_dates')).toEqual([]);
      expect(await ids(4, 'company_member_dates')).toEqual([]);
      expect((await ids(1, 'company_member_dates')).length).toBe(1);
      expect((await ids(0, 'company_member_dates')).length).toBe(1);
      await dates(2, 2, true); // the person opts in
      expect((await ids(3, 'company_member_dates')).length).toBe(1);
      expect((await ids(4, 'company_member_dates')).length).toBe(1);
      await dates(0, 2, false); // owner edits the date: the opt-in stays
      expect((await q(2, 'SELECT show_birthday FROM company_member_dates')).rows).toEqual([
        { show_birthday: true },
      ]);
      await dates(2, 2, false);
      expect(await ids(3, 'company_member_dates')).toEqual([]);
    }));
  it('only self, owner or the person’s manager set it; the year is never stored; bad dates fail', () =>
    isolated(async () => {
      await denied(() => dates(3, 2, false));
      await denied(() => dates(4, 2, false));
      await dates(1, 2, false);
      await denied(() => dates(0, 2, false, 30, 2));
      await dates(0, 2, false, 29, 2);
      const cols = (
        await db.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name='company_member_dates'",
        )
      ).rows.map((r) => r.column_name);
      expect(cols).not.toContain('birth_year');
    }));
  it('a former member’s birthday vanishes for colleagues', () =>
    isolated(async () => {
      await dates(3, 3, true);
      expect((await ids(2, 'company_member_dates')).length).toBe(1);
      await db.query('UPDATE group_members SET left_at=now() WHERE id=$1', [g.memberIds[3]]);
      expect(await ids(2, 'company_member_dates')).toEqual([]);
      await denied(() => dates(0, 3, false));
    }));
});

describe('blocked company and direct writes', () => {
  it('a suspended company is read-only for every calendar write', () =>
    isolated(async () => {
      const h = await holiday(0);
      const l = await leave(2, 2);
      const e = await event(0, []);
      await db.query('UPDATE groups SET suspended_at=now() WHERE id=$1', [g.groupId]);
      await denied(() => holiday(0));
      await denied(() => q(0, 'SELECT waves_company_holiday_remove($1,$2)', [g.groupId, h]));
      await denied(() => leave(3, 3));
      await denied(() => decide(0, l));
      await denied(() => q(2, 'SELECT waves_company_leave_remove($1,$2)', [g.groupId, l]));
      await denied(() => event(0, []));
      await denied(() => q(0, 'SELECT waves_company_event_remove($1,$2)', [g.groupId, e]));
      await denied(() => dates(2, 2, true));
      await denied(() =>
        q(0, 'SELECT waves_company_calendar_settings_set($1,true,true)', [g.groupId]),
      );
      expect((await ids(2, 'company_holidays')).length).toBe(1); // reads keep working
    }));
  it('tables grant SELECT only and every one carries the block guard', () =>
    isolated(async () => {
      await denied(() =>
        q(
          0,
          "INSERT INTO company_holidays(group_id,start_day,end_day,name,created_by) VALUES($1,$2,$2,'x',$3)",
          [g.groupId, iso(1), g.memberIds[0]],
        ),
      );
      const t = await db.query(
        "SELECT c.relname FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid WHERE tg.tgname='aa_company_block_guard' AND c.relname IN ('company_holidays','company_leave','company_events','company_member_dates')",
      );
      expect(t.rows).toHaveLength(4);
    }));
});

describe('settings', () => {
  it('only the owner changes paid holidays / paid leave; defaults are on / off', () =>
    isolated(async () => {
      const d = await db.query(
        'SELECT company_paid_holidays h,company_paid_leave l FROM groups WHERE id=$1',
        [g.groupId],
      );
      expect(d.rows).toEqual([{ h: true, l: false }]);
      await denied(() =>
        q(1, 'SELECT waves_company_calendar_settings_set($1,false,false)', [g.groupId]),
      );
      await q(0, 'SELECT waves_company_calendar_settings_set($1,false,true)', [g.groupId]);
      const n = await db.query(
        'SELECT company_paid_holidays h,company_paid_leave l FROM groups WHERE id=$1',
        [g.groupId],
      );
      expect(n.rows).toEqual([{ h: false, l: true }]);
    }));
});
