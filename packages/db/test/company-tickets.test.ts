import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

// Members: 0 owner, 1 manager, 2 employee A (of 1), 3 employee B (of 1), 4 vendor login, 5 owner of another company, 6 manager with no reports.
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
let otherGroup: string;
const t1 = randomUUID(); // owner -> A
const t2 = randomUUID(); // B -> B
const t3 = randomUUID(); // owner -> manager 6

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
const setTicket = (
  caller: number,
  id: string,
  assignee: number,
  data: Record<string, unknown> = {},
) =>
  user(caller, () =>
    db.query('SELECT waves_company_ticket_set($1,$2,$3)', [
      g.groupId,
      id,
      JSON.stringify({
        title: 'Leaking pipe',
        priority: 'normal',
        assigneeMemberId: g.memberIds[assignee],
        ...data,
      }),
    ]),
  );
const status = (caller: number, id: string, to: string, note: string | null = null) =>
  user(caller, () => db.query('SELECT waves_company_ticket_status($1,$2,$3)', [id, to, note]));
const comment = (caller: number, ticket: string, id: string, body = 'Called back') =>
  user(caller, () =>
    db.query('SELECT waves_company_ticket_comment_add($1,$2,$3,$4)', [g.groupId, id, ticket, body]),
  );
const seen = (caller: number) =>
  user(caller, async () =>
    (await db.query('SELECT id FROM company_tickets ORDER BY number')).rows.map(
      (r) => r.id as string,
    ),
  );
const row = async (id: string) =>
  (await db.query('SELECT * FROM company_tickets WHERE id=$1', [id])).rows[0];
const seed = async () => {
  await setTicket(0, t1, 2);
  await setTicket(3, t2, 3);
  await setTicket(0, t3, 6);
};

beforeAll(async () => {
  db = await connect();
  g = await seedGroup(db, { memberCount: 7 });
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
    "INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,'manager')",
    [g.memberIds[6], g.groupId, g.profileIds[6]],
  );
  await db.query(
    "INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,'admin')",
    [g.memberIds[5], otherGroup, g.profileIds[5]],
  );
});
afterAll(async () => {
  if (db) await db.end();
});

describe('company tickets: who sees what', () => {
  it('owner all; manager their reports plus their own; employee assigned or logged by them; vendor and other company none', () =>
    isolated(async () => {
      expect(await seen(0)).toEqual([t1, t2, t3]);
      expect(await seen(1)).toEqual([t1, t2]);
      expect(await seen(2)).toEqual([t1]);
      expect(await seen(3)).toEqual([t2]);
      expect(await seen(6)).toEqual([t3]);
      expect(await seen(4)).toEqual([]);
      expect(await seen(5)).toEqual([]);
    }));

  it('an employee sees a ticket they logged for someone else, and events follow the ticket', () =>
    isolated(async () => {
      const t4 = randomUUID();
      await setTicket(2, t4, 6);
      expect(await seen(2)).toEqual([t1, t4]);
      const events = (i: number) =>
        user(i, async () => (await db.query('SELECT 1 FROM company_ticket_events')).rows.length);
      expect(await events(3)).toBe(1); // only t2's created event
      expect(await events(6)).toBe(2); // t3 and t4
      expect(await events(4)).toBe(0);
    }));

  it('numbers run per company and replaying a create changes nothing', () =>
    isolated(async () => {
      expect((await row(t1)).number).toBe(1);
      expect((await row(t3)).number).toBe(3);
      await setTicket(0, t1, 2);
      const events = await db.query('SELECT 1 FROM company_ticket_events WHERE ticket_id=$1', [t1]);
      expect(events.rows).toHaveLength(1);
      expect((await row(t1)).version).toBe(1);
    }));
});

describe('company tickets: writes', () => {
  it('due time defaults from the priority when not sent', () =>
    isolated(async () => {
      const id = randomUUID();
      await setTicket(0, id, 2, { priority: 'urgent' });
      const r = (
        await db.query(
          'SELECT extract(epoch FROM due_at-now()) AS s FROM company_tickets WHERE id=$1',
          [id],
        )
      ).rows[0];
      expect(Number(r.s)).toBeGreaterThan(3.9 * 3600);
      expect(Number(r.s)).toBeLessThan(4.1 * 3600);
    }));

  it('an employee cannot touch, comment on or move a ticket that is not theirs; a vendor and another company cannot create', () =>
    isolated(async () => {
      await denied(() => status(2, t2, 'in_progress'));
      await denied(() => comment(2, t2, randomUUID()));
      await denied(() => setTicket(2, t2, 2));
      await denied(() => setTicket(4, randomUUID(), 2));
      await denied(() => setTicket(5, randomUUID(), 2));
      await denied(() => status(5, t1, 'in_progress'));
      await denied(() => setTicket(0, t1, 5)); // an assignee from another company
    }));

  it('a ticket id owned by another company is not overwritten', () =>
    isolated(async () => {
      await denied(() =>
        user(5, () =>
          db.query('SELECT waves_company_ticket_set($1,$2,$3)', [
            otherGroup,
            t1,
            JSON.stringify({ title: 'x', assigneeMemberId: g.memberIds[5] }),
          ]),
        ),
      );
    }));

  it('rejects bad data', () =>
    isolated(async () => {
      await denied(() => setTicket(0, randomUUID(), 2, { title: '  ' }));
      await denied(() => setTicket(0, randomUUID(), 2, { priority: 'asap' }));
      await denied(() => setTicket(0, randomUUID(), 2, { bogus: 1 }));
      await denied(() => setTicket(0, randomUUID(), 2, { dueAt: 'not a date' }));
    }));

  it('a client link must be a client the caller can see', () =>
    isolated(async () => {
      const mine = randomUUID();
      const notMine = randomUUID();
      await user(0, () =>
        db.query('SELECT waves_company_client_set($1,$2,$3)', [
          g.groupId,
          mine,
          JSON.stringify({ name: 'Goa Traders', phone: '99001', ownerMemberId: g.memberIds[2] }),
        ]),
      );
      await user(0, () =>
        db.query('SELECT waves_company_client_set($1,$2,$3)', [
          g.groupId,
          notMine,
          JSON.stringify({ name: 'Other', ownerMemberId: g.memberIds[3] }),
        ]),
      );
      const id = randomUUID();
      await setTicket(2, id, 2, { clientId: mine });
      const r = await row(id);
      expect(r.client_name).toBe('Goa Traders');
      expect(r.client_phone).toBe('99001');
      await denied(() => setTicket(2, randomUUID(), 2, { clientId: notMine }));
      // A holder who cannot see the client can still keep the link on an unrelated edit.
      await setTicket(0, id, 3, { clientId: mine });
      await setTicket(3, id, 3, { clientId: mine, title: 'Renamed' });
      expect((await row(id)).client_name).toBe('Goa Traders');
    }));

  it('reassigning gives the new assignee the ticket and its history, and records it', () =>
    isolated(async () => {
      await setTicket(1, t1, 3);
      expect(await seen(2)).toEqual([]);
      expect(await seen(3)).toEqual([t1, t2]);
      const kinds = (
        await db.query(
          'SELECT kind FROM company_ticket_events WHERE ticket_id=$1 ORDER BY created_at,kind',
          [t1],
        )
      ).rows.map((r) => r.kind);
      expect(kinds.sort()).toEqual(['assigned', 'created']);
      // The history was re-stamped for the new assignee's next pull.
      const stamp = await db.query(
        'SELECT bool_and(updated_at>=(SELECT created_at FROM company_tickets WHERE id=$1)) AS ok FROM company_ticket_events WHERE ticket_id=$1',
        [t1],
      );
      expect(stamp.rows[0].ok).toBe(true);
    }));

  it('moving an employee to another manager re-stamps their tickets for the new manager', () =>
    isolated(async () => {
      const before = (await row(t1)).updated_seq;
      await db.query('UPDATE group_members SET manager_id=$2 WHERE id=$1', [
        g.memberIds[2],
        g.memberIds[6],
      ]);
      expect(await seen(1)).toEqual([t2]);
      expect(await seen(6)).toEqual([t1, t3]);
      expect(BigInt((await row(t1)).updated_seq)).toBeGreaterThan(BigInt(before));
    }));
});

describe('company tickets: status', () => {
  it('walks open -> in progress -> resolved (note needed) -> closed -> reopened, with a fresh due time', () =>
    isolated(async () => {
      await status(2, t1, 'in_progress');
      await denied(() => status(2, t1, 'resolved'));
      await status(2, t1, 'resolved', 'Replaced the washer');
      let r = await row(t1);
      expect(r.status).toBe('resolved');
      expect(r.resolution).toBe('Replaced the washer');
      expect(r.resolved_at).not.toBeNull();
      await status(0, t1, 'closed');
      expect((await row(t1)).status).toBe('closed');
      await db.query("UPDATE company_tickets SET due_at=now()-interval '10 days' WHERE id=$1", [
        t1,
      ]);
      await status(2, t1, 'open');
      r = await row(t1);
      expect(r.status).toBe('open');
      expect(r.resolved_at).toBeNull();
      expect(r.resolution).toBeNull();
      expect(new Date(r.due_at).getTime()).toBeGreaterThan(Date.now());
      const kinds = (
        await db.query(
          "SELECT to_status FROM company_ticket_events WHERE ticket_id=$1 AND kind='status' ORDER BY created_at",
          [t1],
        )
      ).rows.map((x) => x.to_status);
      expect(kinds).toEqual(['in_progress', 'resolved', 'closed', 'open']);
    }));

  it('asking for the same status, or a move that is no longer possible, changes nothing', () =>
    isolated(async () => {
      await status(2, t1, 'in_progress');
      await status(2, t1, 'in_progress');
      await status(2, t1, 'open'); // not a legal move from in progress
      await status(2, t1, 'closed');
      expect((await row(t1)).status).toBe('in_progress');
      const n = await db.query(
        "SELECT 1 FROM company_ticket_events WHERE ticket_id=$1 AND kind='status'",
        [t1],
      );
      expect(n.rows).toHaveLength(1);
    }));
});

describe('company tickets: comments and removal', () => {
  it('a comment is added once per id; a stranger cannot reuse the id', () =>
    isolated(async () => {
      const id = randomUUID();
      await comment(2, t1, id);
      await comment(2, t1, id);
      const n = await db.query("SELECT 1 FROM company_ticket_events WHERE kind='comment'");
      expect(n.rows).toHaveLength(1);
      await denied(() => comment(1, t1, id));
      await denied(() => comment(0, t1, randomUUID(), '   '));
    }));

  it('owner and the assignee manager can remove; an employee cannot; removing twice is fine', () =>
    isolated(async () => {
      const remove = (i: number, id: string) =>
        user(i, () => db.query('SELECT waves_company_ticket_remove($1)', [id]));
      await denied(() => remove(2, t1));
      await denied(() => remove(6, t1));
      await remove(1, t1);
      await remove(0, t1);
      expect((await row(t1)).deleted_at).not.toBeNull();
      await denied(() => comment(2, t1, randomUUID()));
    }));
});
