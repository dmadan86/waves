import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

// Members: 0 owner, 1 manager, 2 employee A, 3 employee B, 4 vendor login, 5 owner of another company.
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
let otherGroup: string;
const forA = randomUUID(); // assigned to employee A
const forB = randomUUID(); // assigned to employee B
const unassigned = randomUUID();

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
const seen = (caller: number) =>
  user(caller, async () =>
    (await db.query('SELECT id FROM company_clients ORDER BY name')).rows.map(
      (r) => r.id as string,
    ),
  );
const task = (
  caller: number,
  id: string,
  member: number,
  clientId: string | null,
  title = 'Call',
) =>
  user(caller, () =>
    db.query(
      "SELECT waves_company_work_set($1,$2,$3,current_date,$4,NULL,'todo',NULL,NULL,NULL,$5)",
      [g.groupId, id, g.memberIds[member], title, clientId],
    ),
  );
const seed = async () => {
  await setClient(0, forA, { name: 'A Client', ownerMemberId: g.memberIds[2] });
  await setClient(1, forB, { name: 'B Client', ownerMemberId: g.memberIds[3] });
  await setClient(0, unassigned, { name: 'C Client' });
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

describe('company clients: who sees what', () => {
  it('owner and manager see all, an employee only theirs, a vendor and another company none', () =>
    isolated(async () => {
      expect(await seen(0)).toHaveLength(3);
      expect(await seen(1)).toHaveLength(3);
      expect(await seen(2)).toEqual([forA]);
      expect(await seen(3)).toEqual([forB]);
      expect(await seen(4)).toEqual([]);
      expect(await seen(5)).toEqual([]);
    }));

  it('notes follow the client: visible to who sees it, addable by them, not by others', () =>
    isolated(async () => {
      const note = randomUUID();
      await user(2, () =>
        db.query('SELECT waves_company_client_note_add($1,$2,$3,$4)', [
          g.groupId,
          note,
          forA,
          'Called',
        ]),
      );
      // Same id again is a no-op, not an error.
      await user(2, () =>
        db.query('SELECT waves_company_client_note_add($1,$2,$3,$4)', [
          g.groupId,
          note,
          forA,
          'Called',
        ]),
      );
      const count = (i: number) =>
        user(i, async () => (await db.query('SELECT 1 FROM company_client_notes')).rows.length);
      expect(await count(0)).toBe(1);
      expect(await count(1)).toBe(1);
      expect(await count(2)).toBe(1);
      expect(await count(3)).toBe(0);
      expect(await count(4)).toBe(0);
      await denied(() =>
        user(3, () =>
          db.query('SELECT waves_company_client_note_add($1,$2,$3,$4)', [
            g.groupId,
            randomUUID(),
            forA,
            'x',
          ]),
        ),
      );
      await denied(() =>
        user(4, () =>
          db.query('SELECT waves_company_client_note_add($1,$2,$3,$4)', [
            g.groupId,
            randomUUID(),
            forA,
            'x',
          ]),
        ),
      );
    }));

  it('an employee adds an inquiry for themselves only; vendors and other companies cannot add', () =>
    isolated(async () => {
      const mine = randomUUID();
      await setClient(2, mine, {
        name: 'Walk in',
        ownerMemberId: g.memberIds[2],
        source: 'walk_in',
      });
      expect(await seen(2)).toContain(mine);
      await denied(() => setClient(2, randomUUID(), { name: 'X', ownerMemberId: g.memberIds[3] }));
      await denied(() =>
        setClient(2, randomUUID(), { name: 'X', ownerMemberId: g.memberIds[2], stage: 'client' }),
      );
      await denied(() => setClient(2, forB, { name: 'Hijack', ownerMemberId: g.memberIds[2] }));
      await denied(() => setClient(4, randomUUID(), { name: 'V', ownerMemberId: g.memberIds[4] }));
      await denied(() => setClient(5, randomUUID(), { name: 'Z' }));
      await denied(() => setClient(5, forA, { name: 'Z' }));
    }));

  it('an employee cannot move the stage, reassign or remove; the owner can', () =>
    isolated(async () => {
      await denied(() =>
        setClient(2, forA, { name: 'A', ownerMemberId: g.memberIds[2], stage: 'quoted' }),
      );
      await denied(() => setClient(2, forA, { name: 'A', ownerMemberId: g.memberIds[3] }));
      await setClient(2, forA, { name: 'A edited', ownerMemberId: g.memberIds[2], need: 'Paint' });
      await denied(() => user(2, () => db.query('SELECT waves_company_client_remove($1)', [forA])));
      await user(1, () => db.query('SELECT waves_company_client_remove($1)', [forA]));
      const row = await db.query('SELECT deleted_at FROM company_clients WHERE id=$1', [forA]);
      expect(row.rows[0].deleted_at).not.toBeNull();
    }));

  it('reassigning moves visibility to the new employee', () =>
    isolated(async () => {
      const note = randomUUID();
      await user(0, () =>
        db.query('SELECT waves_company_client_note_add($1,$2,$3,$4)', [
          g.groupId,
          note,
          forA,
          'Hi',
        ]),
      );
      const before = (
        await db.query('SELECT updated_seq FROM company_client_notes WHERE id=$1', [note])
      ).rows[0].updated_seq;
      await setClient(1, forA, { name: 'A Client', ownerMemberId: g.memberIds[3] });
      expect(await seen(2)).toEqual([]);
      expect(await seen(3)).toHaveLength(2);
      // The note is re-stamped so the new owner's next pull carries it.
      const after = (
        await db.query('SELECT updated_seq FROM company_client_notes WHERE id=$1', [note])
      ).rows[0].updated_seq;
      expect(BigInt(after)).toBeGreaterThan(BigInt(before));
    }));

  // The sync function lists these ids per caller; a phone drops any cached client not on its list.
  it('the id list a phone is given drops a reassigned client and its notes, and keeps a removed one', () =>
    isolated(async () => {
      const note = randomUUID();
      await user(0, () =>
        db.query('SELECT waves_company_client_note_add($1,$2,$3,$4)', [
          g.groupId,
          note,
          forA,
          'Hi',
        ]),
      );
      const notes = (caller: number) =>
        user(caller, async () =>
          (await db.query('SELECT id FROM company_client_notes')).rows.map((r) => r.id as string),
        );
      expect(await seen(2)).toContain(forA);
      expect(await notes(2)).toEqual([note]);
      await setClient(1, forA, { name: 'A Client', ownerMemberId: g.memberIds[3] });
      expect(await seen(2)).not.toContain(forA);
      expect(await notes(2)).toEqual([]);
      expect(await seen(3)).toContain(forA);
      // A removal is a tombstone row the phone still receives, so it stays on the list.
      await user(1, () => db.query('SELECT waves_company_client_remove($1)', [forA]));
      expect(await seen(3)).toContain(forA);
    }));
});

describe('company clients: stages', () => {
  it('moves inquiry to quoted to client; lost keeps a reason that is dropped on reopening', () =>
    isolated(async () => {
      const stage = async () =>
        (
          await db.query('SELECT stage,lost_reason,version FROM company_clients WHERE id=$1', [
            forA,
          ])
        ).rows[0];
      await setClient(0, forA, {
        name: 'A Client',
        ownerMemberId: g.memberIds[2],
        stage: 'quoted',
      });
      expect((await stage()).stage).toBe('quoted');
      await setClient(0, forA, { name: 'A Client', stage: 'client', expectedValue: '8500000' });
      expect((await stage()).stage).toBe('client');
      await setClient(0, forA, { name: 'A Client', stage: 'lost', lostReason: 'Too costly' });
      expect(await stage()).toMatchObject({ stage: 'lost', lost_reason: 'Too costly' });
      await setClient(0, forA, { name: 'A Client', stage: 'inquiry', lostReason: 'ignored' });
      expect(await stage()).toMatchObject({ stage: 'inquiry', lost_reason: null });
      expect(Number((await stage()).version)).toBe(5);
    }));

  it('rejects a bad stage, source, value or unknown field', () =>
    isolated(async () => {
      await denied(() => setClient(0, forA, { name: 'A', stage: 'won' }));
      await denied(() => setClient(0, forA, { name: 'A', source: 'tv' }));
      await denied(() => setClient(0, forA, { name: 'A', expectedValue: '-5' }));
      await denied(() => setClient(0, forA, { name: ' ' }));
      await denied(() => setClient(0, forA, { name: 'A', secret: 1 }));
      await denied(() => setClient(0, forA, { name: 'A', ownerMemberId: g.memberIds[4] }));
    }));
});

describe('follow-up tasks and documents link to a client', () => {
  it('the owner and the employee themself can add a follow-up; others cannot link', () =>
    isolated(async () => {
      const t1 = randomUUID();
      const t2 = randomUUID();
      await task(0, t1, 2, forA);
      await task(2, t2, 2, forA, 'Call back');
      const rows = (
        await db.query('SELECT id,client_id FROM company_work_tasks WHERE id=ANY($1)', [[t1, t2]])
      ).rows;
      expect(rows.map((r) => r.client_id)).toEqual([forA, forA]);
      // Employee B cannot see client A, so cannot link a task to it; nor can employee A link B's client.
      await denied(() => task(3, randomUUID(), 3, forA));
      await denied(() => task(2, randomUUID(), 2, forB));
      // Cross-company: the other owner cannot link to this company's client.
      await denied(() => task(5, randomUUID(), 5, forA));
    }));

  it('the owner can follow up themself; a plain task still needs an employee', () =>
    isolated(async () => {
      await task(0, randomUUID(), 0, forA);
      await denied(() => task(0, randomUUID(), 0, null));
    }));

  it('editing a task without naming a client keeps the link (10-argument form); null unlinks', () =>
    isolated(async () => {
      const id = randomUUID();
      await task(0, id, 2, forA);
      await user(0, () =>
        db.query(
          "SELECT waves_company_work_set($1,$2,$3,current_date,'Renamed',NULL,'doing',NULL,NULL,NULL::time)",
          [g.groupId, id, g.memberIds[2]],
        ),
      );
      const row = () =>
        db.query('SELECT client_id,title FROM company_work_tasks WHERE id=$1', [id]);
      expect((await row()).rows[0]).toMatchObject({ client_id: forA, title: 'Renamed' });
      await task(0, id, 2, null, 'Renamed');
      expect((await row()).rows[0].client_id).toBeNull();
    }));

  it('an estimate links to a client, converting keeps the link, and a stranger client is refused', () =>
    isolated(async () => {
      const doc = randomUUID();
      const data = (extra: Record<string, unknown>) =>
        JSON.stringify({
          docType: 'estimate',
          customerName: 'A Client',
          docDate: '2026-11-10',
          items: [{ description: 'Paint', qtyMilli: 1000, rateMinor: 85000 }],
          discountMinor: 0,
          ...extra,
        });
      await user(1, () =>
        db.query('SELECT waves_company_doc_save($1,$2,$3)', [
          g.groupId,
          doc,
          data({ clientId: forA }),
        ]),
      );
      const linked = (id: string) =>
        db
          .query('SELECT client_id FROM company_documents WHERE id=$1', [id])
          .then((r) => r.rows[0].client_id);
      expect(await linked(doc)).toBe(forA);
      // Saving without clientId keeps it.
      await user(1, () =>
        db.query('SELECT waves_company_doc_save($1,$2,$3)', [g.groupId, doc, data({})]),
      );
      expect(await linked(doc)).toBe(forA);
      const bill = randomUUID();
      await user(1, () => db.query('SELECT waves_company_doc_convert($1,$2)', [doc, bill]));
      expect(await linked(bill)).toBe(forA);
      await denied(() =>
        user(0, () =>
          db.query('SELECT waves_company_doc_save($1,$2,$3)', [
            g.groupId,
            randomUUID(),
            data({ clientId: randomUUID() }),
          ]),
        ),
      );
    }));
});

describe('company clients: email, company, category and priority', () => {
  const row = async (id: string) =>
    (
      await db.query(
        'SELECT email,company_name AS company,category,priority,name FROM company_clients WHERE id=$1',
        [id],
      )
    ).rows[0];

  it('saves them, defaults priority to normal, and keeps them when a later save leaves them out', () =>
    isolated(async () => {
      expect((await row(forA)).priority).toBe('normal');
      await setClient(0, forA, {
        name: 'A Client',
        ownerMemberId: g.memberIds[2],
        email: ' a@b.co ',
        company: 'Acme',
        category: 'plumbing',
        priority: 'urgent',
      });
      expect(await row(forA)).toMatchObject({
        email: 'a@b.co',
        company: 'Acme',
        category: 'plumbing',
        priority: 'urgent',
      });
      // A stage change from an older app does not send them: they stay.
      await setClient(0, forA, {
        name: 'A Client 2',
        ownerMemberId: g.memberIds[2],
        stage: 'quoted',
      });
      expect(await row(forA)).toMatchObject({
        name: 'A Client 2',
        email: 'a@b.co',
        priority: 'urgent',
      });
      // Sending an empty value clears one.
      await setClient(0, forA, {
        name: 'A Client 2',
        ownerMemberId: g.memberIds[2],
        stage: 'quoted',
        company: '',
      });
      expect((await row(forA)).company).toBeNull();
    }));

  it('refuses a bad email, an unknown priority and over-long text', () =>
    isolated(async () => {
      const base = { name: 'X', ownerMemberId: g.memberIds[2] };
      for (const bad of [
        { email: 'not-an-email' },
        { priority: 'asap' },
        { company: 'c'.repeat(121) },
        { category: 'c'.repeat(61) },
      ])
        await denied(() => setClient(0, randomUUID(), { ...base, ...bad }));
    }));
});
