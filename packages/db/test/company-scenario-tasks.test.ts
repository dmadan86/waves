/**
 * G24–G28: Tasks – full lifecycle, seq_no monotonicity, removed-employee access,
 * cross-company isolation, due-time compat.
 *
 * Members: 0 owner (admin), 1 manager, 2 employee (team of 1),
 *          3 employee (no manager), 4 manager (no team).
 * Company B: isolated cross-company.
 */
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

const today = new Date().toISOString().slice(0, 10);

let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
let b: Awaited<ReturnType<typeof seedGroup>>;

async function user<T>(i: number, run: () => Promise<T>): Promise<T> {
  await db.query('SAVEPOINT actor_scope');
  try {
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: g.profileIds[i]!, role: 'authenticated' }),
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

async function asId<T>(profileId: string, run: () => Promise<T>): Promise<T> {
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

async function denied(run: () => Promise<unknown>) {
  await db.query('SAVEPOINT expected_failure');
  try {
    await expectDenied(run());
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT expected_failure');
  }
}

const setTask = (
  caller: number,
  member: number,
  id: string,
  status = 'todo',
  extra: { title?: string; reason?: string | null; day?: string; dueTime?: string | null } = {},
) =>
  user(caller, () =>
    db.query('SELECT waves_company_work_set($1,$2,$3,$4,$5,NULL,$6,$7,NULL,$8)', [
      g.groupId,
      id,
      g.memberIds[member]!,
      extra.day ?? today,
      extra.title ?? 'Fix the gate',
      status,
      extra.reason ?? null,
      extra.dueTime ?? null,
    ]),
  );

const removeTask = (caller: number, id: string) =>
  user(caller, () => db.query('SELECT waves_company_work_remove($1,$2)', [g.groupId, id]));

const seenTaskIds = async (caller: number) =>
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
    [g.groupId, g.profileIds[0]!],
  );
  const roles = ['admin', 'manager', 'member', 'member', 'manager'];
  for (let i = 0; i < 5; i++) {
    await db.query(
      'INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)',
      [g.memberIds[i]!, g.groupId, g.profileIds[i]!, roles[i], i === 2 ? g.memberIds[1]! : null],
    );
  }

  b = await seedGroup(db, { memberCount: 2 });
  await db.query('DELETE FROM groups WHERE id=$1', [b.groupId]);
  b.groupId = randomUUID();
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
    [b.groupId, b.profileIds[0]!],
  );
  for (let i = 0; i < 2; i++) {
    await db.query('INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,$4)', [
      b.memberIds[i]!,
      b.groupId,
      b.profileIds[i]!,
      i === 0 ? 'admin' : 'member',
    ]);
  }
});

afterAll(async () => {
  if (db) await db.end();
});

// ---------------------------------------------------------------------------
// G24: Full task lifecycle
// ---------------------------------------------------------------------------
describe('G24: task lifecycle – create, status transitions, remove', () => {
  it('owner creates a task in todo state', () =>
    isolated(async () => {
      const id = randomUUID();
      await setTask(0, 3, id, 'todo');
      const row = (await db.query('SELECT status FROM company_work_tasks WHERE id=$1', [id]))
        .rows[0];
      expect(row.status).toBe('todo');
    }));

  it('blocked requires a reason; blank reason is rejected', () =>
    isolated(async () => {
      await denied(() => setTask(0, 3, randomUUID(), 'blocked'));
      await denied(() => setTask(0, 3, randomUUID(), 'blocked', { reason: '   ' }));
    }));

  it('invalid status values are rejected', () =>
    isolated(async () => {
      await denied(() => setTask(0, 3, randomUUID(), 'approved' as string));
    }));

  it('status cycle: todo → doing → blocked → done, blocked_reason clears on done', () =>
    isolated(async () => {
      const id = randomUUID();
      await setTask(0, 2, id, 'todo');
      await setTask(0, 2, id, 'doing');
      await setTask(0, 2, id, 'blocked', { reason: 'Waiting for cement' });
      await setTask(0, 2, id, 'done');
      const row = (
        await db.query('SELECT status,blocked_reason FROM company_work_tasks WHERE id=$1', [id])
      ).rows[0];
      expect(row.status).toBe('done');
      expect(row.blocked_reason).toBeNull();
    }));

  it('employee can move only status on own task; title stays unchanged', () =>
    isolated(async () => {
      const id = randomUUID();
      await setTask(1, 2, id, 'todo');
      await setTask(2, 2, id, 'doing', { title: 'Hijacked title' });
      const row = (await db.query('SELECT title,status FROM company_work_tasks WHERE id=$1', [id]))
        .rows[0];
      expect(row.title).toBe('Fix the gate');
      expect(row.status).toBe('doing');
    }));

  it('owner and team manager can remove a task; employee cannot', () =>
    isolated(async () => {
      const id = randomUUID();
      await setTask(0, 2, id, 'todo');
      await denied(() =>
        user(2, () => db.query('SELECT waves_company_work_remove($1,$2)', [g.groupId, id])),
      );
      await removeTask(1, id);
      expect(await seenTaskIds(0)).not.toContain(id);
    }));

  it('blank title is rejected', () =>
    isolated(async () => {
      await denied(() => setTask(0, 3, randomUUID(), 'todo', { title: '   ' }));
    }));

  it('owner can reopen a done task', () =>
    isolated(async () => {
      const id = randomUUID();
      await setTask(0, 2, id, 'done');
      await setTask(0, 2, id, 'todo');
      const row = (await db.query('SELECT status FROM company_work_tasks WHERE id=$1', [id]))
        .rows[0];
      expect(row.status).toBe('todo');
    }));
});

// ---------------------------------------------------------------------------
// G25: seq_no monotonicity
// ---------------------------------------------------------------------------
describe('G25: per-company seq_no is monotonic and cannot be edited', () => {
  it('seq increments per company; two companies are independent', async () => {
    const taskA1 = randomUUID();
    const taskA2 = randomUUID();
    const taskB1 = randomUUID();

    await db.query(
      'INSERT INTO company_work_tasks(id,group_id,member_id,day,title,created_by) VALUES($1,$2,$3,$4,$5,$3)',
      [taskA1, g.groupId, g.memberIds[0]!, today, 'Task A1'],
    );
    await db.query(
      'INSERT INTO company_work_tasks(id,group_id,member_id,day,title,created_by) VALUES($1,$2,$3,$4,$5,$3)',
      [taskA2, g.groupId, g.memberIds[0]!, today, 'Task A2'],
    );
    await db.query(
      'INSERT INTO company_work_tasks(id,group_id,member_id,day,title,created_by) VALUES($1,$2,$3,$4,$5,$3)',
      [taskB1, b.groupId, b.memberIds[0]!, today, 'Task B1'],
    );

    const rows = await db.query('SELECT id,seq FROM company_work_tasks WHERE id=ANY($1)', [
      [taskA1, taskA2, taskB1],
    ]);
    const aSeqs = rows.rows
      .filter((r: { id: string }) => r.id === taskA1 || r.id === taskA2)
      .map((r: { seq: number }) => r.seq)
      .sort((a: number, b: number) => a - b);
    expect(aSeqs[1]! - aSeqs[0]!).toBe(1);

    // Delete one and insert another; new seq must be higher
    await db.query('UPDATE company_work_tasks SET deleted_at=now() WHERE id=$1', [taskA2]);
    const taskA3 = randomUUID();
    await db.query(
      'INSERT INTO company_work_tasks(id,group_id,member_id,day,title,created_by) VALUES($1,$2,$3,$4,$5,$3)',
      [taskA3, g.groupId, g.memberIds[0]!, today, 'Task A3'],
    );
    const newSeq = (await db.query('SELECT seq FROM company_work_tasks WHERE id=$1', [taskA3]))
      .rows[0].seq as number;
    expect(newSeq).toBeGreaterThan(aSeqs[1] as number);
  });

  it('seq cannot be overwritten by direct UPDATE', async () => {
    const id = randomUUID();
    await db.query(
      'INSERT INTO company_work_tasks(id,group_id,member_id,day,title,created_by) VALUES($1,$2,$3,$4,$5,$3)',
      [id, g.groupId, g.memberIds[0]!, today, 'Seq test'],
    );
    const orig = (await db.query('SELECT seq FROM company_work_tasks WHERE id=$1', [id])).rows[0]
      .seq as number;
    await db.query('UPDATE company_work_tasks SET seq=9999 WHERE id=$1', [id]);
    const after = (await db.query('SELECT seq FROM company_work_tasks WHERE id=$1', [id])).rows[0]
      .seq as number;
    expect(after).toBe(orig);
  });
});

// ---------------------------------------------------------------------------
// G26: Removed employee task access
// ---------------------------------------------------------------------------
describe('G26: removed employee loses task visibility and write access', () => {
  it('owner/manager still see task after employee removal; former employee cannot', () =>
    isolated(async () => {
      const id = randomUUID();
      await setTask(1, 2, id, 'todo');
      await db.query('UPDATE group_members SET left_at=now() WHERE id=$1', [g.memberIds[2]!]);

      const ownerSees = await seenTaskIds(0);
      expect(ownerSees).toContain(id);

      const empSees = await user(2, async () =>
        (await db.query('SELECT id FROM company_work_tasks WHERE deleted_at IS NULL')).rows.map(
          (r) => r.id as string,
        ),
      );
      expect(empSees).not.toContain(id);
    }));

  it('former employee cannot change task status', () =>
    isolated(async () => {
      const id = randomUUID();
      await setTask(1, 2, id, 'todo');
      await db.query('UPDATE group_members SET left_at=now() WHERE id=$1', [g.memberIds[2]!]);
      await denied(() => setTask(2, 2, id, 'doing'));
    }));
});

// ---------------------------------------------------------------------------
// G27: Cross-company task isolation
// ---------------------------------------------------------------------------
describe('G27: cross-company task isolation', () => {
  it('company B member cannot read company A tasks', () =>
    isolated(async () => {
      const id = randomUUID();
      await setTask(0, 2, id, 'todo');
      const seen = await asId(
        b.profileIds[0]!,
        async () => (await db.query('SELECT id FROM company_work_tasks WHERE id=$1', [id])).rows,
      );
      expect(seen).toHaveLength(0);
    }));

  it('company B member cannot remove a company A task', () =>
    isolated(async () => {
      const id = randomUUID();
      await setTask(0, 2, id, 'todo');
      await db.query('SAVEPOINT xcompany');
      try {
        await expectDenied(
          asId(b.profileIds[0]!, () =>
            db.query('SELECT waves_company_work_remove($1,$2)', [g.groupId, id]),
          ),
        );
      } catch {
        const row = (
          await db.query('SELECT id FROM company_work_tasks WHERE id=$1 AND deleted_at IS NULL', [
            id,
          ])
        ).rows[0];
        expect(row).toBeDefined();
      } finally {
        await db.query('ROLLBACK TO SAVEPOINT xcompany');
      }
    }));
});

// ---------------------------------------------------------------------------
// G28: Due-time compatibility
// ---------------------------------------------------------------------------
describe('G28: due-time compat – task retains due_time when employee uses 9-arg form', () => {
  it('task created with due_time retains it after employee status update', () =>
    isolated(async () => {
      const id = randomUUID();
      await user(0, () =>
        db.query('SELECT waves_company_work_set($1,$2,$3,$4,$5,NULL,$6,NULL,NULL,$7)', [
          g.groupId,
          id,
          g.memberIds[2]!,
          today,
          'Finish by 5',
          'todo',
          '17:00',
        ]),
      );
      // Employee uses 9-arg form (no due_time)
      await user(2, () =>
        db.query('SELECT waves_company_work_set($1,$2,$3,$4,$5,NULL,$6,NULL,NULL)', [
          g.groupId,
          id,
          g.memberIds[2]!,
          today,
          'Finish by 5',
          'doing',
        ]),
      );
      const row = (
        await db.query('SELECT status,due_time::text FROM company_work_tasks WHERE id=$1', [id])
      ).rows[0];
      expect(row.status).toBe('doing');
      expect(row.due_time).toBe('17:00:00');
    }));

  it('priority: defaults to normal, set by the owner, kept by older writers, ignored from an employee', () =>
    isolated(async () => {
      const id = randomUUID();
      await setTask(0, 2, id, 'todo');
      const read = async () =>
        (await db.query('SELECT priority FROM company_work_tasks WHERE id=$1', [id])).rows[0]
          .priority;
      const setPriority = (caller: number, p: string) =>
        user(caller, () =>
          db.query('SELECT waves_company_work_priority_set($1,$2,$3)', [g.groupId, id, p]),
        );
      expect(await read()).toBe('normal');
      await setPriority(0, 'very_urgent');
      expect(await read()).toBe('very_urgent');
      // The old 10-argument writer (no priority) keeps it.
      await setTask(0, 2, id, 'doing');
      expect(await read()).toBe('very_urgent');
      // The assignee cannot change it.
      await setPriority(2, 'normal');
      expect(await read()).toBe('very_urgent');
      await denied(() => setPriority(0, 'loud'));
      // A task that no longer exists fails (the sync retries) instead of silently dropping the priority.
      await user(0, () => db.query('SELECT waves_company_work_remove($1,$2)', [g.groupId, id]));
      await denied(() => setPriority(0, 'urgent'));
    }));

  it('manager can reassign within their team; outside-team reassign is denied', () =>
    isolated(async () => {
      const id = randomUUID();
      await setTask(1, 2, id, 'todo');
      // Manager 1 cannot reassign to member 3 (not their team)
      await denied(() =>
        user(1, () =>
          db.query('SELECT waves_company_work_set($1,$2,$3,$4,$5,NULL,$6,NULL,NULL,NULL)', [
            g.groupId,
            id,
            g.memberIds[3]!,
            today,
            'Fix the gate',
            'todo',
          ]),
        ),
      );
      // Owner can reassign to anyone
      await user(0, () =>
        db.query('SELECT waves_company_work_set($1,$2,$3,$4,$5,NULL,$6,NULL,NULL,NULL)', [
          g.groupId,
          id,
          g.memberIds[3]!,
          today,
          'Fix the gate',
          'todo',
        ]),
      );
      const row = (await db.query('SELECT member_id FROM company_work_tasks WHERE id=$1', [id]))
        .rows[0];
      expect(row.member_id).toBe(g.memberIds[3]!);
    }));
});
