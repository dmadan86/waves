/**
 * Company notifications: who hears about what.
 *
 * Members: 0 owner, 1 manager, 2 employee managed by 1, 3 employee with no
 * manager, 4 second owner, 5 bystander employee, 6 vendor with a login.
 * Every case runs in a rolled-back transaction as the acting profile (the JWT
 * `sub`), and asserts the exact set of recipients: right people get one row,
 * the actor and unrelated members get none.
 */
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, seedGroup } from './helpers';

const today = new Date().toISOString().slice(0, 10);
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
let vendorId: string;

async function isolated(run: () => Promise<void>) {
  await db.query('BEGIN');
  try {
    await run();
  } finally {
    await db.query('ROLLBACK');
  }
}

/** Run as member i (sets the JWT sub the triggers read as the actor). */
async function as<T>(i: number, run: () => Promise<T>): Promise<T> {
  await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: g.profileIds[i]!, role: 'authenticated' }),
  ]);
  try {
    return await run();
  } finally {
    // After a failed statement the transaction is aborted; the real error is the one to see.
    await db.query("SELECT set_config('request.jwt.claims','',true)").catch(() => undefined);
  }
}

/** kind -> sorted member indices that got a row (a duplicate shows up twice). */
async function heard(): Promise<Record<string, number[]>> {
  const { rows } = await db.query(
    `SELECT n.kind, n.profile_id FROM notifications n
      WHERE n.group_id=$1 AND n.kind LIKE 'company\\_%' ORDER BY n.kind, n.created_at`,
    [g.groupId],
  );
  const out: Record<string, number[]> = {};
  for (const r of rows) {
    const idx = g.profileIds.indexOf(r.profile_id as string);
    (out[r.kind as string] ??= []).push(idx);
  }
  for (const k of Object.keys(out)) out[k]!.sort();
  return out;
}

const m = (i: number) => g.memberIds[i]!;

beforeAll(async () => {
  db = await connect();
  g = await seedGroup(db, { memberCount: 7 });
  await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
  g.groupId = randomUUID();
  await db.query(
    "INSERT INTO groups(id,name,type,default_currency,country_code,created_by) VALUES($1,'Acme','company','INR','IN',$2)",
    [g.groupId, g.profileIds[0]!],
  );
  const roles = ['admin', 'manager', 'member', 'member', 'admin', 'member', 'vendor'];
  for (let i = 0; i < 7; i++) {
    await db.query(
      'INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)',
      [m(i), g.groupId, g.profileIds[i]!, roles[i], i === 2 ? m(1) : null],
    );
  }
  vendorId = randomUUID();
  await db.query(
    'INSERT INTO company_vendors(id,group_id,name,added_by,member_id) VALUES($1,$2,$3,$4,$5)',
    [vendorId, g.groupId, 'Sri Steels', m(0), m(6)],
  );
});

afterAll(async () => {
  if (db) {
    await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
    await db.end();
  }
});

describe('leave', () => {
  const ask = (who: number, by = who) =>
    db.query(
      `INSERT INTO company_leave(group_id,member_id,start_day,end_day,kind,status,created_by)
       VALUES($1,$2,$3,$3,'casual','pending',$4) RETURNING id`,
      [g.groupId, m(who), today, m(by)],
    );

  it('requested: a managed employee notifies only their manager', () =>
    isolated(async () => {
      await as(2, () => ask(2));
      expect(await heard()).toEqual({ company_leave_requested: [1] });
    }));

  it('requested: with no manager every owner hears, the employee does not', () =>
    isolated(async () => {
      await as(3, () => ask(3));
      expect(await heard()).toEqual({ company_leave_requested: [0, 4] });
    }));

  it('approved / declined: the employee hears, the decider does not', () =>
    isolated(async () => {
      const id = (await as(2, () => ask(2))).rows[0].id;
      await db.query('DELETE FROM notifications WHERE group_id=$1', [g.groupId]);
      await as(1, () =>
        db.query("UPDATE company_leave SET status='approved', decided_by=$2 WHERE id=$1", [
          id,
          m(1),
        ]),
      );
      expect(await heard()).toEqual({ company_leave_approved: [2] });
    }));

  it('declined goes to the employee too', () =>
    isolated(async () => {
      const id = (await as(3, () => ask(3))).rows[0].id;
      await as(0, () =>
        db.query("UPDATE company_leave SET status='rejected', decided_by=$2 WHERE id=$1", [
          id,
          m(0),
        ]),
      );
      expect((await heard()).company_leave_rejected).toEqual([3]);
    }));
});

describe('expense claims and payments', () => {
  const entry = (
    who: number,
    kind: string,
    status: string,
    by: number,
    extra: { direction?: string } = {},
  ) =>
    db.query(
      `INSERT INTO company_entries(id,group_id,member_id,entry_kind,amount,currency,occurred_on,status,created_by,updated_by,direction)
       VALUES($1,$2,$3,$4,50000,'INR',$5,$6,$7,$7,$8) RETURNING id`,
      [randomUUID(), g.groupId, m(who), kind, today, status, m(by), extra.direction ?? null],
    );

  it('submitted (managed): the manager hears, nobody else', () =>
    isolated(async () => {
      await as(2, () => entry(2, 'expense', 'submitted', 2));
      expect(await heard()).toEqual({ company_claim_submitted: [1] });
    }));

  it('submitted (unmanaged): the owners hear', () =>
    isolated(async () => {
      await as(3, () => entry(3, 'expense', 'submitted', 3));
      expect(await heard()).toEqual({ company_claim_submitted: [0, 4] });
    }));

  it('an auto-approved expense notifies nobody', () =>
    isolated(async () => {
      await as(3, () => entry(3, 'expense', 'approved', 3));
      expect(await heard()).toEqual({});
    }));

  it('approved and rejected: the employee only', () =>
    isolated(async () => {
      const a = (await as(2, () => entry(2, 'expense', 'submitted', 2))).rows[0].id;
      const b = (await as(2, () => entry(2, 'expense', 'submitted', 2))).rows[0].id;
      await db.query('DELETE FROM notifications WHERE group_id=$1', [g.groupId]);
      await as(1, () => db.query("UPDATE company_entries SET status='approved' WHERE id=$1", [a]));
      await as(1, () => db.query("UPDATE company_entries SET status='rejected' WHERE id=$1", [b]));
      expect(await heard()).toEqual({ company_claim_approved: [2], company_claim_rejected: [2] });
    }));

  it('an edited claim sent back for review notifies the approver again', () =>
    isolated(async () => {
      const id = (await as(2, () => entry(2, 'expense', 'rejected', 2))).rows[0].id;
      await as(2, () =>
        db.query("UPDATE company_entries SET status='submitted' WHERE id=$1", [id]),
      );
      expect(await heard()).toEqual({ company_claim_submitted: [1] });
    }));

  it('reimbursed: the employee hears; employee-to-company does not notify', () =>
    isolated(async () => {
      await as(0, () =>
        entry(3, 'reimbursement', 'approved', 0, { direction: 'company_to_employee' }),
      );
      await as(0, () =>
        entry(3, 'reimbursement', 'approved', 0, { direction: 'employee_to_company' }),
      );
      expect(await heard()).toEqual({ company_claim_reimbursed: [3] });
    }));

  it('advance and wages: the employee hears, the payer does not, a bystander does not', () =>
    isolated(async () => {
      await as(0, () => entry(2, 'advance', 'approved', 0));
      await as(0, () => entry(2, 'wages', 'approved', 0));
      const h = await heard();
      expect(h).toEqual({ company_payment: [2, 2] });
    }));

  it('a manager paying their own employee is the actor, not a recipient', () =>
    isolated(async () => {
      await as(1, () => entry(1, 'advance', 'approved', 1));
      expect(await heard()).toEqual({});
    }));
});

describe('tasks', () => {
  const task = (assignee: number, by: number, helpers: number[] = []) =>
    db.query(
      `INSERT INTO company_work_tasks(id,group_id,member_id,day,title,created_by,helper_ids)
       VALUES($1,$2,$3,$4,'Fix the gate',$5,$6) RETURNING id`,
      [randomUUID(), g.groupId, m(assignee), today, m(by), helpers.map(m)],
    );

  it('assigned: assignee and helpers hear, the assigner and bystanders do not', () =>
    isolated(async () => {
      await as(1, () => task(2, 1, [3]));
      expect(await heard()).toEqual({ company_task_assigned: [2, 3] });
    }));

  it('reassigned and newly added helper: only the new people hear', () =>
    isolated(async () => {
      const id = (await as(1, () => task(2, 1))).rows[0].id;
      await db.query('DELETE FROM notifications WHERE group_id=$1', [g.groupId]);
      await as(1, () =>
        db.query('UPDATE company_work_tasks SET member_id=$2, helper_ids=$3 WHERE id=$1', [
          id,
          m(3),
          [m(5)],
        ]),
      );
      expect(await heard()).toEqual({ company_task_assigned: [3, 5] });
    }));

  it('done / blocked by the assignee: the assigner hears', () =>
    isolated(async () => {
      const id = (await as(1, () => task(2, 1))).rows[0].id;
      await db.query('DELETE FROM notifications WHERE group_id=$1', [g.groupId]);
      await as(2, () => db.query("UPDATE company_work_tasks SET status='done' WHERE id=$1", [id]));
      await as(2, () =>
        db.query(
          "UPDATE company_work_tasks SET status='blocked', blocked_reason='rain' WHERE id=$1",
          [id],
        ),
      );
      expect(await heard()).toEqual({ company_task_blocked: [1], company_task_done: [1] });
    }));

  it('a self-assigned task going done tells the owners, not the actor', () =>
    isolated(async () => {
      const id = (await as(3, () => task(3, 3))).rows[0].id;
      await db.query('DELETE FROM notifications WHERE group_id=$1', [g.groupId]);
      await as(3, () => db.query("UPDATE company_work_tasks SET status='done' WHERE id=$1", [id]));
      expect(await heard()).toEqual({ company_task_done: [0, 4] });
    }));

  it('an unchanged re-write notifies nobody', () =>
    isolated(async () => {
      const id = (await as(1, () => task(2, 1))).rows[0].id;
      await db.query('DELETE FROM notifications WHERE group_id=$1', [g.groupId]);
      await as(1, () => db.query("UPDATE company_work_tasks SET note='hi' WHERE id=$1", [id]));
      expect(await heard()).toEqual({});
    }));
});

describe('calendar', () => {
  it('created: the listed people hear, not the creator; new invitees on update', () =>
    isolated(async () => {
      const id = randomUUID();
      await as(1, () =>
        db.query(
          'INSERT INTO company_events(id,group_id,title,day,people,created_by) VALUES($1,$2,$3,$4,$5,$6)',
          [id, g.groupId, 'Site visit', today, [m(1), m(2)], m(1)],
        ),
      );
      expect(await heard()).toEqual({ company_event: [2] });
      await db.query('DELETE FROM notifications WHERE group_id=$1', [g.groupId]);
      await as(1, () =>
        db.query('UPDATE company_events SET people=$2 WHERE id=$1', [id, [m(1), m(2), m(3)]]),
      );
      expect(await heard()).toEqual({ company_event: [3] });
      await db.query('DELETE FROM notifications WHERE group_id=$1', [g.groupId]);
      await as(1, () =>
        db.query("UPDATE company_events SET title='Site visit 2' WHERE id=$1", [id]),
      );
      expect(await heard()).toEqual({ company_event: [2, 3] });
    }));

  it('a whole-company event (no people) notifies nobody', () =>
    isolated(async () => {
      await as(1, () =>
        db.query(
          'INSERT INTO company_events(id,group_id,title,day,people,created_by) VALUES($1,$2,$3,$4,$5,$6)',
          [randomUUID(), g.groupId, 'Diwali', today, [], m(1)],
        ),
      );
      expect(await heard()).toEqual({});
    }));
});

describe('estimates and bills', () => {
  const doc = (type: 'estimate' | 'bill', status: string, creator: number) =>
    db.query(
      `INSERT INTO company_documents(id,group_id,doc_type,number,customer_name,doc_date,items,total_minor,currency,status,created_by,updated_by)
       VALUES($1,$2,$3,$4,'Ravi Stores',$5,'[{"name":"Gate"}]',100000,'INR',$6,$7,$7) RETURNING id`,
      [randomUUID(), g.groupId, type, Math.floor(Math.random() * 1e6), today, status, m(creator)],
    );

  it('estimate accepted / declined: the creator and the owners, not the actor', () =>
    isolated(async () => {
      const a = (await as(1, () => doc('estimate', 'sent', 1))).rows[0].id;
      const b = (await as(1, () => doc('estimate', 'sent', 1))).rows[0].id;
      await as(1, () =>
        db.query("UPDATE company_documents SET status='accepted', updated_by=$2 WHERE id=$1", [
          a,
          m(1),
        ]),
      );
      await as(0, () =>
        db.query("UPDATE company_documents SET status='declined', updated_by=$2 WHERE id=$1", [
          b,
          m(0),
        ]),
      );
      expect(await heard()).toEqual({
        company_estimate_accepted: [0, 4],
        company_estimate_declined: [1, 4],
      });
    }));

  it('bill fully paid: the creator; part payment says nothing', () =>
    isolated(async () => {
      const id = (await as(1, () => doc('bill', 'unpaid', 1))).rows[0].id;
      await as(0, () =>
        db.query(
          "UPDATE company_documents SET status='part_paid', paid_minor=40000, updated_by=$2 WHERE id=$1",
          [id, m(0)],
        ),
      );
      expect(await heard()).toEqual({});
      await as(0, () =>
        db.query(
          "UPDATE company_documents SET status='paid', paid_minor=100000, updated_by=$2 WHERE id=$1",
          [id, m(0)],
        ),
      );
      expect(await heard()).toEqual({ company_bill_paid: [1] });
    }));
});

describe('complaints', () => {
  const ticket = (assignee: number, by: number) =>
    db.query(
      `INSERT INTO company_tickets(id,group_id,number,title,assignee_member_id,due_at,created_by,updated_by)
       VALUES($1,$2,$3,'Leaking tap',$4,now()+interval '1 day',$5,$5) RETURNING id`,
      [randomUUID(), g.groupId, Math.floor(Math.random() * 1e6), m(assignee), m(by)],
    );

  it('assigned, reassigned, then resolved', () =>
    isolated(async () => {
      const id = (await as(0, () => ticket(2, 0))).rows[0].id;
      expect(await heard()).toEqual({ company_ticket_assigned: [2] });
      await db.query('DELETE FROM notifications WHERE group_id=$1', [g.groupId]);
      await as(0, () =>
        db.query('UPDATE company_tickets SET assignee_member_id=$2 WHERE id=$1', [id, m(3)]),
      );
      expect(await heard()).toEqual({ company_ticket_assigned: [3] });
      await db.query('DELETE FROM notifications WHERE group_id=$1', [g.groupId]);
      await as(3, () =>
        db.query(
          "UPDATE company_tickets SET status='resolved', resolved_at=now(), updated_by=$2 WHERE id=$1",
          [id, m(3)],
        ),
      );
      expect(await heard()).toEqual({ company_ticket_resolved: [0] });
    }));
});

describe('vendors', () => {
  it('payment and a new order reach the vendor login only', () =>
    isolated(async () => {
      await as(0, () =>
        db.query(
          `INSERT INTO company_vendor_entries(id,group_id,vendor_id,kind,amount,occurred_on,status,created_by)
           VALUES($1,$2,$3,'payment',250000,$4,'approved',$5)`,
          [randomUUID(), g.groupId, vendorId, today, m(0)],
        ),
      );
      await as(0, () =>
        db.query(
          `INSERT INTO company_vendor_orders(id,group_id,vendor_id,order_no,created_by) VALUES($1,$2,$3,1,$4)`,
          [randomUUID(), g.groupId, vendorId, m(0)],
        ),
      );
      expect(await heard()).toEqual({ company_vendor_order: [6], company_vendor_payment: [6] });
    }));
});

describe('prefs', () => {
  it('companyUpdates=false suppresses the push; absent means on', () =>
    isolated(async () => {
      for (const i of [2, 3]) {
        await db.query('DELETE FROM push_tokens WHERE profile_id=$1', [g.profileIds[i]]);
        await db.query(
          "INSERT INTO push_tokens(profile_id,expo_push_token,platform) VALUES($1,$2,'android')",
          [g.profileIds[i], `ExponentPushToken[${randomUUID()}]`],
        );
      }
      await db.query('UPDATE profiles SET notification_prefs=$2::jsonb WHERE id=$1', [
        g.profileIds[2],
        JSON.stringify({ companyUpdates: false }),
      ]);
      await as(1, () =>
        db.query(
          `INSERT INTO company_work_tasks(id,group_id,member_id,day,title,created_by)
           VALUES($1,$2,$3,$4,'a',$5),($6,$2,$7,$4,'b',$5)`,
          [randomUUID(), g.groupId, m(2), today, m(1), randomUUID(), m(3)],
        ),
      );
      await db.query('SELECT id FROM waves_claim_push_notifications(500)');
      const status = async (i: number) =>
        (
          await db.query(
            `SELECT push_status::text s FROM notifications WHERE profile_id=$1 AND kind='company_task_assigned'`,
            [g.profileIds[i]],
          )
        ).rows[0].s;
      expect(await status(2)).toBe('suppressed');
      expect(await status(3)).not.toBe('suppressed');
    }));
});
