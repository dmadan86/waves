import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, seedGroup } from './helpers';

let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
let other: Awaited<ReturnType<typeof seedGroup>>;
const today = new Date().toISOString().slice(0, 10);

const add = async (group: typeof g, title: string) =>
  (
    await db.query<{ id: string; seq: number }>(
      'INSERT INTO company_work_tasks(group_id,member_id,day,title,created_by) VALUES($1,$2,$3,$4,$2) RETURNING id,seq',
      [group.groupId, group.memberIds[0], today, title],
    )
  ).rows[0]!;

beforeAll(async () => {
  db = await connect();
  g = await seedGroup(db, { memberCount: 2 });
  other = await seedGroup(db, { memberCount: 2 });
});
afterAll(async () => {
  await db.query('DELETE FROM groups WHERE id=ANY($1)', [[g.groupId, other.groupId]]);
  await db.end();
});

describe('company task numbers', () => {
  it('counts up per company, never reuses a removed number, and cannot be edited', async () => {
    const a = await add(g, 'one');
    const b = await add(g, 'two');
    expect([a.seq, b.seq]).toEqual([1, 2]);
    await db.query('UPDATE company_work_tasks SET deleted_at=now() WHERE id=$1', [b.id]);
    expect((await add(g, 'three')).seq).toBe(3);
    await db.query('UPDATE company_work_tasks SET seq=99 WHERE id=$1', [a.id]);
    const { rows } = await db.query('SELECT seq FROM company_work_tasks WHERE id=$1', [a.id]);
    expect(rows[0].seq).toBe(1);
    expect((await add(other, 'first elsewhere')).seq).toBe(1);
  });
});
