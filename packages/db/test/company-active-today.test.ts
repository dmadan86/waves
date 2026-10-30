import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

// Members: 0 owner, 1 manager, 2 employee (team of 1, seen), 3 employee (owners, seen), 4 employee (team, not seen), 5 employee (team, seen, not employed).
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
const tz = 0;

async function call(
  i: number,
): Promise<{ total: number; active: number; activeMemberIds: string[] }> {
  await db.query('SAVEPOINT s');
  try {
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: g.profileIds[i], role: 'authenticated' }),
    ]);
    await db.query('SET LOCAL ROLE authenticated');
    return (await db.query('SELECT waves_company_active_today($1,$2) AS r', [g.groupId, tz]))
      .rows[0].r;
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT s');
    throw e;
  } finally {
    await db.query('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claims','',true)");
  }
}
beforeAll(async () => {
  db = await connect();
  g = await seedGroup(db, { memberCount: 6 });
  await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
  g.groupId = randomUUID();
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
    [g.groupId, g.profileIds[0]],
  );
  const roles = ['admin', 'manager', 'member', 'member', 'member', 'member'];
  const mgr = [null, null, 1, null, 1, 1];
  for (let i = 0; i < 6; i++)
    await db.query(
      'INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)',
      [
        g.memberIds[i],
        g.groupId,
        g.profileIds[i],
        roles[i],
        mgr[i] === null ? null : g.memberIds[1],
      ],
    );
  for (const i of [1, 2, 3, 5])
    await db.query(
      'INSERT INTO device_sessions(profile_id,device_id,last_seen_at) VALUES($1,$2,now())',
      [g.profileIds[i], `d${i}`],
    );
  await db.query('UPDATE group_members SET left_at=now(),removed_at=now() WHERE id=$1', [
    g.memberIds[5],
  ]);
});
afterAll(async () => {
  if (db) await db.end();
});

describe('waves_company_active_today', () => {
  beforeEach(() => db.query('BEGIN'));
  afterEach(() => db.query('ROLLBACK'));
  it('owner: counts every live employee, skips not-employed', async () => {
    const r = await call(0);
    expect(r.total).toBe(3);
    expect(r.active).toBe(2);
    expect(r.activeMemberIds.sort()).toEqual([g.memberIds[2], g.memberIds[3]].sort());
  });
  it('manager: only their own team', async () => {
    const r = await call(1);
    expect(r.total).toBe(2);
    expect(r.activeMemberIds).toEqual([g.memberIds[2]]);
  });
  it('returns counts and ids only', async () => {
    expect(Object.keys(await call(0)).sort()).toEqual(['active', 'activeMemberIds', 'total']);
  });
  it('an employee cannot call it', async () => {
    await db.query('SAVEPOINT x');
    await expectDenied(call(2));
    await db.query('ROLLBACK TO SAVEPOINT x');
  });
  it('anon is denied', async () => {
    await db.query('SAVEPOINT y');
    await db.query('SET LOCAL ROLE anon');
    await expectDenied(db.query('SELECT waves_company_active_today($1,0)', [g.groupId]));
    await db.query('ROLLBACK TO SAVEPOINT y');
  });
  it('rejects an out-of-range timezone offset', async () => {
    await db.query('SAVEPOINT z');
    await expectDenied(db.query('SELECT waves_company_active_today($1,99999)', [g.groupId]));
    await db.query('ROLLBACK TO SAVEPOINT z');
  });
});
