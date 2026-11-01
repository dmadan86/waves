import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

// Members: 0 owner, 1 manager A, 2 manager B, 3 employee, 4 vendor login (Ravi).
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
let h: Awaited<ReturnType<typeof seedGroup>>; // another company
const ravi = randomUUID(); // owner-added, linked to member 4
const mine = randomUUID(); // added by manager A
const other = randomUUID(); // added by manager B
const hv = randomUUID();

async function userIn<T>(grp: typeof g, i: number, run: () => Promise<T>): Promise<T> {
  await db.query('SAVEPOINT actor_scope');
  try {
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: grp.profileIds[i], role: 'authenticated' }),
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
const user = <T>(i: number, run: () => Promise<T>) => userIn(g, i, run);
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

async function makeCompany(roles: string[]) {
  const grp = await seedGroup(db, { memberCount: roles.length });
  await db.query('DELETE FROM groups WHERE id=$1', [grp.groupId]);
  grp.groupId = randomUUID();
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
    [grp.groupId, grp.profileIds[0]],
  );
  for (let i = 0; i < roles.length; i++)
    await db.query('INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,$4)', [
      grp.memberIds[i],
      grp.groupId,
      grp.profileIds[i],
      roles[i],
    ]);
  return grp;
}
const items = [
  { name: 'Cement', qty: '10.5', unit: 'bags', unitPrice: '40000' },
  { name: 'Sand', qty: '2', unit: 'other', unitPrice: '1500' },
];
const setOrder = (
  caller: number,
  vendor: string,
  id = randomUUID(),
  data: Record<string, unknown> = { items },
  grp = g,
) =>
  userIn(grp, caller, async () => {
    await db.query('SELECT waves_company_vendor_order_set($1,$2,$3,$4)', [
      grp.groupId,
      id,
      vendor,
      JSON.stringify(data),
    ]);
    return id;
  });
const status = (caller: number, id: string, to: string, grp = g) =>
  userIn(grp, caller, () => db.query('SELECT waves_company_vendor_order_status($1,$2)', [id, to]));
const st = async (id: string) =>
  (await db.query('SELECT status FROM company_vendor_orders WHERE id=$1', [id])).rows[0]
    .status as string;
const seen = (caller: number, grp = g) =>
  userIn(grp, caller, async () =>
    (await db.query('SELECT id FROM company_vendor_orders')).rows.map((r) => r.id as string),
  );
const vendorSet = (grp: typeof g, caller: number, id: string, name: string) =>
  userIn(grp, caller, () =>
    db.query('SELECT waves_company_vendor_set($1,$2,$3)', [
      grp.groupId,
      id,
      JSON.stringify({ name }),
    ]),
  );

beforeAll(async () => {
  db = await connect();
  g = await makeCompany(['admin', 'manager', 'manager', 'member', 'vendor']);
  h = await makeCompany(['admin', 'vendor']);
  await db.query('BEGIN');
  await vendorSet(g, 0, ravi, 'Ravi Traders');
  await db.query('UPDATE company_vendors SET member_id=$1 WHERE id=$2', [g.memberIds[4], ravi]);
  await vendorSet(g, 1, mine, 'A Hardware');
  await vendorSet(g, 2, other, 'B Paints');
  await vendorSet(h, 0, hv, 'Other Co Vendor');
  await db.query('COMMIT');
});
afterAll(async () => {
  if (db) {
    await db.query('DELETE FROM groups WHERE id=ANY($1)', [[g.groupId, h.groupId]]);
    await db.end();
  }
});

describe('vendor orders', () => {
  it('numbers orders per company and keeps the number on edit', () =>
    isolated(async () => {
      const a = await setOrder(0, ravi);
      const b = await setOrder(1, mine);
      const c = await setOrder(0, hv, randomUUID(), { items }, h);
      const no = async (id: string) =>
        (await db.query('SELECT order_no FROM company_vendor_orders WHERE id=$1', [id])).rows[0]
          .order_no;
      expect([await no(a), await no(b), await no(c)]).toEqual([1, 2, 1]);
      await db.query('UPDATE company_vendor_orders SET order_no=9 WHERE id=$1', [a]);
      expect(await no(a)).toBe(1);
    }));

  it('stores items and a first history event; editing replaces items while sent', () =>
    isolated(async () => {
      const id = await setOrder(0, ravi);
      const live = () =>
        db.query(
          'SELECT name,qty::text FROM company_vendor_order_items WHERE order_id=$1 AND deleted_at IS NULL ORDER BY position',
          [id],
        );
      expect((await live()).rows).toEqual([
        { name: 'Cement', qty: '10.500' },
        { name: 'Sand', qty: '2.000' },
      ]);
      await setOrder(0, ravi, id, { items: [items[1]], note: 'rush' });
      expect((await live()).rows).toHaveLength(1);
      expect(
        (
          await db.query(
            'SELECT count(*)::int n FROM company_vendor_order_events WHERE order_id=$1',
            [id],
          )
        ).rows[0].n,
      ).toBe(1);
      await setOrder(0, ravi, id, { items: [items[1]], note: 'rush' }); // replay
      await status(4, id, 'accepted');
      await denied(() => setOrder(0, ravi, id, { items }));
    }));

  it('who sees which orders; cross-company isolation', () =>
    isolated(async () => {
      const a = await setOrder(0, ravi);
      const b = await setOrder(1, mine);
      const c = await setOrder(2, other);
      const d = await setOrder(0, hv, randomUUID(), { items }, h);
      expect((await seen(0)).sort()).toEqual([a, b, c].sort());
      expect(await seen(1)).toEqual([b]);
      expect(await seen(2)).toEqual([c]);
      expect(await seen(3)).toEqual([]);
      expect(await seen(4)).toEqual([a]);
      expect(await seen(0, h)).toEqual([d]);
      expect(await seen(1, h)).toEqual([]);
      const itemRows = await userIn(
        g,
        4,
        async () => (await db.query('SELECT order_id FROM company_vendor_order_items')).rows.length,
      );
      expect(itemRows).toBe(2);
      await denied(() => status(0, d, 'cancelled'));
      await denied(() => setOrder(0, hv));
    }));

  it('only the right people may create or touch orders', () =>
    isolated(async () => {
      await denied(() => setOrder(3, ravi));
      await denied(() => setOrder(4, ravi));
      await denied(() => setOrder(2, mine)); // another manager's vendor
      const a = await setOrder(0, ravi);
      const b = await setOrder(1, mine);
      await denied(() => status(4, b, 'accepted')); // vendor cannot touch another vendor's order
      await denied(() => status(2, b, 'cancelled'));
      await denied(() => status(3, a, 'cancelled'));
      await denied(() =>
        userIn(g, 4, () =>
          db.query("UPDATE company_vendor_orders SET status='delivered' WHERE id=$1", [a]),
        ),
      );
    }));

  it('status transitions: valid ones work, invalid ones are refused', () =>
    isolated(async () => {
      const a = await setOrder(0, ravi);
      await denied(() => status(4, a, 'delivered')); // not accepted yet
      await denied(() => status(0, a, 'accepted')); // company cannot accept
      await status(4, a, 'accepted');
      await status(4, a, 'accepted'); // replay is a no-op
      await denied(() => status(4, a, 'rejected'));
      await denied(() => status(0, a, 'delivered'));
      await status(4, a, 'delivered');
      expect(await st(a)).toBe('delivered');
      await denied(() => status(0, a, 'cancelled'));
      const b = await setOrder(0, ravi);
      await status(4, b, 'rejected');
      await denied(() => status(4, b, 'accepted'));
      await denied(() => status(0, b, 'cancelled'));
      const c = await setOrder(1, mine);
      await status(1, c, 'cancelled');
      expect(await st(c)).toBe('cancelled');
      const d = await setOrder(0, ravi);
      await status(4, d, 'accepted');
      await status(0, d, 'cancelled');
      const ev = await db.query(
        'SELECT status FROM company_vendor_order_events WHERE order_id=$1 ORDER BY at, status',
        [d],
      );
      expect(ev.rows.map((r) => r.status).sort()).toEqual(['accepted', 'cancelled', 'sent']);
    }));

  it('rejects bad items and never touches the vendor balance', () =>
    isolated(async () => {
      await denied(() => setOrder(0, ravi, randomUUID(), { items: [] }));
      await denied(() => setOrder(0, ravi, randomUUID(), { items: [{ ...items[0], qty: '0' }] }));
      await denied(() =>
        setOrder(0, ravi, randomUUID(), { items: [{ ...items[0], qty: '1.2345' }] }),
      );
      await denied(() =>
        setOrder(0, ravi, randomUUID(), { items: [{ ...items[0], unit: 'tons' }] }),
      );
      await denied(() =>
        setOrder(0, ravi, randomUUID(), { items: [{ ...items[0], unitPrice: '-1' }] }),
      );
      await setOrder(0, ravi);
      expect(
        (
          await db.query('SELECT count(*)::int n FROM company_vendor_entries WHERE group_id=$1', [
            g.groupId,
          ])
        ).rows[0].n,
      ).toBe(0);
    }));
});
