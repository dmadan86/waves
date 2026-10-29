import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

// Members: 0 owner, 1 owner, 2 manager, 3 employee (team of 2), 4 employee (owners), 5 manager (no team).
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
const site = randomUUID();

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
async function denied(run: () => Promise<unknown>, pattern?: RegExp) {
  await db.query('SAVEPOINT expected_failure');
  try {
    const error = await expectDenied(run());
    if (pattern) expect(String(error)).toMatch(pattern);
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT expected_failure');
  }
}
const paid = (caller: number, extra: Record<string, unknown> = {}, id = randomUUID()) =>
  user(caller, async () => {
    await db.query('SELECT waves_company_entry_create($1,$2,NULL,$3,$4)', [
      g.groupId,
      id,
      'expense',
      JSON.stringify({
        paidByCompany: true,
        amount: '300',
        category: 'materials',
        occurredOn: '2026-11-10',
        ...extra,
      }),
    ]);
    return id;
  });
const visible = (caller: number) =>
  user(caller, async () =>
    (await db.query('SELECT id FROM company_entries ORDER BY id')).rows.map((r) => r.id as string),
  );
const pool = (caller: number, manager: number) =>
  user(caller, async () =>
    (
      await db.query('SELECT waves_company_pool_balance($1,$2) AS b', [
        g.groupId,
        g.memberIds[manager],
      ])
    ).rows[0].b as Record<string, string>,
  );
const allocate = (manager: number, amount: string) =>
  user(0, () =>
    db.query('SELECT waves_company_pool_post($1,$2,$3,$4,$5,NULL,$6,NULL)', [
      g.groupId,
      randomUUID(),
      g.memberIds[manager],
      'allocation',
      amount,
      '2026-11-01',
    ]),
  );

beforeAll(async () => {
  db = await connect();
  g = await seedGroup(db, { memberCount: 6 });
  await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
  g.groupId = randomUUID();
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
    [g.groupId, g.profileIds[0]],
  );
  const roles = ['admin', 'admin', 'manager', 'member', 'member', 'manager'];
  for (let i = 0; i < 6; i++)
    await db.query(
      'INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)',
      [g.memberIds[i], g.groupId, g.profileIds[i], roles[i], i === 3 ? g.memberIds[2] : null],
    );
  await db.query('BEGIN');
  await user(0, () =>
    db.query('SELECT waves_company_project_set($1,$2,$3)', [
      g.groupId,
      site,
      JSON.stringify({ name: 'Site A', budgetMinor: '5000', archived: false }),
    ]),
  );
  await db.query('COMMIT');
});
afterAll(async () => {
  if (db) await db.end();
});

describe('company paid directly: who records and who sees', () => {
  it('an owner records one: no employee, no funding, seen by owners only', () =>
    isolated(async () => {
      const id = await paid(0, { vendor: 'Sharma Traders', projectId: site });
      const row = (await db.query('SELECT * FROM company_entries WHERE id=$1', [id])).rows[0];
      expect(row.paid_by_company).toBe(true);
      expect(row.member_id).toBeNull();
      expect(row.funding_manager_id).toBeNull();
      expect(row.status).toBe('approved');
      expect(await visible(0)).toContain(id);
      expect(await visible(1)).toContain(id);
      for (const i of [2, 3, 4, 5]) expect(await visible(i)).not.toContain(id);
    }));
  it('a manager records one: pool-funded, seen by them and owners, not by other managers', () =>
    isolated(async () => {
      const id = await paid(2);
      const row = (await db.query('SELECT * FROM company_entries WHERE id=$1', [id])).rows[0];
      expect(row.funding_manager_id).toBe(g.memberIds[2]);
      expect(row.created_by).toBe(g.memberIds[2]);
      expect(await visible(2)).toContain(id);
      expect(await visible(0)).toContain(id);
      for (const i of [3, 4, 5]) expect(await visible(i)).not.toContain(id);
    }));
  it('an employee cannot record, and bad shapes are refused', () =>
    isolated(async () => {
      await denied(() => paid(3), /NOT_ALLOWED/);
      await denied(() => paid(4), /NOT_ALLOWED/);
      await denied(() =>
        user(0, () =>
          db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [
            g.groupId,
            randomUUID(),
            g.memberIds[3],
            'expense',
            JSON.stringify({ paidByCompany: true, amount: '5', occurredOn: '2026-11-10' }),
          ]),
        ),
      );
      await denied(() =>
        user(0, () =>
          db.query('SELECT waves_company_entry_create($1,$2,NULL,$3,$4)', [
            g.groupId,
            randomUUID(),
            'expense',
            JSON.stringify({ amount: '5', occurredOn: '2026-11-10' }),
          ]),
        ),
      );
      await denied(() =>
        user(0, () =>
          db.query('SELECT waves_company_entry_create($1,$2,NULL,$3,$4)', [
            g.groupId,
            randomUUID(),
            'advance',
            JSON.stringify({ paidByCompany: true, amount: '5', occurredOn: '2026-11-10' }),
          ]),
        ),
      );
      await denied(() => paid(0, { fundingManagerId: g.memberIds[2] }));
    }));
  it('is never sent for approval and creates no balance for anyone', () =>
    isolated(async () => {
      await db.query('UPDATE groups SET company_approvals_enabled=true WHERE id=$1', [g.groupId]);
      const id = await paid(2);
      expect(
        (await db.query('SELECT status FROM company_entries WHERE id=$1', [id])).rows[0].status,
      ).toBe('approved');
      await denied(
        () =>
          user(0, () =>
            db.query("SELECT waves_company_entry_transition($1,'approved',NULL,1)", [id]),
          ),
        /INVALID_TRANSITION/,
      );
    }));
  it('a manager spends from their cash pool', () =>
    isolated(async () => {
      await allocate(2, '1000');
      const id = await paid(2);
      expect(await pool(2, 2)).toMatchObject({ balance: '700', companySpend: '300', ownSpend: '0' });
      await user(2, () => db.query('SELECT waves_company_entry_void($1,$2)', [id, 'oops']));
      expect((await pool(0, 2)).balance).toBe('1000');
    }));
  it('an owner-paid entry leaves every pool untouched', () =>
    isolated(async () => {
      await allocate(2, '1000');
      await paid(0);
      expect((await pool(0, 2)).balance).toBe('1000');
    }));
  it('counts toward the site report', () =>
    isolated(async () => {
      await paid(0, { projectId: site });
      await paid(2, { projectId: site, amount: '200' });
      const report = await user(0, async () =>
        (
          await db.query('SELECT waves_company_project_report($1,$2,$3) AS r', [
            g.groupId,
            '2026-11-01',
            '2026-11-30',
          ])
        ).rows[0].r,
      );
      expect(report.projects[0].spent).toBe('500');
    }));
});

describe('company paid directly: editing', () => {
  it('only owners and the recording manager change or void it', () =>
    isolated(async () => {
      const id = await paid(2);
      await user(2, () =>
        db.query('SELECT waves_company_entry_update($1,$2)', [id, JSON.stringify({ amount: '350' })]),
      );
      await user(0, () =>
        db.query('SELECT waves_company_entry_update($1,$2)', [id, JSON.stringify({ note: 'x' })]),
      );
      for (const i of [3, 4, 5]) {
        await denied(() =>
          user(i, () =>
            db.query('SELECT waves_company_entry_update($1,$2)', [id, JSON.stringify({ amount: '1' })]),
          ),
        );
        await denied(() => user(i, () => db.query('SELECT waves_company_entry_void($1,$2)', [id, 'x'])));
      }
      // An owner's entry is not editable by a manager.
      const owned = await paid(0);
      await denied(() =>
        user(2, () =>
          db.query('SELECT waves_company_entry_update($1,$2)', [owned, JSON.stringify({ amount: '1' })]),
        ),
      );
      // The payer mode and recorder never change.
      await denied(() => db.query('UPDATE company_entries SET created_by=$2 WHERE id=$1', [id, g.memberIds[5]]), /IMMUTABLE/);
      await denied(() => db.query('UPDATE company_entries SET paid_by_company=false WHERE id=$1', [id]));
      await denied(() => db.query('UPDATE company_entries SET member_id=$2 WHERE id=$1', [id, g.memberIds[3]]));
      await denied(() =>
        user(0, () =>
          db.query('SELECT waves_company_entry_update($1,$2)', [id, JSON.stringify({ paidByCompany: false })]),
        ),
      );
    }));
  it('retries are idempotent and a changed payload conflicts', () =>
    isolated(async () => {
      const id = await paid(2);
      await paid(2, {}, id);
      await denied(() => paid(2, { amount: '301' }, id), /IDEMPOTENCY_CONFLICT/);
      await denied(() => paid(5, {}, id));
    }));
  it('cannot be paid back through reimbursement or wages', () =>
    isolated(async () => {
      const id = await paid(0);
      await denied(() =>
        user(0, () =>
          db.query('SELECT waves_company_reimburse($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
            g.groupId,
            randomUUID(),
            g.memberIds[3],
            JSON.stringify([{ entryId: id }]),
            '[]',
            '2026-11-30',
            '2026-11-30',
            '300',
            null,
          ]),
        ),
      );
    }));
});

describe('company paid directly: receipts', () => {
  const path = (entry: string) => `${entry}/${randomUUID()}/${randomUUID()}.jpg`;
  it('lets the owner and the recording manager reserve a receipt, nobody else', () =>
    isolated(async () => {
      const id = await paid(2);
      const store = (profile: number) =>
        db.query('SELECT waves_company_storage_write($1,$2,$3,$4,$5,false)', [
          g.profileIds[profile],
          g.groupId,
          path(id),
          1000,
          'image/jpeg',
        ]);
      await store(2);
      await store(0);
      for (const i of [3, 4, 5]) await denied(() => store(i), /NOT_ALLOWED/);
    }));
});
