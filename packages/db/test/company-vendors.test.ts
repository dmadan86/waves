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
    db.query('SELECT waves_company_vendor_set($1,$2,$3)', [g.groupId, id, JSON.stringify({ name })]),
  );
const line = (caller: number, vendor: string, kind: string, amount: string, id = randomUUID()) =>
  user(caller, async () => {
    await db.query('SELECT waves_company_vendor_entry_create($1,$2,$3,$4,$5)', [
      g.groupId,
      id,
      vendor,
      kind,
      JSON.stringify({ amount, occurredOn: '2026-11-10' }),
    ]);
    return id;
  });
const vendorsSeenBy = (caller: number) =>
  user(caller, async () =>
    (await db.query('SELECT id FROM company_vendors ORDER BY name')).rows.map((r) => r.id as string),
  );
const linesSeenBy = (caller: number) =>
  user(caller, async () => (await db.query('SELECT id FROM company_vendor_entries')).rows.length);

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

describe('company vendors: who sees what', () => {
  it('owner sees every vendor, a manager only their own, an employee none, a vendor only itself', () =>
    isolated(async () => {
      expect(await vendorsSeenBy(0)).toHaveLength(3);
      expect(await vendorsSeenBy(1)).toEqual([mine]);
      expect(await vendorsSeenBy(2)).toEqual([other]);
      expect(await vendorsSeenBy(3)).toEqual([]);
      expect(await vendorsSeenBy(4)).toEqual([ravi]);
    }));

  it('ledger lines follow the same walls', () =>
    isolated(async () => {
      await line(0, ravi, 'bill', '1200000');
      await line(1, mine, 'bill', '500');
      await line(2, other, 'bill', '700');
      expect(await linesSeenBy(0)).toBe(3);
      expect(await linesSeenBy(1)).toBe(1);
      expect(await linesSeenBy(2)).toBe(1);
      expect(await linesSeenBy(3)).toBe(0);
      expect(await linesSeenBy(4)).toBe(1);
    }));

  it('an employee and another manager cannot add vendors, lines or invites', () =>
    isolated(async () => {
      await denied(() => addVendor(3, randomUUID(), 'X'));
      await denied(() => line(3, ravi, 'bill', '10'));
      await denied(() => line(2, mine, 'payment', '10'));
      await denied(() =>
        user(2, () => db.query('SELECT waves_company_vendor_invite($1)', [mine])),
      );
    }));

  it('a vendor adds only a pending bill, which counts only once confirmed', () =>
    isolated(async () => {
      await denied(() => line(4, ravi, 'payment', '10'));
      await denied(() => line(4, mine, 'bill', '10'));
      const id = await line(4, ravi, 'bill', '900');
      const row = (await db.query('SELECT status,version FROM company_vendor_entries WHERE id=$1', [id])).rows[0];
      expect(row.status).toBe('pending');
      await denied(() =>
        user(4, () => db.query("SELECT waves_company_vendor_entry_review($1,'approved',NULL,$2)", [id, row.version])),
      );
      await denied(() =>
        user(2, () => db.query("SELECT waves_company_vendor_entry_review($1,'approved',NULL,$2)", [id, row.version])),
      );
      await user(0, () =>
        db.query("SELECT waves_company_vendor_entry_review($1,'approved',NULL,$2)", [id, row.version]),
      );
      expect((await db.query('SELECT status FROM company_vendor_entries WHERE id=$1', [id])).rows[0].status).toBe('approved');
    }));

  it('a vendor can mark a payment received but never change its amount', () =>
    isolated(async () => {
      const id = await line(0, ravi, 'payment', '300');
      await user(4, () => db.query('SELECT waves_company_vendor_entry_received($1,true)', [id]));
      expect((await db.query('SELECT received_at FROM company_vendor_entries WHERE id=$1', [id])).rows[0].received_at).not.toBeNull();
      await denied(() => user(4, () => db.query('UPDATE company_vendor_entries SET amount=1 WHERE id=$1', [id])));
      await denied(() => user(1, () => db.query('SELECT waves_company_vendor_entry_received($1,true)', [id])));
    }));

  it('a vendor login can never create employee entries', () =>
    isolated(async () => {
      await denied(() =>
        user(4, () =>
          db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [
            g.groupId, randomUUID(), g.memberIds[4], 'expense',
            JSON.stringify({ amount: '100', occurredOn: '2026-11-10' }),
          ]),
        ),
      );
    }));

  it("a manager's vendor payments come out of that manager's pool; bills do not", () =>
    isolated(async () => {
      await line(1, mine, 'bill', '1000');
      await line(1, mine, 'payment', '400');
      await line(1, mine, 'advance', '100');
      const b = (
        await user(1, () => db.query('SELECT waves_company_pool_balance($1,$2) AS b', [g.groupId, g.memberIds[1]]))
      ).rows[0].b;
      expect(b.vendorPaid).toBe('500');
      expect(b.balance).toBe('-500');
    }));

  it('an invite link makes the joiner that vendor and nothing else', () =>
    isolated(async () => {
      const token = (await user(1, () => db.query('SELECT waves_company_vendor_invite($1) AS t', [mine]))).rows[0].t;
      expect(token).toHaveLength(64);
      const inv = (await db.query("SELECT id FROM invites WHERE company_vendor_id=$1", [mine])).rows[0].id;
      const profile = randomUUID();
      await db.query("INSERT INTO profiles (id, display_name, default_currency) VALUES ($1,'New vendor','INR')", [profile]);
      const res = (await db.query('SELECT waves_join_via_invite($1,$2) AS r', [inv, profile])).rows[0].r;
      expect(res.ok).toBe(true);
      const m = (await db.query('SELECT role::text AS role, manager_id FROM group_members WHERE id=$1', [res.member_id])).rows[0];
      expect(m.role).toBe('vendor');
      expect(m.manager_id).toBeNull();
      expect((await db.query('SELECT member_id FROM company_vendors WHERE id=$1', [mine])).rows[0].member_id).toBe(res.member_id);
      // The link is single use.
      const again = (await db.query('SELECT waves_join_via_invite($1,$2) AS r', [inv, randomUUID()])).rows[0].r;
      expect(again.ok).toBe(false);
    }));
});
