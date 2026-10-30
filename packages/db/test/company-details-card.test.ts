import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

// Members: 0 owner, 1 manager A, 2 manager B, 3 employee (team of manager A), 4 vendor login (Ravi).
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
const ravi = randomUUID(); // owner-added, linked to member 4
const mine = randomUUID(); // added by manager A
const other = randomUUID(); // added by manager B

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

const card = (extra: Record<string, unknown> = {}) => ({
  bankName: 'HDFC',
  bankAccount: '123456785678',
  ifsc: 'HDFC0001234',
  upi: 'ravi@okhdfc',
  pan: 'PQRST6789U',
  address: '1 Main Rd',
  phone: '+919999999999',
  email: 'a@b.co',
  gstin: '29ABCDE1234F1Z5',
  note: 'hi',
  ...extra,
});
const setCompany = (i: number, d: object) =>
  user(i, () =>
    db.query('SELECT waves_company_details_set($1,$2)', [g.groupId, JSON.stringify(d)]),
  );
const setVendor = (i: number, v: string, d: object) =>
  user(i, () =>
    db.query('SELECT waves_company_vendor_details_set($1,$2,$3)', [
      g.groupId,
      v,
      JSON.stringify(d),
    ]),
  );
const rows = (i: number, sql: string) => user(i, async () => (await db.query(sql)).rows);

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
  for (const [id, by, name] of [
    [ravi, 0, 'Ravi'],
    [mine, 1, 'A'],
    [other, 2, 'B'],
  ] as const)
    await db.query('INSERT INTO company_vendors(id,group_id,name,added_by) VALUES($1,$2,$3,$4)', [
      id,
      g.groupId,
      name,
      g.memberIds[by],
    ]);
  await db.query('UPDATE company_vendors SET member_id=$1 WHERE id=$2', [g.memberIds[4], ravi]);
});
afterAll(async () => {
  if (db) await db.end();
});

describe('company card: bank and PAN never reach an employee', () => {
  it('owner saves; every live member reads the public part; only owner/manager/vendor read bank + PAN', () =>
    isolated(async () => {
      await setCompany(0, card());
      for (const i of [0, 1, 2, 3, 4])
        expect(await rows(i, 'SELECT * FROM company_details')).toHaveLength(1);
      for (const i of [0, 1, 2, 4])
        expect(await rows(i, 'SELECT * FROM company_details_secure')).toHaveLength(1);
      expect(await rows(3, 'SELECT * FROM company_details_secure')).toEqual([]);
      const pub = (await rows(3, 'SELECT * FROM company_details'))[0];
      expect(JSON.stringify(pub)).not.toMatch(/123456785678|HDFC0001234|ravi@okhdfc|PQRST6789U/);
      expect(pub.gstin).toBe('29ABCDE1234F1Z5');
      expect(pub.updated_by_name).toBeDefined();
    }));

  it('only the owner edits the company card', () =>
    isolated(async () => {
      for (const i of [1, 3, 4]) await denied(() => setCompany(i, card()));
    }));

  it('someone who left gets nothing', () =>
    isolated(async () => {
      await setCompany(0, card());
      await db.query('UPDATE group_members SET left_at=now() WHERE id=$1', [g.memberIds[3]]);
      expect(await rows(3, 'SELECT * FROM company_details')).toEqual([]);
      await db.query('UPDATE group_members SET left_at=now() WHERE id=$1', [g.memberIds[4]]);
      expect(await rows(4, 'SELECT * FROM company_details_secure')).toEqual([]);
    }));

  it('bank_changed_at is set on a bank change only, not on other fields or on a repeat save', () =>
    isolated(async () => {
      await setCompany(0, card());
      const t1 = (await rows(0, 'SELECT bank_changed_at FROM company_details_secure'))[0]
        .bank_changed_at;
      expect(t1).not.toBeNull();
      await db.query(
        "UPDATE company_details_secure SET bank_changed_at=bank_changed_at-interval '1 day'",
      );
      const base = (await rows(0, 'SELECT bank_changed_at FROM company_details_secure'))[0]
        .bank_changed_at;
      await setCompany(0, card({ address: 'elsewhere', pan: 'ZZZZZ9999Z', note: 'x' }));
      expect(
        (await rows(0, 'SELECT bank_changed_at FROM company_details_secure'))[0].bank_changed_at,
      ).toEqual(base);
      await setCompany(0, card({ ifsc: 'SBIN0000001' }));
      const after = (
        await rows(0, 'SELECT bank_changed_at,bank_changed_by FROM company_details_secure')
      )[0];
      expect(after.bank_changed_at.getTime()).toBeGreaterThan(base.getTime());
      expect(after.bank_changed_by).toBe(g.memberIds[0]);
    }));

  it('a card with no bank fields leaves bank_changed_at empty', () =>
    isolated(async () => {
      await setCompany(0, { phone: '123' });
      expect(
        (await rows(0, 'SELECT bank_changed_at FROM company_details_secure'))[0].bank_changed_at,
      ).toBeNull();
    }));
});

describe('vendor card', () => {
  it('visible to owner, owning manager and that vendor only', () =>
    isolated(async () => {
      await setVendor(0, ravi, card());
      await setVendor(1, mine, card({ phone: '1' }));
      expect((await rows(0, 'SELECT vendor_id FROM company_vendor_details')).length).toBe(2);
      expect(
        (await rows(1, 'SELECT vendor_id FROM company_vendor_details')).map((r) => r.vendor_id),
      ).toEqual([mine]);
      expect(await rows(2, 'SELECT vendor_id FROM company_vendor_details')).toEqual([]);
      expect(await rows(3, 'SELECT vendor_id FROM company_vendor_details')).toEqual([]);
      expect(
        (await rows(4, 'SELECT vendor_id FROM company_vendor_details')).map((r) => r.vendor_id),
      ).toEqual([ravi]);
    }));

  it('edit rights: owner, owning manager, linked vendor; not another manager, employee or vendor of another', () =>
    isolated(async () => {
      await setVendor(0, ravi, card());
      await setVendor(4, ravi, card({ bankAccount: '999988887777' }));
      await setVendor(1, mine, card());
      await denied(() => setVendor(2, mine, card()));
      await denied(() => setVendor(3, mine, card()));
      await denied(() => setVendor(4, mine, card()));
      await denied(() => setVendor(1, ravi, card()));
    }));

  it('a vendor change is flagged with who made it', () =>
    isolated(async () => {
      await setVendor(0, ravi, card());
      await setVendor(4, ravi, card({ upi: 'new@upi' }));
      const r = (await rows(0, 'SELECT bank_changed_by,updated_by FROM company_vendor_details'))[0];
      expect(r.bank_changed_by).toBe(g.memberIds[4]);
    }));
});

describe('validation and blocking', () => {
  it.each([
    ['ifsc', 'HDFC1001234'],
    ['gstin', '29ABCDE1234F1Z'],
    ['pan', 'ABCD1234EF'],
    ['upi', 'no-at-sign'],
    ['email', 'nope'],
    ['bankAccount', '12'],
    ['note', 'x'.repeat(501)],
    ['address', 'x'.repeat(301)],
  ])('rejects a bad %s', (k, v) =>
    isolated(async () => {
      await denied(() => setCompany(0, { [k]: v }));
      await denied(() => setVendor(0, ravi, { [k]: v }));
    }),
  );
  it('rejects an unknown key', () =>
    isolated(async () => {
      await denied(() => setCompany(0, { amount: '5' }));
    }));
  it('lower-case ifsc/pan/gstin are normalised', () =>
    isolated(async () => {
      await setCompany(0, { ifsc: 'hdfc0001234', pan: 'abcde1234f' });
      const r = (await rows(0, 'SELECT ifsc,pan FROM company_details_secure'))[0];
      expect(r).toEqual({ ifsc: 'HDFC0001234', pan: 'ABCDE1234F' });
    }));
  it('a suspended company refuses both cards', () =>
    isolated(async () => {
      await setCompany(0, card());
      await db.query('UPDATE groups SET suspended_at=now() WHERE id=$1', [g.groupId]);
      await denied(() => setCompany(0, card({ note: 'new' })));
      await denied(() => setVendor(0, ravi, card()));
      expect(await rows(0, 'SELECT * FROM company_details')).toHaveLength(1);
    }));
  it('is not callable by anon', () =>
    isolated(async () => {
      await db.query('SET LOCAL ROLE anon');
      await denied(() => db.query('SELECT waves_company_details_set($1,$2)', [g.groupId, '{}']));
      await db.query('RESET ROLE');
    }));
});
