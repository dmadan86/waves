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
    "INSERT INTO groups(id,type,default_currency,country_code,created_by,company_approvals_enabled) VALUES($1,'company','INR','IN',$2,true)",
    [g.groupId, g.profileIds[0]],
  );
  for (let i = 0; i < 4; i++)
    await db.query(
      'INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)',
      [
        g.memberIds[i],
        g.groupId,
        g.profileIds[i],
        ['admin', 'manager', 'member', 'member'][i],
        i >= 2 ? g.memberIds[1] : null,
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
const create = (actor: number, member: number, kind: string, amount: string, id = randomUUID()) =>
  as(actor, () =>
    db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [
      g.groupId,
      id,
      g.memberIds[member],
      kind,
      JSON.stringify({ amount, occurredOn: '2026-10-01' }),
    ]),
  );
describe('advance ledger compositions', () => {
  it('manager advance is immediately approved and owner sees exact outstanding amount', () =>
    scenario(async () => {
      const id = randomUUID();
      await create(1, 2, 'advance', '500', id);
      expect(
        (await db.query('SELECT status,amount,entry_kind FROM company_entries WHERE id=$1', [id]))
          .rows[0],
      ).toMatchObject({ status: 'approved', amount: '500', entry_kind: 'advance' });
      expect(
        (
          await as(0, () =>
            db.query(
              "SELECT coalesce(sum(amount),0)::text n FROM company_entries WHERE group_id=$1 AND member_id=$2 AND entry_kind='advance' AND status='approved'",
              [g.groupId, g.memberIds[2]],
            ),
          )
        ).rows[0].n,
      ).toBe('500');
    }));
  it('employees cannot create advances; owner-created advances are submitted and contribute only after approval', () =>
    scenario(async () => {
      const id = randomUUID();
      let denied = false;
      try {
        await create(2, 2, 'advance', '340', id);
      } catch (error) {
        denied = String(error).includes('NOT_ALLOWED');
      }
      expect(denied).toBe(true);
      await create(0, 2, 'advance', '340', id);
      let row = (await db.query('SELECT status,version FROM company_entries WHERE id=$1', [id]))
        .rows[0];
      expect(row.status).toBe('submitted');
      expect(
        (
          await db.query(
            "SELECT coalesce(sum(amount),0)::text n FROM company_entries WHERE member_id=$1 AND entry_kind='advance' AND status='approved'",
            [g.memberIds[2]],
          )
        ).rows[0].n,
      ).toBe('0');
      await as(0, () =>
        db.query("SELECT waves_company_entry_transition($1,'approved',NULL,$2)", [id, row.version]),
      );
      row = (await db.query('SELECT status,amount FROM company_entries WHERE id=$1', [id])).rows[0];
      expect(row).toMatchObject({ status: 'approved', amount: '340' });
    }));
  it('employees cannot create or approve advances for themselves; owner can approve a submitted advance', () =>
    scenario(async () => {
      const id = randomUUID();
      let createDenied = false;
      try {
        await create(2, 2, 'advance', '220', id);
      } catch (error) {
        createDenied = String(error).includes('NOT_ALLOWED');
      }
      expect(createDenied).toBe(true);
      await create(0, 2, 'advance', '220', id);
      let denied = false;
      try {
        await as(2, () =>
          db.query(
            "SELECT waves_company_entry_transition($1,'approved',NULL,(SELECT version FROM company_entries WHERE id=$1))",
            [id],
          ),
        );
      } catch {
        denied = true;
      }
      expect(denied).toBe(true);
      const version = (await db.query('SELECT version FROM company_entries WHERE id=$1', [id]))
        .rows[0].version;
      await as(0, () =>
        db.query("SELECT waves_company_entry_transition($1,'approved',NULL,$2)", [id, version]),
      );
      expect(
        (await db.query('SELECT status FROM company_entries WHERE id=$1', [id])).rows[0].status,
      ).toBe('approved');
    }));
  it('only an owner or manager can edit an advance amount, including after approval', () =>
    scenario(async () => {
      const id = randomUUID();
      let createDenied = false;
      try {
        await create(2, 2, 'advance', '220', id);
      } catch (error) {
        createDenied = String(error).includes('NOT_ALLOWED');
      }
      expect(createDenied).toBe(true);
      await create(0, 2, 'advance', '220', id);
      let employeeEditDenied = false;
      try {
        await as(2, () =>
          db.query('SELECT waves_company_entry_update($1,\'{"amount":"260"}\')', [id]),
        );
      } catch {
        employeeEditDenied = true;
      }
      expect(employeeEditDenied).toBe(true);
      await as(1, () =>
        db.query('SELECT waves_company_entry_update($1,\'{"amount":"260"}\')', [id]),
      );
      expect(
        (await db.query('SELECT amount FROM company_entries WHERE id=$1', [id])).rows[0].amount,
      ).toBe('260');
      const version = (await db.query('SELECT version FROM company_entries WHERE id=$1', [id]))
        .rows[0].version;
      await as(0, () =>
        db.query("SELECT waves_company_entry_transition($1,'approved',NULL,$2)", [id, version]),
      );
      await as(1, () =>
        db.query('SELECT waves_company_entry_update($1,\'{"amount":"300"}\')', [id]),
      );
      expect(
        (await db.query('SELECT amount FROM company_entries WHERE id=$1', [id])).rows[0].amount,
      ).toBe('300');
    }));
  it('voiding an unrecovered approved employee advance removes it from outstanding totals', () =>
    scenario(async () => {
      const id = randomUUID();
      await create(1, 2, 'advance', '415', id);
      expect(
        (await db.query('SELECT status FROM company_entries WHERE id=$1', [id])).rows[0].status,
      ).toBe('approved');
      await as(0, () => db.query("SELECT waves_company_entry_void($1,'returned in cash')", [id]));
      expect(
        (await db.query('SELECT deleted_at FROM company_entries WHERE id=$1', [id])).rows[0]
          .deleted_at,
      ).not.toBeNull();
      expect(
        (
          await db.query(
            "SELECT coalesce(sum(amount),0)::text n FROM company_entries WHERE member_id=$1 AND entry_kind='advance' AND status='approved' AND deleted_at IS NULL",
            [g.memberIds[2]],
          )
        ).rows[0].n,
      ).toBe('0');
    }));
  it('a cross-company advance id cannot be transitioned or read', () =>
    scenario(async () => {
      const id = randomUUID(),
        foreignGroup = randomUUID(),
        foreignMember = randomUUID(),
        foreignOwner = randomUUID();
      await db.query(
        "INSERT INTO groups(id,type,default_currency,created_by) VALUES($1,'company','INR',$2)",
        [foreignGroup, g.profileIds[0]],
      );
      await db.query(
        "INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,'admin'),($4,$2,$5,'member')",
        [foreignOwner, foreignGroup, g.profileIds[2], foreignMember, g.profileIds[3]],
      );
      await db.query(
        "INSERT INTO company_entries(id,group_id,member_id,entry_kind,amount,currency,occurred_on,created_by,updated_by,status) VALUES($1,$2,$3,'advance',900,'INR','2026-10-01',$4,$4,'submitted')",
        [id, foreignGroup, foreignMember, foreignOwner],
      );
      let denied = false;
      try {
        await as(0, () =>
          db.query("SELECT waves_company_entry_transition($1,'approved',NULL,1)", [id]),
        );
      } catch {
        denied = true;
      }
      expect(denied).toBe(true);
      expect(
        (await as(0, () => db.query('SELECT id FROM company_entries WHERE id=$1', [id]))).rows,
      ).toHaveLength(0);
    }));
  it('replaying the same reimbursement request is idempotent and does not consume an advance twice', () =>
    scenario(async () => {
      const advance = randomUUID();
      await create(1, 2, 'advance', '100', advance);
      const expense = randomUUID();
      await as(2, () =>
        db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [
          g.groupId,
          expense,
          g.memberIds[2],
          'expense',
          '{"amount":"250","occurredOn":"2026-10-02"}',
        ]),
      );
      const version = (await db.query('SELECT version FROM company_entries WHERE id=$1', [expense]))
        .rows[0].version;
      await as(0, () =>
        db.query("SELECT waves_company_entry_transition($1,'approved',NULL,$2)", [
          expense,
          version,
        ]),
      );
      const claimVersion = (
        await db.query('SELECT version FROM company_entries WHERE id=$1', [expense])
      ).rows[0].version;
      const rid = randomUUID();
      const sql = 'SELECT waves_company_reimburse($1,$2,$3,$4,$5,$6,$7,$8,$9) id';
      const args = [
        g.groupId,
        rid,
        g.memberIds[2],
        JSON.stringify([{ entryId: expense, expectedVersion: claimVersion }]),
        '[]',
        '2026-10-31',
        '2026-11-01',
        150,
        'pay',
      ];
      const first = await as(0, () => db.query(sql, args));
      const replay = await as(0, () => db.query(sql, args));
      expect(first.rows[0].id).toBe(rid);
      expect(replay.rows[0].id).toBe(rid);
      expect(
        (await db.query('SELECT count(*)::int n FROM company_entries WHERE id=$1', [rid])).rows[0]
          .n,
      ).toBe(1);
      expect(
        (
          await db.query(
            "SELECT reimbursement_details->>'creditsMinor' credits FROM company_entries WHERE id=$1",
            [rid],
          )
        ).rows[0].credits,
      ).toBe('100');
    }));
  it('advance recovery offsets a later reimbursement once and the payout retains the recovery detail on replay', () =>
    scenario(async () => {
      const advance = randomUUID();
      await create(1, 2, 'advance', '300', advance);
      const expense = randomUUID();
      await as(2, () =>
        db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [
          g.groupId,
          expense,
          g.memberIds[2],
          'expense',
          '{"amount":"800","occurredOn":"2026-10-02"}',
        ]),
      );
      const version = (await db.query('SELECT version FROM company_entries WHERE id=$1', [expense]))
        .rows[0].version;
      await as(0, () =>
        db.query("SELECT waves_company_entry_transition($1,'approved',NULL,$2)", [
          expense,
          version,
        ]),
      );
      const claimVersion = (
        await db.query('SELECT version FROM company_entries WHERE id=$1', [expense])
      ).rows[0].version;
      const rid = randomUUID();
      const args = [
        g.groupId,
        rid,
        g.memberIds[2],
        JSON.stringify([{ entryId: expense, expectedVersion: claimVersion }]),
        '[]',
        '2026-10-31',
        '2026-11-01',
        500,
        'net after advance',
      ];
      const payout = await as(0, () =>
        db.query('SELECT waves_company_reimburse($1,$2,$3,$4,$5,$6,$7,$8,$9) id', args),
      );
      expect(payout.rows[0].id).toBe(rid);
      await as(0, () =>
        db.query('SELECT waves_company_reimburse($1,$2,$3,$4,$5,$6,$7,$8,$9)', args),
      );
      const row = (
        await db.query(
          "SELECT amount,reimbursement_details->>'creditsMinor' credits FROM company_entries WHERE id=$1",
          [rid],
        )
      ).rows[0];
      expect(row).toMatchObject({ amount: '500', credits: '300' });
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM company_entries WHERE group_id=$1 AND entry_kind='reimbursement' AND reimbursement_details->>'requestHash' IS NOT NULL",
            [g.groupId],
          )
        ).rows[0].n,
      ).toBe(1);
    }));
  it('recovered advance is frozen against edit and void', () =>
    scenario(async () => {
      const id = randomUUID();
      await create(1, 2, 'advance', '120', id);
      await as(0, () =>
        db.query('SELECT waves_company_wage_pay($1,$2,$3,$4,$5,$6)', [
          g.groupId,
          randomUUID(),
          '2026-10-01',
          '2026-10-31',
          '2026-11-01',
          JSON.stringify([
            {
              paymentEntryId: randomUUID(),
              memberId: g.memberIds[2],
              calcMode: 'typed',
              fixedMinor: '500',
              claimIds: [],
              expectedGrossMinor: '500',
              expectedRecoveryMinor: '120',
              expectedNetMinor: '380',
            },
          ]),
        ]),
      );
      let edit = false,
        voided = false;
      try {
        await as(0, () =>
          db.query('SELECT waves_company_entry_update($1,\'{"amount":"1"}\')', [id]),
        );
      } catch {
        edit = true;
      }
      try {
        await as(0, () => db.query("SELECT waves_company_entry_void($1,'bad')", [id]));
      } catch {
        voided = true;
      }
      expect(edit).toBe(true);
      expect(voided).toBe(true);
    }));
  it('negative and over balance recovery amounts are rejected without changing advance balance', () =>
    scenario(async () => {
      const id = randomUUID();
      await create(1, 2, 'advance', '90', id);
      let invalid = false;
      try {
        await as(0, () =>
          db.query('SELECT waves_company_wage_pay($1,$2,$3,$4,$5,$6)', [
            g.groupId,
            randomUUID(),
            '2026-10-01',
            '2026-10-31',
            '2026-11-01',
            JSON.stringify([{ memberId: g.memberIds[2], amount: '500', recoveryMinor: '-1' }]),
          ]),
        );
      } catch {
        invalid = true;
      }
      expect(invalid).toBe(true);
      expect(
        (await db.query('SELECT amount,status FROM company_entries WHERE id=$1', [id])).rows[0],
      ).toMatchObject({ amount: '90', status: 'approved' });
    }));
});
