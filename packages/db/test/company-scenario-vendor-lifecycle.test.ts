import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connect, seedGroup } from './helpers';

let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
async function as<T>(i: number, run: () => Promise<T>): Promise<T> {
  await db.query('SAVEPOINT actor');
  try {
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: g.profileIds[i], role: 'authenticated' }),
    ]);
    await db.query('SET LOCAL ROLE authenticated');
    return await run();
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT actor');
    throw e;
  } finally {
    await db.query('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claims','',true)");
    await db.query('RELEASE SAVEPOINT actor');
  }
}
async function scenario(fn: () => Promise<void>) {
  await db.query('BEGIN');
  try {
    await fn();
  } finally {
    await db.query('ROLLBACK');
  }
}
async function setup() {
  g = await seedGroup(db, { memberCount: 4 });
  await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
  g.groupId = randomUUID();
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
    [g.groupId, g.profileIds[0]],
  );
  for (let i = 0; i < 4; i++)
    await db.query(
      'INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)',
      [
        g.memberIds[i],
        g.groupId,
        g.profileIds[i],
        ['admin', 'manager', 'manager', 'vendor'][i],
        null,
      ],
    );
}
beforeAll(async () => {
  db = await connect();
});
beforeEach(setup);
afterAll(async () => {
  if (db) await db.end();
});
describe('vendor lifecycle compositions', () => {
  it('manager can edit its own vendor and review its pending bill', () =>
    scenario(async () => {
      const vendor = randomUUID();
      await as(1, () =>
        db.query('SELECT waves_company_vendor_set($1,$2,$3)', [
          g.groupId,
          vendor,
          JSON.stringify({ name: 'North Supply' }),
        ]),
      );
      // Vendor-role RPC access requires the vendor login to be linked to this vendor.
      await db.query('UPDATE company_vendors SET member_id=$1 WHERE id=$2', [
        g.memberIds[3],
        vendor,
      ]);
      await as(1, () =>
        db.query('SELECT waves_company_vendor_set($1,$2,$3)', [
          g.groupId,
          vendor,
          JSON.stringify({ name: 'North Supply Ltd' }),
        ]),
      );
      const bill = randomUUID();
      await as(3, () =>
        db.query('SELECT waves_company_vendor_entry_create($1,$2,$3,$4,$5)', [
          g.groupId,
          bill,
          vendor,
          'bill',
          JSON.stringify({ amount: '1200', occurredOn: '2026-10-01' }),
        ]),
      );
      let r = (
        await db.query('SELECT status,amount FROM company_vendor_entries WHERE id=$1', [bill])
      ).rows[0];
      expect(r).toMatchObject({ status: 'pending', amount: '1200' });
      await as(1, () =>
        db.query("SELECT waves_company_vendor_entry_review($1,'approved',NULL,$2)", [bill, 1]),
      );
      let total = await db.query(
        "SELECT coalesce(sum(amount) FILTER(WHERE kind='bill' AND status='approved'),0)::text n FROM company_vendor_entries WHERE vendor_id=$1",
        [vendor],
      );
      expect(total.rows[0].n).toBe('1200');
      const payment = randomUUID();
      await as(1, () =>
        db.query('SELECT waves_company_vendor_entry_create($1,$2,$3,$4,$5)', [
          g.groupId,
          payment,
          vendor,
          'payment',
          JSON.stringify({ amount: '1200', occurredOn: '2026-10-02' }),
        ]),
      );
      r = (
        await db.query('SELECT status,amount FROM company_vendor_entries WHERE id=$1', [payment])
      ).rows[0];
      expect(r).toMatchObject({ status: 'approved', amount: '1200' });
      const sums = (
        await db.query(
          "SELECT coalesce(sum(amount) FILTER(WHERE kind='bill' AND status='approved'),0)::text bills,coalesce(sum(amount) FILTER(WHERE kind='payment' AND status='approved'),0)::text paid FROM company_vendor_entries WHERE vendor_id=$1",
          [vendor],
        )
      ).rows[0];
      expect(sums).toEqual({ bills: '1200', paid: '1200' });
    }));
  it('manager payment and advance are reflected in the owner pool totals while bill remains unpaid', () =>
    scenario(async () => {
      const v = randomUUID();
      await as(1, () =>
        db.query('SELECT waves_company_vendor_set($1,$2,$3)', [g.groupId, v, '{"name":"Vendor"}']),
      );
      for (const [kind, amount] of [
        ['bill', '900'],
        ['payment', '200'],
        ['advance', '100'],
      ] as const)
        await as(1, () =>
          db.query('SELECT waves_company_vendor_entry_create($1,$2,$3,$4,$5)', [
            g.groupId,
            randomUUID(),
            v,
            kind,
            JSON.stringify({ amount, occurredOn: '2026-10-01' }),
          ]),
        );
      const bal = (
        await as(0, () =>
          db.query('SELECT waves_company_pool_balance($1,$2) b', [g.groupId, g.memberIds[1]]),
        )
      ).rows[0].b;
      expect(bal.vendorPaid).toBe('300');
      expect(bal.balance).toBe('-300');
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM company_vendor_entries WHERE vendor_id=$1 AND kind='bill' AND status='approved'",
            [v],
          )
        ).rows[0].n,
      ).toBe(1);
    }));
  it('foreign company vendor ids cannot be used for create, read, edit, or payment', () =>
    scenario(async () => {
      const foreign = randomUUID(),
        foreignGroup = randomUUID(),
        foreignOwner = randomUUID();
      await db.query(
        "INSERT INTO groups(id,type,default_currency,created_by) VALUES($1,'company','INR',$2)",
        [foreignGroup, g.profileIds[0]],
      );
      await db.query(
        "INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,'admin')",
        [foreignOwner, foreignGroup, g.profileIds[0]],
      );
      await db.query(
        "INSERT INTO company_vendors(id,group_id,name,added_by) VALUES($1,$2,'Foreign',$3)",
        [foreign, foreignGroup, foreignOwner],
      );
      let denied = false;
      try {
        await as(1, () =>
          db.query('SELECT waves_company_vendor_entry_create($1,$2,$3,$4,$5)', [
            g.groupId,
            randomUUID(),
            foreign,
            'payment',
            '{"amount":"1","occurredOn":"2026-10-01"}',
          ]),
        );
      } catch {
        denied = true;
      }
      expect(denied).toBe(true);
      let editDenied = false;
      try {
        await as(1, () =>
          db.query('SELECT waves_company_vendor_set($1,$2,$3)', [
            g.groupId,
            foreign,
            '{"name":"Changed foreign vendor"}',
          ]),
        );
      } catch {
        editDenied = true;
      }
      expect(editDenied).toBe(true);
      expect(
        (await as(1, () => db.query('SELECT id FROM company_vendors WHERE id=$1', [foreign]))).rows,
      ).toHaveLength(0);
    }));
  it('removed manager vendor and its approved unpaid bill remain owner-visible and payable', () =>
    scenario(async () => {
      const v = randomUUID();
      await as(1, () =>
        db.query('SELECT waves_company_vendor_set($1,$2,$3)', [
          g.groupId,
          v,
          '{"name":"Team Vendor"}',
        ]),
      );
      const b = randomUUID();
      await as(1, () =>
        db.query('SELECT waves_company_vendor_entry_create($1,$2,$3,$4,$5)', [
          g.groupId,
          b,
          v,
          'bill',
          '{"amount":"475","occurredOn":"2026-10-01"}',
        ]),
      );
      await as(1, () =>
        db.query("SELECT waves_company_vendor_entry_review($1,'approved',NULL,1)", [b]),
      );
      await db.query(
        'UPDATE group_members SET manager_id=NULL WHERE group_id=$1 AND manager_id=$2',
        [g.groupId, g.memberIds[1]],
      );
      await as(0, () => db.query('SELECT waves_remove_member($1)', [g.memberIds[1]]));
      expect(
        (
          await as(0, () =>
            db.query('SELECT amount,status FROM company_vendor_entries WHERE id=$1', [b]),
          )
        ).rows[0],
      ).toMatchObject({ amount: '475', status: 'approved' });
      const p = randomUUID();
      await as(0, () =>
        db.query('SELECT waves_company_vendor_entry_create($1,$2,$3,$4,$5)', [
          g.groupId,
          p,
          v,
          'payment',
          '{"amount":"475","occurredOn":"2026-10-02"}',
        ]),
      );
      expect(
        (await db.query('SELECT status,amount FROM company_vendor_entries WHERE id=$1', [p]))
          .rows[0],
      ).toMatchObject({ status: 'approved', amount: '475' });
    }));
  it('vendor bill entry cannot exceed a permitted vendor scope or be paid by a different manager', () =>
    scenario(async () => {
      const v = randomUUID();
      await as(1, () =>
        db.query('SELECT waves_company_vendor_set($1,$2,$3)', [
          g.groupId,
          v,
          '{"name":"Manager vendor"}',
        ]),
      );
      const id = randomUUID();
      await as(1, () =>
        db.query('SELECT waves_company_vendor_entry_create($1,$2,$3,$4,$5)', [
          g.groupId,
          id,
          v,
          'bill',
          '{"amount":"250","occurredOn":"2026-10-01"}',
        ]),
      );
      let denied = false;
      try {
        await as(2, () =>
          db.query('SELECT waves_company_vendor_entry_create($1,$2,$3,$4,$5)', [
            g.groupId,
            randomUUID(),
            v,
            'payment',
            '{"amount":"250","occurredOn":"2026-10-01"}',
          ]),
        );
      } catch {
        denied = true;
      }
      expect(denied).toBe(true);
      expect(
        (await db.query('SELECT amount FROM company_vendor_entries WHERE id=$1', [id])).rows[0]
          .amount,
      ).toBe('250');
    }));
  it('vendor confirms payment receipt without changing the payment amount', () =>
    scenario(async () => {
      const v = randomUUID();
      await as(0, () =>
        db.query('SELECT waves_company_vendor_set($1,$2,$3)', [g.groupId, v, '{"name":"Vendor"}']),
      );
      await db.query('UPDATE company_vendors SET member_id=$1 WHERE id=$2', [g.memberIds[3], v]);
      const p = randomUUID();
      await as(0, () =>
        db.query('SELECT waves_company_vendor_entry_create($1,$2,$3,$4,$5)', [
          g.groupId,
          p,
          v,
          'payment',
          '{"amount":"88","occurredOn":"2026-10-01"}',
        ]),
      );
      await as(3, () => db.query('SELECT waves_company_vendor_entry_received($1,true)', [p]));
      expect(
        (await db.query('SELECT amount,received_at FROM company_vendor_entries WHERE id=$1', [p]))
          .rows[0],
      ).toMatchObject({ amount: '88' });
      expect(
        (await db.query('SELECT received_at FROM company_vendor_entries WHERE id=$1', [p])).rows[0]
          .received_at,
      ).not.toBeNull();
    }));
  it('duplicate bill creation with same id and payload is idempotent and conflicting payload is denied', () =>
    scenario(async () => {
      const v = randomUUID();
      await as(1, () =>
        db.query('SELECT waves_company_vendor_set($1,$2,$3)', [g.groupId, v, '{"name":"Vendor"}']),
      );
      const id = randomUUID();
      const create = (amount: string) =>
        as(1, () =>
          db.query('SELECT waves_company_vendor_entry_create($1,$2,$3,$4,$5)', [
            g.groupId,
            id,
            v,
            'bill',
            JSON.stringify({ amount, occurredOn: '2026-10-01' }),
          ]),
        );
      await create('19');
      await create('19');
      let failed = false;
      try {
        await create('20');
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
      expect(
        (await db.query('SELECT count(*)::int n FROM company_vendor_entries WHERE id=$1', [id]))
          .rows[0].n,
      ).toBe(1);
    }));
  it('vendor advance and bill offset remain distinct owner totals after partial payment', () =>
    scenario(async () => {
      const v = randomUUID();
      await as(1, () =>
        db.query('SELECT waves_company_vendor_set($1,$2,$3)', [
          g.groupId,
          v,
          '{"name":"Offset Supplier"}',
        ]),
      );
      const advance = randomUUID(),
        bill = randomUUID(),
        payment = randomUUID();
      await as(1, () =>
        db.query('SELECT waves_company_vendor_entry_create($1,$2,$3,$4,$5)', [
          g.groupId,
          advance,
          v,
          'advance',
          '{"amount":"200","occurredOn":"2026-10-01"}',
        ]),
      );
      await as(1, () =>
        db.query('SELECT waves_company_vendor_entry_create($1,$2,$3,$4,$5)', [
          g.groupId,
          bill,
          v,
          'bill',
          '{"amount":"750","occurredOn":"2026-10-02"}',
        ]),
      );
      await as(1, () =>
        db.query('SELECT waves_company_vendor_entry_create($1,$2,$3,$4,$5)', [
          g.groupId,
          payment,
          v,
          'payment',
          '{"amount":"300","occurredOn":"2026-10-03"}',
        ]),
      );
      const totals = (
        await as(0, () =>
          db.query(
            "SELECT coalesce(sum(amount) FILTER(WHERE kind='advance' AND status='approved'),0)::text advances,coalesce(sum(amount) FILTER(WHERE kind='bill' AND status='approved'),0)::text bills,coalesce(sum(amount) FILTER(WHERE kind='payment' AND status='approved'),0)::text paid FROM company_vendor_entries WHERE vendor_id=$1",
            [v],
          ),
        )
      ).rows[0];
      expect(totals).toEqual({ advances: '200', bills: '750', paid: '300' });
    }));
});
