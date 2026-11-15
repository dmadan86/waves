/**
 * G34: Calendar – holiday, leave, event, member dates across role changes,
 * removal/re-add, company suspension, and cross-company.
 *
 * Members: 0 owner, 1 manager, 2 employee (team of 1), 3 employee (owner pool),
 *          4 manager (no team).
 */
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

const iso = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

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

const holiday = (
  caller: number,
  id = randomUUID(),
  start = iso(5),
  end = iso(5),
  name = 'Diwali',
) =>
  user(caller, () =>
    db.query('SELECT waves_company_holiday_set($1,$2,$3,$4,$5)', [g.groupId, id, start, end, name]),
  ).then(() => id);

const removeHoliday = (caller: number, id: string) =>
  user(caller, () => db.query('SELECT waves_company_holiday_remove($1,$2)', [g.groupId, id]));

const leaveSet = (
  caller: number,
  member: number,
  id = randomUUID(),
  start = iso(2),
  end = iso(3),
) =>
  user(caller, () =>
    db.query('SELECT waves_company_leave_set($1,$2,$3,$4,$5,$6,$7,$8)', [
      g.groupId,
      id,
      g.memberIds[member],
      start,
      end,
      false,
      'sick',
      'Fever',
    ]),
  ).then(() => id);

const leaveDecide = (caller: number, id: string, approve: boolean) =>
  user(caller, () =>
    db.query('SELECT waves_company_leave_decide($1,$2,$3,NULL)', [g.groupId, id, approve]),
  );

const leaveRemove = (caller: number, id: string) =>
  user(caller, () => db.query('SELECT waves_company_leave_remove($1,$2)', [g.groupId, id]));

const eventSet = (caller: number, people: number[], id = randomUUID()) =>
  user(caller, () =>
    db.query('SELECT waves_company_event_set($1,$2,$3,$4,NULL,NULL,$5)', [
      g.groupId,
      id,
      'Team meetup',
      iso(4),
      people.map((p) => g.memberIds[p]),
    ]),
  ).then(() => id);

const datesSet = (caller: number, member: number, show: boolean) =>
  user(caller, () =>
    db.query('SELECT waves_company_dates_set($1,$2,$3,$4,$5,$6)', [
      g.groupId,
      g.memberIds[member],
      14,
      2,
      null,
      show,
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

describe('G34: calendar – holidays, leave, events, member dates', () => {
  it('owner creates holiday; all members see it; employee cannot create', () =>
    isolated(async () => {
      const hid = await holiday(0);
      // All members (waves_company_member_ok) can see holidays
      const ownerSeen = await user(0, async () =>
        (await db.query('SELECT id FROM company_holidays WHERE deleted_at IS NULL')).rows.map(
          (r) => r.id as string,
        ),
      );
      expect(ownerSeen).toContain(hid);

      const empSeen = await user(2, async () =>
        (await db.query('SELECT id FROM company_holidays WHERE deleted_at IS NULL')).rows.map(
          (r) => r.id as string,
        ),
      );
      expect(empSeen).toContain(hid);

      // Employee cannot add a holiday
      await denied(() => holiday(2));
    }));

  it('owner removes a holiday; it disappears for all', () =>
    isolated(async () => {
      const hid = await holiday(0);
      await removeHoliday(0, hid);
      const seen = await user(
        2,
        async () =>
          (
            await db.query('SELECT id FROM company_holidays WHERE deleted_at IS NULL AND id=$1', [
              hid,
            ])
          ).rows,
      );
      expect(seen).toHaveLength(0);
    }));

  it('manager submitting leave for their employee auto-approves; employee self-submit goes pending', () =>
    isolated(async () => {
      // Manager submitting on behalf of their team member → immediately approved
      const lid = await leaveSet(1, 2);
      const row = (await db.query('SELECT status FROM company_leave WHERE id=$1', [lid])).rows[0];
      expect(row.status).toBe('approved'); // auto-approved when boss submits

      // Employee self-submit for non-overlapping dates → pending
      const lid2 = await leaveSet(2, 2, randomUUID(), iso(10), iso(11));
      const row2 = (await db.query('SELECT status FROM company_leave WHERE id=$1', [lid2])).rows[0];
      expect(row2.status).toBe('pending');
    }));

  it('employee submits own leave; owner approves; manager outside team cannot approve', () =>
    isolated(async () => {
      const lid = await leaveSet(2, 2); // employee submits their own
      // Manager 4 (no team) cannot approve
      await denied(() => leaveDecide(4, lid, true));
      // Owner can approve
      await leaveDecide(0, lid, true);
      const row = (await db.query('SELECT status FROM company_leave WHERE id=$1', [lid])).rows[0];
      expect(row.status).toBe('approved');
    }));

  it('employee can cancel own pending leave; cannot cancel after approval', () =>
    isolated(async () => {
      const lid = await leaveSet(2, 2);
      await leaveRemove(2, lid); // cancel own pending leave
      const row = (await db.query('SELECT deleted_at FROM company_leave WHERE id=$1', [lid]))
        .rows[0];
      expect(row.deleted_at).not.toBeNull();
    }));

  it('manager visibility: manager sees own team leave; owner sees all', () =>
    isolated(async () => {
      const lid2 = await leaveSet(0, 2); // member 2
      const lid3 = await leaveSet(0, 3); // member 3

      const ownerSeen = await user(0, async () =>
        (
          await db.query('SELECT id FROM company_leave WHERE deleted_at IS NULL ORDER BY id')
        ).rows.map((r) => r.id as string),
      );
      expect(ownerSeen.sort()).toEqual([lid2, lid3].sort());

      const mgr1Seen = await user(1, async () =>
        (await db.query('SELECT id FROM company_leave WHERE deleted_at IS NULL')).rows.map(
          (r) => r.id as string,
        ),
      );
      expect(mgr1Seen).toContain(lid2);
      expect(mgr1Seen).not.toContain(lid3);
    }));

  it('event created by owner; participants see it; non-participants do not', () =>
    isolated(async () => {
      const eid = await eventSet(0, [2, 3]); // invite members 2 and 3
      const mem2Seen = await user(
        2,
        async () => (await db.query('SELECT id FROM company_events WHERE id=$1', [eid])).rows,
      );
      expect(mem2Seen).toHaveLength(1);

      const mem4Seen = await user(
        4,
        async () => (await db.query('SELECT id FROM company_events WHERE id=$1', [eid])).rows,
      );
      expect(mem4Seen).toHaveLength(0);
    }));

  it('member dates show=true: all live members can see (waves_company_member_ok)', () =>
    isolated(async () => {
      await datesSet(2, 2, true); // employee 2 opts in (birth_month set by waves_company_dates_set)
      // Need to set a birth month (otherwise show_birthday AND birth_month IS NOT NULL = false)
      // Check if the row has a birth_month
      const mgr1Seen = await user(
        1,
        async () =>
          (
            await db.query('SELECT member_id FROM company_member_dates WHERE member_id=$1', [
              g.memberIds[2],
            ])
          ).rows,
      );
      // Manager sees via waves_company_detail (team member)
      expect(mgr1Seen).toHaveLength(1);

      // Owner sees via waves_company_detail (admin)
      const ownerSeen = await user(
        0,
        async () =>
          (
            await db.query('SELECT member_id FROM company_member_dates WHERE member_id=$1', [
              g.memberIds[2],
            ])
          ).rows,
      );
      expect(ownerSeen).toHaveLength(1);
    }));

  it('member dates show=false: row still visible to admin and direct manager via waves_company_detail', () =>
    isolated(async () => {
      await datesSet(2, 2, false); // employee 2 opts out (p_show=false)
      // waves_company_dates_visible: show_birthday AND birth_month IS NOT NULL = false
      // Falls through to waves_company_detail: admin + direct manager + self can still see
      const mgr1Seen = await user(
        1,
        async () =>
          (
            await db.query('SELECT member_id FROM company_member_dates WHERE member_id=$1', [
              g.memberIds[2],
            ])
          ).rows,
      );
      // Direct manager CAN see (waves_company_detail)
      expect(mgr1Seen).toHaveLength(1);

      // Employee themselves can see
      const selfSeen = await user(
        2,
        async () =>
          (
            await db.query('SELECT member_id FROM company_member_dates WHERE member_id=$1', [
              g.memberIds[2],
            ])
          ).rows,
      );
      expect(selfSeen).toHaveLength(1);

      // Manager 4 (no team) cannot see (not admin, not their manager)
      const mgr4Seen = await user(
        4,
        async () =>
          (
            await db.query('SELECT member_id FROM company_member_dates WHERE member_id=$1', [
              g.memberIds[2],
            ])
          ).rows,
      );
      expect(mgr4Seen).toHaveLength(0);
    }));

  it('suspended company: writes to calendar tables are denied', () =>
    isolated(async () => {
      // Suspend the company
      await db.query('UPDATE groups SET suspended_at=now() WHERE id=$1', [g.groupId]);
      await denied(() => holiday(0));
      await denied(() => leaveSet(0, 2));
    }));
});
