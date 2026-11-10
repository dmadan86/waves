import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

// Members: 0 owner, 1 manager, 2 employee (team of 1), 3 employee (no manager), 4 manager (no team).
// Every member joined on the 1st of this month and the seeded types start then, so each type has
// exactly one month accrued (1 day) and nothing depends on the day the suite runs.
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
let casual: string;
let sick: string;
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => today().slice(0, 8) + '01';
const iso = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

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
const q = (i: number, sql: string, args: unknown[] = []) => user(i, () => db.query(sql, args));
const ask = (caller: number, member: number, type: string | null, days = 1, id = randomUUID()) =>
  q(caller, 'SELECT waves_company_leave_set($1,$2,$3,$4,$5,false,$6,NULL,$7)', [
    g.groupId,
    id,
    g.memberIds[member],
    today(),
    iso(days - 1),
    'other',
    type,
  ]).then(() => id);
const decide = (caller: number, id: string, approve = true) =>
  q(caller, 'SELECT waves_company_leave_decide($1,$2,$3,NULL)', [g.groupId, id, approve]);
const setType = (caller: number, id: string, name: string, over: Record<string, unknown> = {}) => {
  const o = {
    accrual: 1,
    carry: true,
    carryCap: null,
    annualCap: null,
    paid: true,
    overdraw: false,
    active: true,
    ...over,
  };
  return q(caller, 'SELECT waves_company_leave_type_set($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
    g.groupId,
    id,
    name,
    o.accrual,
    o.carry,
    o.carryCap,
    o.annualCap,
    o.paid,
    o.overdraw,
    o.active,
  ]);
};
const balance = async (member: number, type: string, asOf = today()) =>
  Number(
    (
      await db.query('SELECT waves_company_leave_balance($1,$2,$3,$4) b', [
        g.groupId,
        g.memberIds[member],
        type,
        asOf,
      ])
    ).rows[0].b,
  );

beforeAll(async () => {
  db = await connect();
  g = await seedGroup(db, { memberCount: 5 });
  await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
  g.groupId = randomUUID();
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
    [g.groupId, g.profileIds[0]],
  );
  const roles = ['admin', 'manager', 'member', 'member', 'manager'];
  for (let i = 0; i < 5; i++)
    await db.query(
      'INSERT INTO group_members(id,group_id,profile_id,role,manager_id,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [
        g.memberIds[i],
        g.groupId,
        g.profileIds[i],
        roles[i],
        i === 2 ? g.memberIds[1] : null,
        monthStart(),
      ],
    );
  await db.query('UPDATE company_leave_types SET starts_on=$2 WHERE group_id=$1', [
    g.groupId,
    monthStart(),
  ]);
  const t = await db.query('SELECT id,name FROM company_leave_types WHERE group_id=$1', [
    g.groupId,
  ]);
  casual = t.rows.find((r) => r.name === 'Casual').id;
  sick = t.rows.find((r) => r.name === 'Sick').id;
});
afterAll(async () => {
  if (db) {
    await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
    await db.end();
  }
});

describe('types', () => {
  it('a new company is seeded with Casual (carry forward) and Sick (no carry forward), 1 day a month', async () => {
    const r = await db.query(
      'SELECT name,kind,accrual_days_per_month a,carry_forward c,paid,allow_overdraw o FROM company_leave_types WHERE group_id=$1 ORDER BY name',
      [g.groupId],
    );
    expect(r.rows).toEqual([
      { name: 'Casual', kind: 'casual', a: '1.00', c: true, paid: false, o: false },
      { name: 'Sick', kind: 'sick', a: '1.00', c: false, paid: false, o: false },
    ]);
  });
  it('the owner creates and edits types; manager and employee cannot; everyone reads', () =>
    isolated(async () => {
      const id = randomUUID();
      await setType(0, id, 'Earned', { accrual: 1.5, carryCap: 10, annualCap: 18 });
      await denied(() => setType(1, randomUUID(), 'Manager made'));
      await denied(() => setType(2, randomUUID(), 'Employee made'));
      await denied(() => setType(2, id, 'Hijack'));
      await denied(() => setType(0, randomUUID(), 'earned')); // names are unique per company
      await denied(() => setType(0, randomUUID(), 'Bad', { accrual: 5.5 }));
      await denied(() => setType(0, randomUUID(), 'Bad', { accrual: 0.1 })); // quarters at the finest
      await setType(0, id, 'Earned leave', { accrual: 2, carry: false, carryCap: 7 });
      for (const i of [0, 1, 2, 3, 4]) {
        const r = await q(
          i,
          'SELECT name,accrual_days_per_month a,carry_forward_cap cap FROM company_leave_types WHERE id=$1',
          [id],
        );
        expect(r.rows).toEqual([{ name: 'Earned leave', a: '2.00', cap: null }]); // cap dropped with carry off
      }
      await denied(() => q(2, 'SELECT waves_company_leave_type_remove($1,$2)', [g.groupId, id]));
      await q(0, 'SELECT waves_company_leave_type_remove($1,$2)', [g.groupId, id]);
    }));
  it('a request can only name an active type of its own company', () =>
    isolated(async () => {
      await denied(() => ask(2, 2, randomUUID()));
      const id = randomUUID();
      await setType(0, id, 'Parked', { active: false });
      await denied(() => ask(2, 2, id));
    }));
});

describe('balances and approval', () => {
  it('Sick 1 day: employee asks, manager approves, the balance drops by 1', () =>
    isolated(async () => {
      expect(await balance(2, sick)).toBe(1);
      const id = await ask(2, 2, sick);
      expect(await balance(2, sick)).toBe(1); // pending is not deducted
      await decide(1, id);
      expect(await balance(2, sick)).toBe(0);
      expect(await balance(2, casual)).toBe(1); // other types untouched
      expect(
        (await q(2, 'SELECT kind,leave_type_id FROM company_leave WHERE id=$1', [id])).rows,
      ).toEqual([{ kind: 'sick', leave_type_id: sick }]); // the type's kind is stored
    }));
  it('a rejected request does not reduce the balance', () =>
    isolated(async () => {
      const id = await ask(2, 2, sick);
      await decide(1, id, false);
      expect(await balance(2, sick)).toBe(1);
    }));
  it('approving more than the balance is refused; the request stays pending and can be rejected', () =>
    isolated(async () => {
      const id = await ask(2, 2, sick, 2); // 2 days against 1
      await denied(() => decide(1, id));
      await denied(() => decide(0, id)); // the owner is held to it too
      expect((await db.query('SELECT status FROM company_leave WHERE id=$1', [id])).rows).toEqual([
        { status: 'pending' },
      ]);
      await decide(1, id, false);
    }));
  it('the owner can allow overdraw on a type, then the approval goes through', () =>
    isolated(async () => {
      const id = await ask(2, 2, sick, 3);
      await denied(() => decide(1, id));
      await setType(0, sick, 'Sick', { carry: false, overdraw: true });
      await decide(1, id);
      expect(await balance(2, sick)).toBe(-2);
    }));
  it('two approvals cannot both spend the same day', () =>
    isolated(async () => {
      const a = await ask(2, 2, sick, 1);
      await db.query('UPDATE company_leave SET start_day=$2,end_day=$2 WHERE id=$1', [a, today()]);
      const b = randomUUID();
      await db.query(
        `INSERT INTO company_leave(id,group_id,member_id,start_day,end_day,kind,status,created_by,leave_type_id)
         VALUES($1,$2,$3,$4,$4,'sick','pending',$3,$5)`,
        [b, g.groupId, g.memberIds[2], iso(1), sick],
      );
      await decide(1, a);
      await denied(() => decide(1, b));
    }));
  it('a leave without a type is never deducted', () =>
    isolated(async () => {
      const id = await ask(2, 2, null, 5);
      await decide(1, id);
      expect(await balance(2, casual)).toBe(1);
      expect(await balance(2, sick)).toBe(1);
    }));
  it('the owner / manager recording leave for a person is checked against the balance', () =>
    isolated(async () => {
      await denied(() => ask(1, 2, sick, 2)); // manager records 2 days against 1
      await ask(1, 2, sick, 1);
      expect(await balance(2, sick)).toBe(0);
    }));
  it('a half day deducts 0.5', () =>
    isolated(async () => {
      const id = randomUUID();
      await q(2, 'SELECT waves_company_leave_set($1,$2,$3,$4,$4,true,$5,NULL,$6)', [
        g.groupId,
        id,
        g.memberIds[2],
        today(),
        'other',
        casual,
      ]);
      await decide(1, id);
      expect(await balance(2, casual)).toBe(0.5);
    }));
});

describe('permissions', () => {
  it('a manager cannot approve another team’s leave; the owner can', () =>
    isolated(async () => {
      const id = await ask(3, 3, casual); // employee 3 has no manager
      await denied(() => decide(1, id));
      await denied(() => decide(4, id));
      await denied(() => decide(2, id));
      await decide(0, id);
      expect(await balance(3, casual)).toBe(0);
    }));
  it('an employee cannot request for someone else', () =>
    isolated(async () => {
      await denied(() => ask(3, 2, casual));
    }));
});

describe('SQL balance matches the core function (packages/core leaveBalance.ts)', () => {
  const ins = (member: number, type: string, start: string, end = start, half = false) =>
    db.query(
      `INSERT INTO company_leave(group_id,member_id,start_day,end_day,half_day,kind,status,created_by,leave_type_id)
       VALUES($1,$2,$3,$4,$5,'other','approved',$2,$6)`,
      [g.groupId, g.memberIds[member], start, end, half, type],
    );
  const setup = async (over: string) => {
    await db.query('UPDATE group_members SET created_at=$2 WHERE id=$1', [
      g.memberIds[2],
      '2025-01-01T12:00:00Z',
    ]);
    await db.query(`UPDATE company_leave_types SET starts_on='2025-01-01' ${over} WHERE id=$1`, [
      casual,
    ]);
  };
  it('carry forward across a year boundary, with and without a cap', () =>
    isolated(async () => {
      await setup('');
      await ins(2, casual, '2025-03-03'); // 12 earned - 1 = 11 carried; Jan 2026 earns 1
      expect(await balance(2, casual, '2026-01-15')).toBe(12);
      await db.query('UPDATE company_leave_types SET carry_forward_cap=5 WHERE id=$1', [casual]);
      expect(await balance(2, casual, '2026-01-15')).toBe(6);
    }));
  it('no carry forward resets at 1 January; annual cap limits a year; half days', () =>
    isolated(async () => {
      await setup('');
      await ins(2, casual, '2025-03-03');
      await db.query('UPDATE company_leave_types SET carry_forward=false WHERE id=$1', [casual]);
      expect(await balance(2, casual, '2026-01-15')).toBe(1);
      await db.query('UPDATE company_leave_types SET annual_cap=6,carry_forward=true WHERE id=$1', [
        casual,
      ]);
      expect(await balance(2, casual, '2025-12-31')).toBe(5); // capped 6 - 1
      await ins(2, casual, '2025-04-04', '2025-04-04', true);
      expect(await balance(2, casual, '2025-12-31')).toBe(4.5);
    }));
  it('mid-month joiner: day 15 earns that month, day 16 starts next month', () =>
    isolated(async () => {
      await setup('');
      await db.query('UPDATE group_members SET created_at=$2 WHERE id=$1', [
        g.memberIds[2],
        '2025-03-15T12:00:00Z',
      ]);
      expect(await balance(2, casual, '2025-03-20')).toBe(1);
      await db.query('UPDATE group_members SET created_at=$2 WHERE id=$1', [
        g.memberIds[2],
        '2025-03-16T12:00:00Z',
      ]);
      expect(await balance(2, casual, '2025-03-20')).toBe(0);
      await db.query(
        'UPDATE company_member_dates SET joined_on=$3 WHERE group_id=$1 AND member_id=$2',
        [g.groupId, g.memberIds[2], '2025-01-01'],
      );
      await db.query(
        'INSERT INTO company_member_dates(group_id,member_id,joined_on) VALUES($1,$2,$3)',
        [g.groupId, g.memberIds[2], '2025-01-01'],
      );
      expect(await balance(2, casual, '2025-03-20')).toBe(3); // the joining date beats the invite date
    }));
});

describe('approval cannot overspend committed or past balances', () => {
  const pending = async (member: number, day: string) => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO company_leave(id,group_id,member_id,start_day,end_day,kind,status,created_by,leave_type_id)
       VALUES($1,$2,$3,$4,$4,'casual','pending',$3,$5)`,
      [id, g.groupId, g.memberIds[member], day, casual],
    );
    return id;
  };
  const approvedRow = async (member: number, day: string) => {
    const id = await pending(member, day);
    await db.query("UPDATE company_leave SET status='approved' WHERE id=$1", [id]);
  };
  const setup = async (over: string) => {
    await db.query('UPDATE group_members SET created_at=$2 WHERE id=$1', [
      g.memberIds[2],
      '2026-01-01T12:00:00Z',
    ]);
    await db.query(`UPDATE company_leave_types SET starts_on='2026-01-01' ${over} WHERE id=$1`, [
      casual,
    ]);
  };
  it('annual cap 1: with March already taken, a February day is refused (and allowed with cap 2)', () =>
    isolated(async () => {
      await setup(',annual_cap=1');
      await approvedRow(2, '2026-03-02');
      const feb = await pending(2, '2026-02-02');
      await denied(() => decide(1, feb));
      await db.query('UPDATE company_leave_types SET annual_cap=2 WHERE id=$1', [casual]);
      await decide(1, feb);
    }));
  it('a December request is held to December even when decided later, with carry forward off', () =>
    isolated(async () => {
      await setup(',annual_cap=1,carry_forward=false');
      await approvedRow(2, '2026-12-01');
      const second = await pending(2, '2026-12-02');
      await denied(() => decide(1, second));
    }));
  it('a person cannot back-date their own joining date to earn more; the owner can', () =>
    isolated(async () => {
      await setup('');
      await db.query('UPDATE group_members SET created_at=$2 WHERE id=$1', [
        g.memberIds[2],
        '2026-06-01T12:00:00Z',
      ]);
      const join = (caller: number) =>
        q(caller, 'SELECT waves_company_dates_set($1,$2,NULL,NULL,$3,false)', [
          g.groupId,
          g.memberIds[2],
          '2026-01-01',
        ]);
      const stored = async () =>
        (
          await db.query('SELECT joined_on::text j FROM company_member_dates WHERE member_id=$1', [
            g.memberIds[2],
          ])
        ).rows[0].j;
      await join(2);
      expect(await stored()).toBe('2026-06-01'); // clamped to the day they were added
      await join(1); // their manager
      expect(await stored()).toBe('2026-01-01');
      await join(2); // the person re-saving (a birthday edit) keeps the date their manager set
      expect(await stored()).toBe('2026-01-01');
    }));
});

describe('notifications keep working', () => {
  it('a request notifies the manager, the decision notifies the employee', () =>
    isolated(async () => {
      const id = await ask(2, 2, casual);
      const kinds = async () =>
        (
          await db.query(
            "SELECT kind,profile_id FROM notifications WHERE group_id=$1 AND kind LIKE 'company\\_leave%' ORDER BY created_at",
            [g.groupId],
          )
        ).rows.map((r) => [r.kind, g.profileIds.indexOf(r.profile_id)]);
      expect(await kinds()).toEqual([['company_leave_requested', 1]]);
      await decide(1, id);
      expect(await kinds()).toEqual([
        ['company_leave_requested', 1],
        ['company_leave_approved', 2],
      ]);
    }));
});
