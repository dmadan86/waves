import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

// A suspended company refuses attendance, daily work and estimate/bill writes. Members: 0 owner, 1 manager, 2 employee.
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
const day = new Date().toISOString().slice(0, 10);

async function as<T>(i: number, run: () => Promise<T>, role: 'authenticated' | 'service_role' = 'authenticated'): Promise<T> {
  await db.query('SAVEPOINT actor_scope');
  try {
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify(role === 'service_role' ? { role } : { sub: g.profileIds[i], role }),
    ]);
    await db.query(`SET LOCAL ROLE ${role}`);
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
const mark = (i: number) =>
  as(i, () => db.query("SELECT waves_company_attendance_set($1,$2,$3,'present',NULL)", [g.groupId, g.memberIds[2], day]));
const task = (i: number) =>
  as(i, () =>
    db.query("SELECT waves_company_work_set($1,$2,$3,$4,'Paint wall',NULL,'todo',NULL,NULL)", [g.groupId, randomUUID(), g.memberIds[2], day]),
  );
const doc = (i: number) =>
  as(i, () =>
    db.query('SELECT waves_company_doc_save($1,$2,$3)', [
      g.groupId,
      randomUUID(),
      JSON.stringify({ docType: 'estimate', customerName: 'Ravi', docDate: day, items: [{ description: 'Paint', qtyMilli: '1000', rateMinor: '100' }] }),
    ]),
  );
async function denied(run: () => Promise<unknown>) {
  await db.query('SAVEPOINT expected_failure');
  try {
    expect(await expectDenied(run())).toMatch(/COMPANY_BLOCKED/);
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT expected_failure');
  }
}

beforeAll(async () => {
  db = await connect();
  g = await seedGroup(db, { memberCount: 3 });
  await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
  g.groupId = randomUUID();
  await db.query("INSERT INTO groups(id,name,type,default_currency,country_code,created_by) VALUES($1,'Acme Works','company','INR','IN',$2)", [g.groupId, g.profileIds[0]]);
  const roles = ['admin', 'manager', 'member'];
  for (let i = 0; i < 3; i++)
    await db.query('INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)', [
      g.memberIds[i], g.groupId, g.profileIds[i], roles[i], i === 2 ? g.memberIds[1] : null,
    ]);
});
afterAll(async () => {
  if (db) await db.end();
});

describe('blocked company: attendance, work and documents', () => {
  it('work before the block, refused during it, fine again after', async () => {
    await db.query('BEGIN');
    try {
      await mark(0);
      await task(0);
      await doc(0);
      await as(0, () => db.query("SELECT waves_admin_company_block($1,'complaint','Staff complaint')", [g.groupId]), 'service_role');
      await denied(() => mark(0));
      await denied(() => mark(1));
      await denied(() => task(0));
      await denied(() => task(1));
      await denied(() => doc(0));
      await denied(() => doc(1));
      await as(0, () => db.query("SELECT waves_admin_company_unblock($1,'Resolved')", [g.groupId]), 'service_role');
      await mark(0);
      await task(0);
      await doc(0);
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
