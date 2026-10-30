import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, seedGroup } from './helpers';

// Members: 0 owner, 1 manager, 2 other manager, 3 employee.
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
const items = [
  { description: 'Paint', qtyMilli: '2500', rateMinor: '333' },
  { description: 'Labour', qtyMilli: '1000', rateMinor: '10000' },
];

async function as<T>(i: number, run: () => Promise<T>): Promise<T> {
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
const save = (
  who: number,
  docType: string,
  extra: Record<string, unknown> = {},
  id = randomUUID(),
) =>
  as(who, () =>
    db.query('SELECT waves_company_doc_save($1,$2,$3)', [
      g.groupId,
      id,
      JSON.stringify({ docType, customerName: 'Ravi', docDate: '2026-11-14', items, ...extra }),
    ]),
  ).then(() => id);
const count = (who: number) =>
  as(who, async () =>
    Number((await db.query('SELECT count(*) FROM company_documents')).rows[0].count),
  );
const row = async (id: string) =>
  (await db.query('SELECT * FROM company_documents WHERE id=$1', [id])).rows[0];

beforeAll(async () => {
  db = await connect();
  g = await seedGroup(db, { memberCount: 4 });
  await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
  g.groupId = randomUUID();
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
    [g.groupId, g.profileIds[0]],
  );
  const roles = ['admin', 'manager', 'manager', 'member'];
  for (let i = 0; i < 4; i++)
    await db.query('INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,$4)', [
      g.memberIds[i],
      g.groupId,
      g.profileIds[i],
      roles[i],
    ]);
  await db.query('BEGIN');
});
afterAll(async () => {
  if (db) {
    await db.query('ROLLBACK');
    await db.end();
  }
});

describe('company documents', () => {
  it('numbers per type and recomputes totals on the server (round half up, discount)', async () => {
    const a = await save(1, 'estimate', { discountMinor: '100' });
    const b = await save(1, 'estimate');
    const c = await save(1, 'bill');
    expect((await row(a)).number).toBe(1);
    expect((await row(a)).total_minor).toBe('10733');
    expect((await row(b)).number).toBe(2);
    expect((await row(c)).number).toBe(1);
  });

  it('owners see all, a manager only their own, employees none', async () => {
    await save(2, 'bill');
    expect(await count(0)).toBe(4);
    expect(await count(2)).toBe(1);
    expect(await count(3)).toBe(0);
  });

  it('an employee cannot create; another manager cannot touch a document', async () => {
    await expect(save(3, 'bill')).rejects.toThrow(/NOT_ALLOWED/);
    const mine = await save(1, 'estimate');
    await expect(
      as(2, () => db.query("SELECT waves_company_doc_status($1,'sent')", [mine])),
    ).rejects.toThrow(/NOT_ALLOWED/);
  });

  it('converts once, and part payments move the bill to paid without overpaying', async () => {
    const est = await save(1, 'estimate');
    const bill = randomUUID();
    await as(1, () => db.query('SELECT waves_company_doc_convert($1,$2)', [est, bill]));
    await as(1, () => db.query('SELECT waves_company_doc_convert($1,$2)', [est, bill]));
    await expect(
      as(1, () => db.query('SELECT waves_company_doc_convert($1,$2)', [est, randomUUID()])),
    ).rejects.toThrow(/ALREADY_CONVERTED/);
    const pay = (amount: number) =>
      as(1, () =>
        db.query('SELECT waves_company_doc_payment($1,$2,$3,$4)', [
          bill,
          randomUUID(),
          amount,
          '2026-11-15',
        ]),
      );
    await pay(5000);
    expect((await row(bill)).status).toBe('part_paid');
    await expect(pay(99999999)).rejects.toThrow(/OVERPAID/);
    await pay(Number((await row(bill)).total_minor) - 5000);
    expect((await row(bill)).status).toBe('paid');
    await expect(
      as(1, () => db.query('SELECT waves_company_doc_void($1)', [bill])),
    ).rejects.toThrow(/HAS_PAYMENTS/);
  });
});
