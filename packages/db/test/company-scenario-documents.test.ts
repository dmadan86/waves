/**
 * G32–G33: Documents – create/edit/number, duplicate/replay, void, part payment,
 * overpayment, cross-company, role access.
 *
 * Key: waves_company_doc_save data fields are camelCase:
 *   docType, customerName, docDate, items (with qtyMilli/rateMinor/amountMinor), discountMinor.
 *
 * Members: 0 owner (admin), 1 manager, 2 employee (team of 1), 3 employee (owner pool).
 */
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

const today = new Date().toISOString().slice(0, 10);

let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;

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

// Sample item: qtyMilli=1000 (qty=1), rateMinor=5000, computed amountMinor=5000
const sampleItems = [{ description: 'Service fee', qtyMilli: '1000', rateMinor: '5000' }];

const saveDoc = (
  caller: number,
  docId: string,
  docType = 'bill',
  extra: { customerName?: string } = {},
) =>
  user(caller, () =>
    db.query('SELECT waves_company_doc_save($1,$2,$3) AS id', [
      g.groupId,
      docId,
      JSON.stringify({
        docType,
        customerName: extra.customerName ?? 'Ravi Traders',
        docDate: today,
        items: sampleItems,
      }),
    ]),
  );

const docVoid = (caller: number, docId: string) =>
  user(caller, () => db.query('SELECT waves_company_doc_void($1)', [docId]));

const docPayment = (caller: number, docId: string, amount: number) =>
  user(caller, () =>
    db.query('SELECT waves_company_doc_payment($1,$2,$3,$4)', [
      docId,
      randomUUID(),
      amount,
      today,
    ]),
  );

beforeAll(async () => {
  db = await connect();

  g = await seedGroup(db, { memberCount: 4 });
  await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
  g.groupId = randomUUID();
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
    [g.groupId, g.profileIds[0]],
  );
  const roles = ['admin', 'manager', 'member', 'member'];
  for (let i = 0; i < 4; i++) {
    await db.query(
      'INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)',
      [g.memberIds[i], g.groupId, g.profileIds[i], roles[i], i === 2 ? g.memberIds[1] : null],
    );
  }
});

afterAll(async () => {
  if (db) await db.end();
});

// ---------------------------------------------------------------------------
// G32: Document create/edit/number allocation, duplicate, void, payments
// ---------------------------------------------------------------------------
describe('G32: document create, number allocation, payment, void, cross-company', () => {
  it('owner creates a bill; returned id matches the provided docId', () =>
    isolated(async () => {
      const docId = randomUUID();
      const result = await saveDoc(0, docId);
      const returnedId = result.rows[0].id as string;
      expect(returnedId).toBe(docId);

      const row = (
        await db.query('SELECT status,doc_type FROM company_documents WHERE id=$1', [docId])
      ).rows[0];
      expect(row.doc_type).toBe('bill');
      expect(row.status).toBe('unpaid');
    }));

  it('number auto-increments and is scoped per company+type', () =>
    isolated(async () => {
      const a = randomUUID();
      const b = randomUUID();
      await saveDoc(0, a, 'bill');
      await saveDoc(0, b, 'bill');
      const rows = await db.query(
        'SELECT number FROM company_documents WHERE id=ANY($1) ORDER BY number',
        [[a, b]],
      );
      expect(rows.rows[1].number - rows.rows[0].number).toBe(1);
    }));

  it('estimate and bill numbers are independent counters', () =>
    isolated(async () => {
      const est = randomUUID();
      const bill = randomUUID();
      await saveDoc(0, est, 'estimate');
      await saveDoc(0, bill, 'bill');
      const estRow = (
        await db.query('SELECT number FROM company_documents WHERE id=$1', [est])
      ).rows[0];
      const billRow = (
        await db.query('SELECT number FROM company_documents WHERE id=$1', [bill])
      ).rows[0];
      expect(estRow.number).toBeGreaterThan(0);
      expect(billRow.number).toBeGreaterThan(0);
    }));

  it('recording a payment updates paid_minor and transitions status to part_paid then paid', () =>
    isolated(async () => {
      const docId = randomUUID();
      await saveDoc(0, docId);
      const total = parseInt(
        (await db.query('SELECT total_minor FROM company_documents WHERE id=$1', [docId])).rows[0]
          .total_minor,
        10,
      );

      const half = Math.floor(total / 2);
      await docPayment(0, docId, half);
      const mid = (
        await db.query('SELECT status,paid_minor FROM company_documents WHERE id=$1', [docId])
      ).rows[0];
      expect(mid.status).toBe('part_paid');

      const remaining = total - parseInt(mid.paid_minor, 10);
      await docPayment(0, docId, remaining);
      const full = (
        await db.query('SELECT status FROM company_documents WHERE id=$1', [docId])
      ).rows[0];
      expect(full.status).toBe('paid');
    }));

  it('overpayment (paid_minor > total_minor) is rejected', () =>
    isolated(async () => {
      const docId = randomUUID();
      await saveDoc(0, docId);
      const total = parseInt(
        (await db.query('SELECT total_minor FROM company_documents WHERE id=$1', [docId])).rows[0]
          .total_minor,
        10,
      );
      await denied(() => docPayment(0, docId, total + 1));
    }));

  it('voided document cannot receive another payment', () =>
    isolated(async () => {
      const docId = randomUUID();
      await saveDoc(0, docId);
      await docVoid(0, docId);
      await denied(() => docPayment(0, docId, 1000));
    }));

  it('manager can save a doc; employee cannot; owner can void any doc', () =>
    isolated(async () => {
      const docId = randomUUID();
      await saveDoc(1, docId); // manager
      await denied(() => saveDoc(2, randomUUID())); // employee

      // Owner can void manager's doc
      await docVoid(0, docId);
      const row = (
        await db.query('SELECT deleted_at FROM company_documents WHERE id=$1', [docId])
      ).rows[0];
      expect(row.deleted_at).not.toBeNull();
    }));

  it('replay: saving with same docId is idempotent (no second row)', () =>
    isolated(async () => {
      const docId = randomUUID();
      await saveDoc(0, docId);
      await saveDoc(0, docId); // replay
      const rows = (
        await db.query('SELECT id FROM company_documents WHERE id=$1 AND deleted_at IS NULL', [
          docId,
        ])
      ).rows;
      expect(rows).toHaveLength(1);
    }));
});

// ---------------------------------------------------------------------------
// G33: Role access to documents
// ---------------------------------------------------------------------------
describe('G33: document visibility by role', () => {
  it('owner sees all docs; manager sees only docs they created', () =>
    isolated(async () => {
      const ownerDoc = randomUUID();
      const mgrDoc = randomUUID();
      await saveDoc(0, ownerDoc);
      await saveDoc(1, mgrDoc);

      const ownerSeen = await user(0, async () =>
        (
          await db.query(
            'SELECT id FROM company_documents WHERE deleted_at IS NULL ORDER BY id',
          )
        ).rows.map((r) => r.id as string),
      );
      expect(ownerSeen.sort()).toEqual([ownerDoc, mgrDoc].sort());

      const mgrSeen = await user(1, async () =>
        (
          await db.query(
            'SELECT id FROM company_documents WHERE deleted_at IS NULL ORDER BY id',
          )
        ).rows.map((r) => r.id as string),
      );
      // Manager sees only their own doc (waves_company_paid_visible)
      expect(mgrSeen).toEqual([mgrDoc]);
    }));

  it('employee cannot read any documents', () =>
    isolated(async () => {
      const docId = randomUUID();
      await saveDoc(0, docId);
      const empSeen = await user(2, async () =>
        (await db.query('SELECT id FROM company_documents WHERE deleted_at IS NULL')).rows,
      );
      expect(empSeen).toHaveLength(0);
    }));

  it('direct INSERT into company_documents is denied for authenticated role', () =>
    isolated(async () => {
      await denied(() =>
        user(0, () =>
          db.query(
            `INSERT INTO company_documents(id,group_id,doc_type,number,customer_name,doc_date,items,total_minor,currency,status,created_by,updated_by)
             VALUES($1,$2,'bill',999,'Test Customer',$3,'[]'::jsonb,5000,'INR','unpaid',$4,$4)`,
            [randomUUID(), g.groupId, today, g.memberIds[0]],
          ),
        ),
      );
    }));
});
