import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

// Members: 0 owner, 1 manager A, 2 manager B, 3 employee (team of A), 4 employee (team of B).
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
const day = new Date().toISOString().slice(0, 10);

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
/** One task per person, as the app sends them: same title, day and photos, one mutation each. */
const task = (caller: number, assignee: number, id = randomUUID()) =>
  user(caller, async () => {
    await db.query(
      "SELECT waves_company_work_set($1,$2,$3,$4,'Fix the gate',NULL,'todo',NULL,NULL,NULL)",
      [g.groupId, id, g.memberIds[assignee], day],
    );
    return id;
  });
beforeAll(async () => {
  db = await connect();
  g = await seedGroup(db, { memberCount: 5 });
  await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
  g.groupId = randomUUID();
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
    [g.groupId, g.profileIds[0]],
  );
  const roles = ['admin', 'manager', 'manager', 'member', 'member'];
  const managers = [null, null, null, g.memberIds[1], g.memberIds[2]];
  for (let i = 0; i < 5; i++)
    await db.query(
      'INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)',
      [g.memberIds[i], g.groupId, g.profileIds[i], roles[i], managers[i]],
    );
});
afterAll(async () => {
  if (db) await db.end();
});

const path = (taskId: string) => `${taskId}/${randomUUID()}/${randomUUID()}.jpg`;
// The byte door runs as the service role on behalf of the caller's profile.
const reserve = (caller: number, key: string) =>
  db.query("SELECT waves_storage_reserve($1,$2,'company-entry-images',$3,100,'image/jpeg')", [
    g.profileIds[caller],
    g.groupId,
    key,
  ]);
const commit = (caller: number, key: string) =>
  db.query("SELECT waves_storage_record($1,$2,'company-entry-images',$3,100,'image/jpeg')", [
    g.profileIds[caller],
    g.groupId,
    key,
  ]);
/** Upload and attach one photo as `caller`; returns the attachment id. */
async function photo(caller: number, taskId: string) {
  const key = path(taskId);
  const id = key.split('/')[1]!;
  await reserve(caller, key);
  await commit(caller, key);
  await user(caller, () =>
    db.query('SELECT waves_attach_company_task_image($1,$2,$3)', [taskId, key, id]),
  );
  return id;
}
const photosSeenBy = (caller: number) =>
  user(caller, async () =>
    (
      await db.query('SELECT id FROM company_work_task_attachments WHERE deleted_at IS NULL')
    ).rows.map((r) => r.id as string),
  );
const remove = (caller: number, id: string) =>
  user(caller, () => db.query('SELECT waves_remove_company_task_image($1)', [id]));

describe('task photos', () => {
  it('are visible only to who sees the task: owner, the assignee manager, the assignee', () =>
    isolated(async () => {
      const a = await task(1, 3);
      const b = await task(2, 4);
      const pa = await photo(1, a);
      const pb = await photo(0, b);
      expect((await photosSeenBy(0)).sort()).toEqual([pa, pb].sort());
      expect(await photosSeenBy(1)).toEqual([pa]);
      expect(await photosSeenBy(2)).toEqual([pb]);
      expect(await photosSeenBy(3)).toEqual([pa]); // the assignee sees the photo on their task
      expect(await photosSeenBy(4)).toEqual([pb]);
    }));

  it('cannot be attached, uploaded or removed by anyone else, the assignee included', () =>
    isolated(async () => {
      const a = await task(1, 3);
      const id = await photo(1, a);
      for (const outsider of [2, 3, 4]) {
        const key = path(a);
        await denied(() => reserve(outsider, key));
        await denied(() => remove(outsider, id));
        await denied(() =>
          db.query('SELECT waves_attach_company_task_image($1,$2,$3)', [a, key, randomUUID()]),
        );
      }
      expect(await photosSeenBy(0)).toEqual([id]);
    }));

  it('are removed with the task, and nobody can write the table directly', () =>
    isolated(async () => {
      const a = await task(1, 3);
      await photo(1, a);
      await denied(() =>
        user(0, () =>
          db.query(
            'INSERT INTO company_work_task_attachments(id,entry_id,group_id,uploader_member_id,storage_path) VALUES($1,$2,$3,$4,$5)',
            [randomUUID(), a, g.groupId, g.memberIds[0], path(a)],
          ),
        ),
      );
      await user(1, () => db.query('SELECT waves_company_work_remove($1,$2)', [g.groupId, a]));
      expect(await photosSeenBy(0)).toEqual([]);
      const left = await db.query(
        "SELECT 1 FROM storage_objects WHERE logical_bucket='company-entry-images' AND split_part(path,'/',1)=$1",
        [a],
      );
      expect(left.rowCount).toBe(0);
    }));

  it('follow a task handed to another team, and a suspended company cannot add them', () =>
    isolated(async () => {
      const a = await task(0, 3);
      const id = await photo(0, a);
      await user(0, () =>
        db.query(
          "SELECT waves_company_work_set($1,$2,$3,$4,'Fix the gate',NULL,'todo',NULL,NULL,NULL)",
          [g.groupId, a, g.memberIds[4], day],
        ),
      );
      expect(await photosSeenBy(1)).toEqual([]);
      expect(await photosSeenBy(2)).toEqual([id]);
      await db.query('UPDATE groups SET suspended_at=now() WHERE id=$1', [g.groupId]);
      await denied(() => photo(0, a));
    }));

  it('a task cannot reuse a company entry id', () =>
    isolated(async () => {
      const entry = randomUUID();
      await db.query(
        "INSERT INTO company_entries(id,group_id,member_id,created_by,updated_by,entry_kind,amount,currency,occurred_on,status) VALUES($1,$2,$3,$3,$3,'expense',100,'INR','2026-11-10','approved')",
        [entry, g.groupId, g.memberIds[3]],
      );
      await denied(() => task(0, 3, entry));
    }));
});

describe('one task per person (multi-assign)', () => {
  it('creates a task for each person the caller manages and refuses the rest', () =>
    isolated(async () => {
      const ids = [await task(0, 3), await task(0, 4)]; // the owner assigns anyone
      const rows = await db.query(
        'SELECT member_id FROM company_work_tasks WHERE id = ANY($1) ORDER BY member_id',
        [ids],
      );
      expect(rows.rows.map((r) => r.member_id).sort()).toEqual(
        [g.memberIds[3], g.memberIds[4]].sort(),
      );
      await task(1, 3); // manager A: own team
      await denied(() => task(1, 4)); // manager A cannot assign to B's team
      await denied(() => task(3, 3)); // an employee cannot assign
    }));

  it('rejects a day beyond a week', () =>
    isolated(async () => {
      await denied(() =>
        user(0, () =>
          db.query(
            "SELECT waves_company_work_set($1,$2,$3,current_date+8,'x',NULL,'todo',NULL,NULL,NULL)",
            [g.groupId, randomUUID(), g.memberIds[3]],
          ),
        ),
      );
    }));
});
