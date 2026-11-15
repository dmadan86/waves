import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

// Members: 0 owner, 1 manager A, 2 manager B, 3 employee (team of manager A), 4 vendor login (Ravi).
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
const ravi = randomUUID(); // owner-added, linked to member 4
const mine = randomUUID(); // added by manager A, name only
const other = randomUUID(); // added by manager B, name only

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
const addVendor = (caller: number, id: string, name: string) =>
  user(caller, () =>
    db.query('SELECT waves_company_vendor_set($1,$2,$3)', [
      g.groupId,
      id,
      JSON.stringify({ name }),
    ]),
  );
const line = (
  caller: number,
  vendor: string,
  kind: string,
  amount: string,
  extra: Record<string, unknown> = {},
  id = randomUUID(),
) =>
  user(caller, async () => {
    await db.query('SELECT waves_company_vendor_entry_create($1,$2,$3,$4,$5)', [
      g.groupId,
      id,
      vendor,
      kind,
      JSON.stringify({ amount, occurredOn: '2026-11-10', ...extra }),
    ]);
    return id;
  });
const row = async (id: string) =>
  (
    await db.query(
      'SELECT due_on::text,method,reference,receipt_no FROM company_vendor_entries WHERE id=$1',
      [id],
    )
  ).rows[0];

beforeAll(async () => {
  db = await connect();
  g = await seedGroup(db, { memberCount: 5 });
  await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
  g.groupId = randomUUID();
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
    [g.groupId, g.profileIds[0]],
  );
  const roles = ['admin', 'manager', 'manager', 'member', 'vendor'];
  for (let i = 0; i < 5; i++)
    await db.query(
      'INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)',
      [g.memberIds[i], g.groupId, g.profileIds[i], roles[i], i === 3 ? g.memberIds[1] : null],
    );
  await db.query('BEGIN');
  await addVendor(0, ravi, 'Ravi Traders');
  await db.query('UPDATE company_vendors SET member_id=$1 WHERE id=$2', [g.memberIds[4], ravi]);
  await addVendor(1, mine, 'A Hardware');
  await addVendor(2, other, 'B Paints');
  await db.query('COMMIT');
});
afterAll(async () => {
  if (db) await db.end();
});

describe('vendor payments v2', () => {
  it('stores due date, method and reference; numbers payments per company', () =>
    isolated(async () => {
      const bill = await line(0, ravi, 'bill', '1000', { dueOn: '2026-12-01' });
      expect((await row(bill)).due_on).toBe('2026-12-01');
      expect((await row(bill)).receipt_no).toBeNull();
      const p1 = await line(0, ravi, 'payment', '100', { method: 'upi', reference: 'UTR1' });
      const p2 = await line(1, mine, 'payment', '50', { method: 'cash' });
      expect(await row(p1)).toMatchObject({ method: 'upi', reference: 'UTR1', receipt_no: 1 });
      expect((await row(p2)).receipt_no).toBe(2);
      await db.query('UPDATE company_vendor_entries SET receipt_no=99 WHERE id=$1', [p1]);
      expect((await row(p1)).receipt_no).toBe(1);
      const adv = await line(0, ravi, 'advance', '10');
      expect((await row(adv)).receipt_no).toBeNull();
    }));

  it('rejects a bad method, an over-long reference and fields on the wrong kind', () =>
    isolated(async () => {
      await denied(() => line(0, ravi, 'payment', '10', { method: 'cheque' }));
      await denied(() => line(0, ravi, 'payment', '10', { reference: 'x'.repeat(65) }));
      await denied(() => line(0, ravi, 'bill', '10', { method: 'upi' }));
      await denied(() => line(0, ravi, 'payment', '10', { dueOn: '2026-12-01' }));
    }));

  it('a vendor login cannot record a payment or set a method on a bill', () =>
    isolated(async () => {
      await denied(() => line(4, ravi, 'payment', '10', { method: 'upi' }));
      await denied(() => line(4, ravi, 'bill', '10', { method: 'upi' }));
      const bill = await line(4, ravi, 'bill', '10', { dueOn: '2026-12-01' });
      expect((await row(bill)).due_on).toBe('2026-12-01');
    }));

  it('no one can write the columns directly', () =>
    isolated(async () => {
      const p = await line(0, ravi, 'payment', '10');
      await denied(() =>
        user(4, () => db.query("UPDATE company_vendor_entries SET method='cash' WHERE id=$1", [p])),
      );
    }));

  it('replaying the same request returns the same row', () =>
    isolated(async () => {
      const id = randomUUID();
      await line(0, ravi, 'payment', '10', { method: 'bank' }, id);
      await line(0, ravi, 'payment', '10', { method: 'bank' }, id);
      expect(
        (await db.query('SELECT count(*)::int n FROM company_vendor_entries WHERE id=$1', [id]))
          .rows[0].n,
      ).toBe(1);
    }));
});
