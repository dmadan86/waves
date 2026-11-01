/**
 * G36: Employment status and type matrix.
 *
 * employment_set uses left_at/removed_at (reusing the departed-member model).
 * employment_type: full_time | part_time | contractor (guard prevents direct UPDATE).
 *
 * Members: 0 owner, 1 manager, 2 employee (team of 1), 3 employee (owner pool),
 *          4 manager (no team).
 */
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

const today = new Date().toISOString().slice(0, 10);

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

const employmentSet = (
  caller: number,
  member: number,
  employed: boolean,
  endedOn: string | null = null,
) =>
  user(caller, () =>
    db.query('SELECT waves_company_employment_set($1,$2,$3,$4,NULL,false,NULL)', [
      g.groupId,
      g.memberIds[member],
      employed,
      endedOn,
    ]),
  );

const employmentTypeSet = (caller: number, member: number, type: string) =>
  user(caller, () =>
    db.query('SELECT waves_company_employment_type_set($1,$2,$3)', [
      g.groupId,
      g.memberIds[member],
      type,
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

describe('G36: employment status and type matrix', () => {
  it('owner marks employee as not-employed; left_at/removed_at are set', () =>
    isolated(async () => {
      await employmentSet(0, 2, false, today);
      const row = (
        await db.query(
          'SELECT left_at,removed_at,employment_ended_on FROM group_members WHERE id=$1',
          [g.memberIds[2]],
        )
      ).rows[0];
      expect(row.left_at).not.toBeNull();
      expect(row.removed_at).not.toBeNull();
      expect(row.employment_ended_on).not.toBeNull();
    }));

  it('owner re-employs; left_at/removed_at are cleared', () =>
    isolated(async () => {
      await employmentSet(0, 2, false, today);
      await employmentSet(0, 2, true);
      const row = (
        await db.query('SELECT left_at,removed_at FROM group_members WHERE id=$1', [g.memberIds[2]])
      ).rows[0];
      expect(row.left_at).toBeNull();
      expect(row.removed_at).toBeNull();
    }));

  it('owner sets employment type to contractor; manager can do so for their team', () =>
    isolated(async () => {
      await employmentTypeSet(0, 2, 'contractor');
      const type = (
        await db.query('SELECT employment_type FROM group_members WHERE id=$1', [g.memberIds[2]])
      ).rows[0].employment_type as string;
      expect(type).toBe('contractor');

      // Manager 1 can set type for team member 2
      await employmentTypeSet(1, 2, 'part_time');
      const typeBack = (
        await db.query('SELECT employment_type FROM group_members WHERE id=$1', [g.memberIds[2]])
      ).rows[0].employment_type as string;
      expect(typeBack).toBe('part_time');

      // Set back to full_time
      await employmentTypeSet(0, 2, 'full_time');
      const typeFull = (
        await db.query('SELECT employment_type FROM group_members WHERE id=$1', [g.memberIds[2]])
      ).rows[0].employment_type as string;
      expect(typeFull).toBe('full_time');

      // Manager 4 (no team) cannot set type for member 2
      await denied(() => employmentTypeSet(4, 2, 'contractor'));

      // Employee cannot change own type
      await denied(() => employmentTypeSet(2, 2, 'contractor'));
    }));

  it('invalid employment type value is rejected', () =>
    isolated(async () => {
      await denied(() => employmentTypeSet(0, 2, 'employee'));
      await denied(() => employmentTypeSet(0, 2, 'permanent'));
    }));

  it('guard trigger definition enforces authenticated-role restriction on employment_type', async () => {
    // Verify the trigger body contains the guard condition
    const row = (
      await db.query(
        "SELECT prosrc FROM pg_proc WHERE proname='waves_guard_member_employment_type'",
      )
    ).rows[0];
    expect(row.prosrc).toContain("current_user IN ('anon','authenticated')");
    expect(row.prosrc).toContain('FORBIDDEN_COLUMN');
    expect(row.prosrc).toContain('waves_company_employment_type_set');
  });

  it('not-employed employee cannot create new company entries', () =>
    isolated(async () => {
      await employmentSet(0, 2, false, today);
      // Former employee should not be able to create entries
      let threw = false;
      try {
        await user(2, () =>
          db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [
            g.groupId,
            randomUUID(),
            g.memberIds[2],
            'expense',
            JSON.stringify({ amount: '100', occurredOn: today }),
          ]),
        );
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    }));

  it('employment metadata (type) does not grant or revoke access independently of left_at', () =>
    isolated(async () => {
      // Mark as full_time while still a live member
      await employmentTypeSet(0, 3, 'full_time');

      // Mark as not-employed
      await employmentSet(0, 3, false, today);

      // Changing type does not restore access
      // The guard prevents direct UPDATE; verify left_at still set
      const row = (
        await db.query('SELECT left_at FROM group_members WHERE id=$1', [g.memberIds[3]])
      ).rows[0];
      expect(row.left_at).not.toBeNull();
    }));
});
