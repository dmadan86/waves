import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

// Members: 0 owner, 1 manager, 2 employee A, 3 employee B, 4 vendor login, 5 owner of another company.
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
let otherGroup: string;
const clientA = randomUUID(); // owned by employee A
const clientB = randomUUID(); // owned by employee B
const today = new Date().toISOString().slice(0, 10);

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
    await seed();
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
const setClient = (caller: number, id: string, data: Record<string, unknown>) =>
  user(caller, () =>
    db.query('SELECT waves_company_client_set($1,$2,$3)', [g.groupId, id, JSON.stringify(data)]),
  );
const setInq = (
  caller: number,
  id: string,
  client: string,
  data: Record<string, unknown> = {},
  group = g.groupId,
) =>
  user(caller, () =>
    db.query('SELECT waves_company_inquiry_set($1,$2,$3,$4)', [
      group,
      id,
      client,
      JSON.stringify({ title: 'Racks', inquiryDate: today, ...data }),
    ]),
  );
const assign = (caller: number, client: string, members: number[]) =>
  user(caller, () =>
    db.query('SELECT waves_company_client_assign($1,$2,$3::uuid[])', [
      g.groupId,
      client,
      members.map((m) => g.memberIds[m]),
    ]),
  );
const reject = (caller: number, id: string, rejected: boolean, reason: string | null = null) =>
  user(caller, () =>
    db.query('SELECT waves_company_inquiry_reject($1,$2,$3)', [id, rejected, reason]),
  );
const saveDoc = (caller: number, id: string, extra: Record<string, unknown>, type = 'estimate') =>
  user(caller, () =>
    db.query('SELECT waves_company_doc_save($1,$2,$3)', [
      g.groupId,
      id,
      JSON.stringify({
        docType: type,
        customerName: 'Goa Traders',
        docDate: today,
        items: [{ description: 'Rack', qtyMilli: '1000', rateMinor: '5000' }],
        ...extra,
      }),
    ]),
  );
const seenInq = (caller: number) =>
  user(caller, async () =>
    (await db.query('SELECT id FROM company_inquiries ORDER BY number')).rows.map(
      (r) => r.id as string,
    ),
  );
const seenClients = (caller: number) =>
  user(caller, async () =>
    (await db.query('SELECT id FROM company_clients')).rows.map((r) => r.id as string),
  );
const activeAssignees = async (client: string) =>
  (
    await db.query(
      'SELECT member_id FROM company_client_assignees WHERE client_id=$1 AND deleted_at IS NULL',
      [client],
    )
  ).rows
    .map((r) => r.member_id as string)
    .sort();
const seed = async () => {
  await setClient(0, clientA, { name: 'A Client', ownerMemberId: g.memberIds[2] });
  await setClient(1, clientB, { name: 'B Client', ownerMemberId: g.memberIds[3] });
};

beforeAll(async () => {
  db = await connect();
  g = await seedGroup(db, { memberCount: 6 });
  await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
  g.groupId = randomUUID();
  otherGroup = randomUUID();
  for (const [id, owner] of [
    [g.groupId, g.profileIds[0]],
    [otherGroup, g.profileIds[5]],
  ])
    await db.query(
      "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
      [id, owner],
    );
  const roles = ['admin', 'manager', 'member', 'member', 'vendor'];
  for (let i = 0; i < 5; i++)
    await db.query(
      'INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)',
      [
        g.memberIds[i],
        g.groupId,
        g.profileIds[i],
        roles[i],
        i >= 2 && i <= 3 ? g.memberIds[1] : null,
      ],
    );
  await db.query(
    "INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,'admin')",
    [g.memberIds[5], otherGroup, g.profileIds[5]],
  );
});
afterAll(async () => {
  if (db) await db.end();
});

describe('company inquiries: who sees what', () => {
  it('the owner is an assignee of their client; a co-assignee employee sees the client and its inquiries', () =>
    isolated(async () => {
      expect(await activeAssignees(clientA)).toEqual([g.memberIds[2]]);
      const inq = randomUUID();
      await setInq(0, inq, clientA);
      expect(await seenInq(2)).toEqual([inq]);
      expect(await seenInq(3)).toEqual([]);
      // Employee B is added as a second assignee: sees the client and the inquiry; A keeps access.
      await assign(0, clientA, [2, 3]);
      expect(await seenClients(3)).toEqual(expect.arrayContaining([clientA, clientB]));
      expect(await seenInq(3)).toEqual([inq]);
      expect(await seenInq(2)).toEqual([inq]);
      const rows = await user(
        3,
        async () =>
          (
            await db.query('SELECT member_id FROM company_client_assignees WHERE client_id=$1', [
              clientA,
            ])
          ).rows,
      );
      expect(rows).toHaveLength(2);
      // The primary owner is unchanged and still the first.
      const owner = (
        await db.query('SELECT owner_member_id FROM company_clients WHERE id=$1', [clientA])
      ).rows[0];
      expect(owner.owner_member_id).toBe(g.memberIds[2]);
    }));

  it('removing an assignee takes access away; a vendor login and another company never see anything', () =>
    isolated(async () => {
      const inq = randomUUID();
      await setInq(0, inq, clientA);
      await assign(1, clientA, [2, 3]);
      await assign(1, clientA, [2]);
      expect(await activeAssignees(clientA)).toEqual([g.memberIds[2]]);
      expect((await seenClients(3)).includes(clientA)).toBe(false);
      expect(await seenInq(3)).toEqual([]);
      expect(await seenInq(4)).toEqual([]);
      expect(await seenInq(5)).toEqual([]);
      // Re-adding reuses the row (a tombstone is revived), no duplicate.
      await assign(1, clientA, [2, 3]);
      expect(await activeAssignees(clientA)).toEqual([g.memberIds[2], g.memberIds[3]].sort());
      expect(
        (
          await db.query(
            'SELECT count(*)::int n FROM company_client_assignees WHERE client_id=$1',
            [clientA],
          )
        ).rows[0].n,
      ).toBe(2);
    }));

  it('changing the primary owner adds them as an assignee; reassigning without the owner promotes the first', () =>
    isolated(async () => {
      await assign(0, clientA, [2, 3]);
      // The edit form hands the client over: the previous owner is dropped, a co-assignee stays.
      await setClient(0, clientA, { name: 'A Client', ownerMemberId: g.memberIds[1] });
      expect(await activeAssignees(clientA)).toEqual([g.memberIds[1], g.memberIds[3]].sort());
      await assign(0, clientA, [2]);
      const owner = (
        await db.query('SELECT owner_member_id FROM company_clients WHERE id=$1', [clientA])
      ).rows[0];
      expect(owner.owner_member_id).toBe(g.memberIds[2]);
      await assign(0, clientA, []);
      expect(
        (await db.query('SELECT owner_member_id FROM company_clients WHERE id=$1', [clientA]))
          .rows[0].owner_member_id,
      ).toBeNull();
      expect(await activeAssignees(clientA)).toEqual([]);
    }));

  it('only owner and manager assign; unknown, vendor and other-company members are refused', () =>
    isolated(async () => {
      await denied(() => assign(2, clientA, [2, 3]));
      await denied(() => assign(4, clientA, [2]));
      await denied(() => assign(0, clientA, [4]));
      await denied(() =>
        user(0, () =>
          db.query('SELECT waves_company_client_assign($1,$2,$3::uuid[])', [
            g.groupId,
            clientA,
            [g.memberIds[5]],
          ]),
        ),
      );
      await denied(() =>
        user(5, () =>
          db.query('SELECT waves_company_client_assign($1,$2,$3::uuid[])', [
            otherGroup,
            clientA,
            [g.memberIds[5]],
          ]),
        ),
      );
    }));
});

describe('company inquiries: writes', () => {
  it('numbers per company, retries are idempotent, edits keep the number', () =>
    isolated(async () => {
      const a = randomUUID();
      const b = randomUUID();
      await setInq(0, a, clientA, { title: 'First', expectedValue: '120000' });
      await setInq(1, b, clientB, { title: 'Second' });
      await setInq(0, a, clientA, {
        title: 'First (edited)',
        details: 'More',
        expectedValue: '150000',
      });
      const rows = (
        await db.query(
          'SELECT id,number,title,expected_value_minor,version FROM company_inquiries ORDER BY number',
        )
      ).rows;
      expect(rows.map((r) => [r.id, r.number, r.title])).toEqual([
        [a, 1, 'First (edited)'],
        [b, 2, 'Second'],
      ]);
      expect(rows[0].expected_value_minor).toBe('150000');
      expect(rows[0].version).toBe(2);
    }));

  it('an employee adds to their own client only; not on someone else, a lost client or another company', () =>
    isolated(async () => {
      await setInq(2, randomUUID(), clientA);
      await denied(() => setInq(2, randomUUID(), clientB));
      await denied(() => setInq(4, randomUUID(), clientA));
      await denied(() => setInq(5, randomUUID(), clientA, {}, otherGroup));
      await denied(() => setInq(5, randomUUID(), clientA));
      // A co-assignee can add too.
      await assign(0, clientB, [3, 2]);
      await setInq(2, randomUUID(), clientB);
      // A lost client takes no new inquiry from an employee.
      await setClient(0, clientA, {
        name: 'A Client',
        ownerMemberId: g.memberIds[2],
        stage: 'lost',
      });
      await denied(() => setInq(2, randomUUID(), clientA));
      await setInq(0, randomUUID(), clientA);
    }));

  it('refuses bad data and an inquiry id reused under another client or company', () =>
    isolated(async () => {
      const id = randomUUID();
      await setInq(0, id, clientA);
      await denied(() => setInq(0, id, clientB));
      await denied(() => setInq(0, randomUUID(), clientA, { title: '  ' }));
      await denied(() => setInq(0, randomUUID(), clientA, { title: 'x'.repeat(121) }));
      await denied(() => setInq(0, randomUUID(), clientA, { expectedValue: '-5' }));
      await denied(() => setInq(0, randomUUID(), clientA, { inquiryDate: '2026-13-45' }));
      await denied(() => setInq(0, randomUUID(), clientA, { inquiryDate: '1999-01-01' }));
      await denied(() => setInq(0, randomUUID(), clientA, { bogus: 1 }));
    }));

  it('reject needs visibility, is idempotent, and reopening clears the reason', () =>
    isolated(async () => {
      const id = randomUUID();
      await setInq(0, id, clientA);
      await denied(() => reject(3, id, true, 'no'));
      await reject(2, id, true, 'Too costly');
      await reject(2, id, true, 'ignored second reason');
      let r = (
        await db.query(
          'SELECT rejected_at,reject_reason,version FROM company_inquiries WHERE id=$1',
          [id],
        )
      ).rows[0];
      expect(r.rejected_at).not.toBeNull();
      expect(r.reject_reason).toBe('Too costly');
      await reject(2, id, false);
      r = (
        await db.query('SELECT rejected_at,reject_reason FROM company_inquiries WHERE id=$1', [id])
      ).rows[0];
      expect(r.rejected_at).toBeNull();
      expect(r.reject_reason).toBeNull();
    }));

  it('removing is for owner and manager and hides it from the list as a tombstone', () =>
    isolated(async () => {
      const id = randomUUID();
      await setInq(0, id, clientA);
      await denied(() => user(2, () => db.query('SELECT waves_company_inquiry_remove($1)', [id])));
      await user(1, () => db.query('SELECT waves_company_inquiry_remove($1)', [id]));
      expect(
        (await db.query('SELECT deleted_at FROM company_inquiries WHERE id=$1', [id])).rows[0]
          .deleted_at,
      ).not.toBeNull();
      await denied(() => setInq(0, id, clientA));
    }));
});

describe('company inquiries: estimates and bills', () => {
  it('an estimate links to an inquiry of the same client and converting copies the link', () =>
    isolated(async () => {
      const inq = randomUUID();
      const inqB = randomUUID();
      await setInq(0, inq, clientA);
      await setInq(0, inqB, clientB);
      const doc = randomUUID();
      await saveDoc(0, doc, { clientId: clientA, inquiryId: inq });
      expect(
        (await db.query('SELECT inquiry_id FROM company_documents WHERE id=$1', [doc])).rows[0]
          .inquiry_id,
      ).toBe(inq);
      // Another client's inquiry, or no client at all, is refused.
      await denied(() => saveDoc(0, randomUUID(), { clientId: clientA, inquiryId: inqB }));
      await denied(() => saveDoc(0, randomUUID(), { inquiryId: inq }));
      await denied(() => saveDoc(0, doc, { clientId: clientA, inquiryId: inqB }));
      // Absent keeps the link; switching client without naming an inquiry clears the stale link; null clears.
      await saveDoc(0, doc, { clientId: clientA });
      expect(
        (await db.query('SELECT inquiry_id FROM company_documents WHERE id=$1', [doc])).rows[0]
          .inquiry_id,
      ).toBe(inq);
      await saveDoc(0, doc, { clientId: clientB });
      expect(
        (await db.query('SELECT inquiry_id FROM company_documents WHERE id=$1', [doc])).rows[0]
          .inquiry_id,
      ).toBeNull();
      await saveDoc(0, doc, { clientId: clientA, inquiryId: inq });
      const bill = randomUUID();
      await user(0, () => db.query('SELECT waves_company_doc_convert($1,$2)', [doc, bill]));
      const r = (
        await db.query('SELECT inquiry_id,client_id FROM company_documents WHERE id=$1', [bill])
      ).rows[0];
      expect(r).toEqual({ inquiry_id: inq, client_id: clientA });
      await saveDoc(0, randomUUID(), { clientId: clientA, inquiryId: null });
    }));

  it('an inquiry of another company cannot be linked', () =>
    isolated(async () => {
      const foreignClient = randomUUID();
      const foreignInq = randomUUID();
      await db.query(
        "INSERT INTO company_clients(id,group_id,name,created_by) VALUES($1,$2,'Foreign',$3)",
        [foreignClient, otherGroup, g.memberIds[5]],
      );
      await db.query(
        'INSERT INTO company_inquiries(id,group_id,client_id,number,title,created_by,updated_by) VALUES($1,$2,$3,1,$4,$5,$5)',
        [foreignInq, otherGroup, foreignClient, 'Foreign', g.memberIds[5]],
      );
      await denied(() => saveDoc(0, randomUUID(), { clientId: clientA, inquiryId: foreignInq }));
      await denied(() =>
        saveDoc(0, randomUUID(), { clientId: foreignClient, inquiryId: foreignInq }),
      );
    }));
});

describe('company inquiries: backfill', () => {
  it('gives every live client one numbered inquiry, links its documents, rejects lost ones and assigns owners', async () => {
    await db.query('BEGIN');
    try {
      await seed();
      const lost = randomUUID();
      const gone = randomUUID();
      await setClient(0, lost, {
        name: 'Lost Co',
        need: 'Racks',
        stage: 'lost',
        lostReason: 'Price',
      });
      await setClient(0, gone, { name: 'Gone' });
      await user(0, () => db.query('SELECT waves_company_client_remove($1)', [gone]));
      const doc = randomUUID();
      await saveDoc(0, doc, { clientId: clientA });
      // Wipe what the new RPCs made, then run the migration's backfill statements on this "old" data.
      await db.query('UPDATE company_documents SET inquiry_id=NULL');
      await db.query('DELETE FROM company_inquiries');
      await db.query('DELETE FROM company_client_assignees');
      const sql = readFileSync(
        new URL(
          '../prisma/migrations/20261122090000_company_inquiries/migration.sql',
          import.meta.url,
        ),
        'utf8',
      );
      await db.query(sql.slice(sql.indexOf('-- Backfill')));
      const rows = (
        await db.query(
          'SELECT client_id,number,title,rejected_at,reject_reason FROM company_inquiries ORDER BY number',
        )
      ).rows;
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.number)).toEqual([1, 2, 3]);
      expect(rows.some((r) => r.client_id === gone)).toBe(false);
      const l = rows.find((r) => r.client_id === lost)!;
      expect(l.title).toBe('Racks');
      expect(l.reject_reason).toBe('Price');
      expect(l.rejected_at).not.toBeNull();
      const linked = (
        await db.query(
          'SELECT i.client_id FROM company_documents d JOIN company_inquiries i ON i.id=d.inquiry_id WHERE d.id=$1',
          [doc],
        )
      ).rows;
      expect(linked).toEqual([{ client_id: clientA }]);
      expect(await activeAssignees(clientA)).toEqual([g.memberIds[2]]);
      expect(await activeAssignees(clientB)).toEqual([g.memberIds[3]]);
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
