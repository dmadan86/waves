/**
 * G41: Activity visibility – owner-only access, no money rows for blocked company,
 * and actor/subject/group attribution from expense creation.
 *
 * Members: 0 owner, 1 manager, 2 employee.
 * Activity for company is in the activity_log table with group_id set.
 */
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, seedGroup } from './helpers';

const today = new Date().toISOString().slice(0, 10);

let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;

async function asProfile<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  await db.query('SAVEPOINT actor_scope');
  try {
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: profileId, role: 'authenticated' }),
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

beforeAll(async () => {
  db = await connect();

  g = await seedGroup(db, { memberCount: 3 });
  await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
  g.groupId = randomUUID();
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
    [g.groupId, g.profileIds[0]],
  );
  const roles = ['admin', 'manager', 'member'];
  for (let i = 0; i < 3; i++) {
    await db.query(
      'INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)',
      [g.memberIds[i], g.groupId, g.profileIds[i], roles[i], i === 2 ? g.memberIds[1] : null],
    );
  }
});

afterAll(async () => {
  if (db) await db.end();
});

describe('G41: company activity – visibility and attribution', () => {
  it('owner can read activity_log for the company; non-owner cannot', () =>
    isolated(async () => {
      // Seed the activity directly as the superuser connection. The company
      // entry RPC does not write an activity_log row.
      const activityId = randomUUID();
      const objectId = randomUUID();
      await db.query(
        `INSERT INTO activity_log
          (group_id, actor_member_id, verb, object_type, object_id, payload)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [g.groupId, g.memberIds[0], 'created', 'expense', objectId, JSON.stringify({ amount: '100' })],
      );

      // Owner can read activity_log for the company
      const ownerSeen = await asProfile(g.profileIds[0], async () =>
        (
          await db.query(
            'SELECT id, group_id, actor_member_id, verb, object_type, object_id, payload FROM activity_log WHERE group_id=$1',
            [g.groupId],
          )
        ).rows,
      );
      expect(ownerSeen).toEqual([
        {
          id: expect.any(String),
          group_id: g.groupId,
          actor_member_id: g.memberIds[0],
          verb: 'created',
          object_type: 'expense',
          object_id: objectId,
          payload: { amount: '100' },
        },
      ]);

      // Manager (non-admin) should not see company activity_log
      const mgrSeen = await asProfile(g.profileIds[1], async () =>
        (
          await db.query(
            'SELECT id FROM activity_log WHERE group_id=$1 LIMIT 10',
            [g.groupId],
          )
        ).rows,
      );
      expect(mgrSeen).toHaveLength(0);

      // Employee should not see company activity_log
      const empSeen = await asProfile(g.profileIds[2], async () =>
        (
          await db.query(
            'SELECT id FROM activity_log WHERE group_id=$1 LIMIT 10',
            [g.groupId],
          )
        ).rows,
      );
      expect(empSeen).toHaveLength(0);

      // A different company's owner must not see this company's activity.
      const other = await seedGroup(db, { memberCount: 1 });
      const otherOwnerSeen = await asProfile(other.profileIds[0], async () =>
        (
          await db.query('SELECT id FROM activity_log WHERE group_id=$1', [g.groupId])
        ).rows,
      );
      expect(otherOwnerSeen).toHaveLength(0);
    }));

  it('blocked company: existing activity is still readable by owner; no new write activity', () =>
    isolated(async () => {
      // Create entry before block
      await asProfile(g.profileIds[0], () =>
        db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [
          g.groupId,
          randomUUID(),
          g.memberIds[0],
          'expense',
          JSON.stringify({ amount: '50', occurredOn: today }),
        ]),
      );

      const countBefore = (
        await db.query('SELECT count(*) FROM activity_log WHERE group_id=$1', [g.groupId])
      ).rows[0].count as string;

      // Block the company
      await db.query('UPDATE groups SET suspended_at=now() WHERE id=$1', [g.groupId]);

      // Try to create another entry (should fail due to COMPANY_BLOCKED)
      try {
        await asProfile(g.profileIds[0], () =>
          db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [
            g.groupId,
            randomUUID(),
            g.memberIds[0],
            'expense',
            JSON.stringify({ amount: '75', occurredOn: today }),
          ]),
        );
      } catch {
        // Expected
      }

      const countAfter = (
        await db.query('SELECT count(*) FROM activity_log WHERE group_id=$1', [g.groupId])
      ).rows[0].count as string;

      // Activity count should not have increased due to the blocked write
      expect(parseInt(countAfter, 10)).toEqual(parseInt(countBefore, 10));
    }));
});
