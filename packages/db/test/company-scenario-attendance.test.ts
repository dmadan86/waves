/**
 * G29: Attendance across timezone/day boundary, duplicate mark/upsert, clear,
 * reassignment, former member, manager-owner, and cross-company IDs.
 *
 * Members: 0 owner, 1 manager, 2 employee (team of 1), 3 employee (owner pool),
 *          4 manager (no team).
 */
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
let other: Awaited<ReturnType<typeof seedGroup>>;

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
    (
      await db.query(
        'SELECT member_id,status FROM company_attendance WHERE deleted_at IS NULL ORDER BY member_id',
      )
    ).rows as { member_id: string; status: string }[],
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

  // Cross-company group
  other = await seedGroup(db, { memberCount: 2 });
  await db.query('DELETE FROM groups WHERE id=$1', [other.groupId]);
  other.groupId = randomUUID();
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
    [other.groupId, other.profileIds[0]],
  );
  for (let i = 0; i < 2; i++) {
    await db.query(
      "INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,$4)",
      [other.memberIds[i], other.groupId, other.profileIds[i], i === 0 ? 'admin' : 'member'],
    );
  }
});

afterAll(async () => {
  if (db) await db.end();
});

describe('G29: attendance – upsert, clear, visibility, cross-company', () => {
  it('one row per member/day: re-marking same day updates status in place', () =>
    isolated(async () => {
      await mark(0, 2, 'present');
      await mark(0, 2, 'absent'); // upsert
      const rows = await db.query(
        'SELECT status FROM company_attendance WHERE member_id=$1 AND day=$2',
        [g.memberIds[2], today],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].status).toBe('absent');
    }));

  it('clearing (null) hides the row from visibility', () =>
    isolated(async () => {
      await mark(0, 2, 'present');
      await mark(0, 2, null); // clear
      const seen = await seenAttendance(0);
      expect(seen.some((r) => r.member_id === g.memberIds[2])).toBe(false);
    }));

  it('marking on a different day creates a separate row', () =>
    isolated(async () => {
      await mark(0, 2, 'present', today);
      await mark(0, 2, 'half', yesterday);
      const rows = await db.query(
        'SELECT day,status FROM company_attendance WHERE member_id=$1 ORDER BY day',
        [g.memberIds[2]],
      );
      expect(rows.rows).toHaveLength(2);
    }));

  it('owner reads all, manager their team, employee only their own', () =>
    isolated(async () => {
      await mark(0, 2, 'present');
      await mark(0, 3, 'half');

      const ownerSeen = await seenAttendance(0);
      expect(ownerSeen.map((r) => r.member_id).sort()).toEqual(
        [g.memberIds[2], g.memberIds[3]].sort(),
      );

      const mgr1Seen = await seenAttendance(1);
      expect(mgr1Seen.map((r) => r.member_id)).toEqual([g.memberIds[2]]);

      const emp2Seen = await seenAttendance(2);
      expect(emp2Seen.map((r) => r.member_id)).toEqual([g.memberIds[2]]);

      const emp3Seen = await seenAttendance(3);
      expect(emp3Seen.map((r) => r.member_id)).toEqual([g.memberIds[3]]);

      const mgr4Seen = await seenAttendance(4); // no team
      expect(mgr4Seen).toEqual([]);
    }));

  it("manager without the team cannot mark another team's employee", () =>
    isolated(async () => {
      await denied(() => mark(4, 2, 'present')); // mgr4 has no team
    }));

  it('employee cannot mark even their own attendance', () =>
    isolated(async () => {
      await denied(() => mark(2, 2, 'present'));
    }));

  it('direct INSERT is denied', () =>
    isolated(async () => {
      await denied(() =>
        user(0, () =>
          db.query(
            'INSERT INTO company_attendance(group_id,member_id,day,status,marked_by) VALUES($1,$2,$3,$4,$5)',
            [g.groupId, g.memberIds[3], today, 'present', g.memberIds[0]],
          ),
        ),
      );
    }));

  it('former employee loses attendance visibility', () =>
    isolated(async () => {
      await mark(0, 2, 'present');
      await db.query('UPDATE group_members SET left_at=now() WHERE id=$1', [g.memberIds[2]]);
      const seen = await user(2, async () =>
        (
          await db.query(
            'SELECT member_id FROM company_attendance WHERE deleted_at IS NULL',
          )
        ).rows.map((r) => r.member_id as string),
      );
      expect(seen).toEqual([]);
    }));

  it('cross-company: other-company member cannot read attendance', () =>
    isolated(async () => {
      await mark(0, 2, 'present');
      await db.query('SAVEPOINT xcompany');
      try {
        await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ sub: other.profileIds[0], role: 'authenticated' }),
        ]);
        await db.query('SET LOCAL ROLE authenticated');
        const seen = (await db.query('SELECT member_id FROM company_attendance')).rows;
        expect(seen.every((r) => r.member_id !== g.memberIds[2])).toBe(true);
      } finally {
        await db.query('RESET ROLE');
        await db.query("SELECT set_config('request.jwt.claims','',true)");
        await db.query('ROLLBACK TO SAVEPOINT xcompany');
      }
    }));

  it('cross-company: using other company member_id in attendance set is denied', () =>
    isolated(async () => {
      await db.query('SAVEPOINT xcompany_write');
      try {
        await expectDenied(
          user(0, () =>
            db.query('SELECT waves_company_attendance_set($1,$2,$3,$4,NULL)', [
              g.groupId,
              other.memberIds[0], // foreign member
              today,
              'present',
            ]),
          ),
        );
      } finally {
        await db.query('ROLLBACK TO SAVEPOINT xcompany_write');
      }
    }));

  it('manager reassignment restamps attendance so the new manager sees it', () =>
    isolated(async () => {
      await mark(0, 2, 'present');
      const seqBefore = (
        await db.query('SELECT updated_seq FROM company_attendance WHERE member_id=$1', [
          g.memberIds[2],
        ])
      ).rows[0].updated_seq as string;
      // Reassign member 2 to manager 4
      await db.query('UPDATE group_members SET manager_id=$1 WHERE id=$2', [
        g.memberIds[4],
        g.memberIds[2],
      ]);
      const seqAfter = (
        await db.query('SELECT updated_seq FROM company_attendance WHERE member_id=$1', [
          g.memberIds[2],
        ])
      ).rows[0].updated_seq as string;
      expect(BigInt(seqAfter)).toBeGreaterThan(BigInt(seqBefore));

      // Manager 1 no longer sees it
      const mgr1Seen = await seenAttendance(1);
      expect(mgr1Seen.map((r) => r.member_id)).not.toContain(g.memberIds[2]);

      // Manager 4 now sees it
      const mgr4Seen = await seenAttendance(4);
      expect(mgr4Seen.map((r) => r.member_id)).toContain(g.memberIds[2]);
    }));
});
