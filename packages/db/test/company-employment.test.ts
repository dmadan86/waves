import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

// 0 owner, 1 manager, 2 their employee, 3 second manager, 4 second team's employee.
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
let today: string;
const project = randomUUID();
const task = randomUUID();
const vendor = randomUUID();

async function as<T>(i: number, run: () => Promise<T>, role = 'authenticated'): Promise<T> {
  await db.query('SAVEPOINT actor_scope');
  try {
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify(role === 'service_role' ? { role } : { sub: g.profileIds[i], role }),
    ]);
    await db.query(`SET LOCAL ROLE ${role}`);
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
async function denied(run: () => Promise<unknown>, match: RegExp) {
  await db.query('SAVEPOINT expected_failure');
  try {
    expect(await expectDenied(run())).toMatch(match);
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT expected_failure');
    await db.query('RELEASE SAVEPOINT expected_failure');
  }
}
const employment = (
  actor: number,
  member: number,
  employed = false,
  day: string | null = null,
  note: string | null = null,
) =>
  as(actor, () =>
    db.query('SELECT waves_company_employment_set($1,$2,$3,$4,$5)', [
      g.groupId,
      g.memberIds[member],
      employed,
      day,
      note,
    ]),
  );
const member = async (i = 2) =>
  (
    await db.query(
      'SELECT left_at,removed_at,removed_by,employment_ended_on::text,employment_note,manager_id FROM group_members WHERE id=$1',
      [g.memberIds[i]],
    )
  ).rows[0];
const entry = (actor = 0) =>
  as(actor, () =>
    db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [
      g.groupId,
      randomUUID(),
      g.memberIds[2],
      'expense',
      JSON.stringify({ amount: '123', occurredOn: today }),
    ]),
  );
const attendance = (actor = 0) =>
  as(actor, () =>
    db.query("SELECT waves_company_attendance_set($1,$2,$3,'present',NULL)", [
      g.groupId,
      g.memberIds[2],
      today,
    ]),
  );
const work = (actor = 0) =>
  as(actor, () =>
    db.query("SELECT waves_company_work_set($1,$2,$3,$4,'Fix gate',NULL,'todo',NULL,NULL)", [
      g.groupId,
      task,
      g.memberIds[2],
      today,
    ]),
  );
const invite = async (actor = 0) => {
  const id = randomUUID();
  await as(actor, () =>
    db.query(
      "INSERT INTO invites(id,group_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
      [id, g.groupId, randomUUID()],
    ),
  );
  return id;
};
const totals = () =>
  as(
    0,
    async () =>
      (
        await db.query(
          `SELECT count(*)::int AS entries,
    coalesce(sum(amount) FILTER (WHERE member_id=$2 AND status='approved'),0)::text AS approved
   FROM company_entries WHERE group_id=$1`,
          [g.groupId, g.memberIds[2]],
        )
      ).rows[0],
  );
// Snapshot all company ledger rows, plus the shared ledger, to detect added or changed money rows.
async function ledger() {
  const result: Record<string, unknown> = {};
  for (const table of [
    'company_entries',
    'company_vendor_entries',
    'company_wage_runs',
    'expenses',
    'settlements',
  ]) {
    result[table] = (
      await db.query(`SELECT * FROM public."${table}" WHERE group_id=$1 ORDER BY id`, [g.groupId])
    ).rows;
  }
  return result;
}

beforeAll(async () => {
  db = await connect();
  g = await seedGroup(db, { memberCount: 5 });
  await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
  g.groupId = randomUUID();
  await db.query(
    "INSERT INTO groups(id,name,type,default_currency,country_code,created_by) VALUES($1,'Employment test','company','INR','IN',$2)",
    [g.groupId, g.profileIds[0]],
  );
  const roles = ['admin', 'manager', 'member', 'manager', 'member'];
  for (let i = 0; i < 5; i++) {
    await db.query(
      'INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)',
      [
        g.memberIds[i],
        g.groupId,
        g.profileIds[i],
        roles[i],
        i === 2 ? g.memberIds[1] : i === 4 ? g.memberIds[3] : null,
      ],
    );
  }
  today = (await db.query('SELECT current_date::text AS day')).rows[0].day;
  await db.query('BEGIN');
  try {
    await entry();
    await attendance();
    await work();
    await as(0, async () => {
      await db.query('SELECT waves_company_project_set($1,$2,$3)', [
        g.groupId,
        project,
        JSON.stringify({ name: 'Site', budgetMinor: '2000' }),
      ]);
      await db.query('SELECT waves_company_member_projects_set($1,$2)', [
        g.memberIds[2],
        [project],
      ]);
      await db.query('SELECT waves_company_vendor_set($1,$2,$3)', [
        g.groupId,
        vendor,
        JSON.stringify({ name: 'Supplier' }),
      ]);
      await db.query('SELECT waves_company_vendor_entry_create($1,$2,$3,$4,$5)', [
        g.groupId,
        randomUUID(),
        vendor,
        'bill',
        JSON.stringify({ amount: '50', occurredOn: today }),
      ]);
    });
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
});
afterAll(async () => {
  if (db) await db.end();
});

describe('company employment status', () => {
  it('owner ends employment without changing historical rows, approved totals or ledgers; restores access and fields', () =>
    isolated(async () => {
      const before = await totals();
      expect(before).toEqual({ entries: 1, approved: '123' });
      const money = await ledger();
      const history = await as(
        0,
        async () =>
          (await db.query('SELECT * FROM company_attendance WHERE group_id=$1', [g.groupId])).rows,
      );
      expect(history).toHaveLength(1);
      await employment(0, 2, false, null, '  Contract finished  ');
      expect(await member()).toMatchObject({
        employment_ended_on: today,
        employment_note: 'Contract finished',
        removed_by: g.profileIds[0],
      });
      expect((await member()).left_at).not.toBeNull();
      expect((await member()).removed_at).not.toBeNull();
      expect(await totals()).toEqual(before);
      expect(await ledger()).toEqual(money);
      expect(
        await as(
          0,
          async () =>
            (await db.query('SELECT * FROM company_attendance WHERE group_id=$1', [g.groupId]))
              .rows,
        ),
      ).toEqual(history);
      await employment(0, 2, true);
      expect(await member()).toMatchObject({
        left_at: null,
        removed_at: null,
        removed_by: null,
        employment_ended_on: null,
        employment_note: null,
        manager_id: g.memberIds[1],
      });
      expect(
        await as(
          2,
          async () =>
            (
              await db.query('SELECT id FROM company_entries WHERE group_id=$1 AND member_id=$2', [
                g.groupId,
                g.memberIds[2],
              ])
            ).rowCount,
        ),
      ).toBe(1);
      expect(await totals()).toEqual(before);
      expect(await ledger()).toEqual(money);
    }));

  it('ended employee sees no company rows, cannot write, and receives no new group notification', () =>
    isolated(async () => {
      await employment(0, 2);
      // Discover as postgres: information_schema under authenticated would omit ungranted tables.
      const tables = (
        await db.query(`SELECT t.table_name FROM information_schema.tables t
      JOIN information_schema.columns c USING (table_catalog,table_schema,table_name)
      WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
      AND left(t.table_name,8)='company_' AND c.column_name='group_id' ORDER BY t.table_name`)
      ).rows.map((r) => r.table_name as string);
      expect(tables).toEqual(
        expect.arrayContaining([
          'company_entries',
          'company_attendance',
          'company_work_tasks',
          'company_vendors',
          'company_vendor_entries',
          'company_projects',
        ]),
      );
      for (const table of ['group_members', ...tables]) {
        // Some admin-only tables have no SELECT grant at all; they must refuse SELECT, never expose rows.
        const readable = (
          await db.query("SELECT has_table_privilege('authenticated',$1,'SELECT') AS ok", [
            `public.${table}`,
          ])
        ).rows[0].ok;
        if (!readable) {
          await denied(
            () =>
              as(2, () =>
                db.query(`SELECT * FROM public."${table}" WHERE group_id=$1`, [g.groupId]),
              ),
            /permission denied/,
          );
        } else {
          expect(
            await as(
              2,
              async () =>
                (await db.query(`SELECT * FROM public."${table}" WHERE group_id=$1`, [g.groupId]))
                  .rowCount,
            ),
            table,
          ).toBe(0);
        }
      }
      const groupsVisible = await as(
        2,
        async () => (await db.query('SELECT id FROM groups WHERE id=$1', [g.groupId])).rowCount,
      );
      console.info(`Ended employee groups row visible: ${groupsVisible}`);
      expect(groupsVisible).toBe(0);
      for (const call of [
        () => entry(2),
        () => attendance(2),
        () => work(2),
        () => employment(2, 4),
      ]) {
        await denied(call, /NOT_A_MEMBER|NOT_ALLOWED/);
      }
      const count = async () =>
        (
          await db.query(
            'SELECT count(*)::int AS n FROM notifications WHERE group_id=$1 AND profile_id=$2',
            [g.groupId, g.profileIds[2]],
          )
        ).rows[0].n;
      const before = await count();
      const notified = await as(
        0,
        async () =>
          (
            await db.query(
              "SELECT waves_notify($1,$2,'company_test','Title','Body',NULL,'{}'::jsonb,$3) AS id",
              [g.profileIds[2], g.groupId, randomUUID()],
            )
          ).rows[0].id,
        'service_role',
      );
      expect(notified).toBeNull();
      expect(await count()).toBe(before);
      // Only personal/global data remains visible; no company group, membership or company content.
    }));

  it('an invite minted after the end date cannot reactivate them, nor can a direct left_at update', () =>
    isolated(async () => {
      const yesterday = (await db.query('SELECT (current_date-1)::text AS day')).rows[0].day;
      await employment(0, 2, false, yesterday, 'Finished');
      const ended = await member();
      const id = await invite();
      expect(
        (
          await db.query('SELECT created_at::date > $2::date AS later FROM invites WHERE id=$1', [
            id,
            yesterday,
          ])
        ).rows[0].later,
      ).toBe(true);
      expect(
        (await db.query('SELECT waves_join_via_invite($1,$2) AS r', [id, g.profileIds[2]])).rows[0]
          .r,
      ).toMatchObject({ ok: false, reason: 'REMOVED' });
      // The owner has no UPDATE policy on another person's row: filtered to zero rows, never revived.
      expect(
        await as(
          0,
          async () =>
            (await db.query('UPDATE group_members SET left_at=NULL WHERE id=$1', [g.memberIds[2]]))
              .rowCount,
        ),
      ).toBe(0);
      // Self UPDATE can be filtered out by RLS; it must never revive the membership.
      expect(
        await as(
          2,
          async () =>
            (await db.query('UPDATE group_members SET left_at=NULL WHERE id=$1', [g.memberIds[2]]))
              .rowCount,
        ),
      ).toBe(0);
      expect(await member()).toEqual(ended);
    }));

  it('manager ends/restores only own-team employees; cannot target other teams, owner, self or managers', () =>
    isolated(async () => {
      await employment(1, 2);
      expect((await member()).left_at).not.toBeNull();
      await employment(1, 2, true);
      expect((await member()).left_at).toBeNull();
      for (const target of [4, 0, 1, 3]) {
        await denied(() => employment(1, target), /NOT_ALLOWED/);
      }
      await employment(0, 4);
      await denied(() => employment(1, 4, true), /NOT_ALLOWED/);
      expect((await member(4)).left_at).not.toBeNull();
    }));

  it('owner ending a manager detaches their team and revokes their invites only', () =>
    isolated(async () => {
      const ownInvite = await invite(1);
      const otherInvite = await invite(3);
      await employment(0, 1);
      expect((await member(1)).left_at).not.toBeNull();
      expect((await member()).manager_id).toBeNull();
      expect((await member(4)).manager_id).toBe(g.memberIds[3]);
      expect(
        (await db.query('SELECT revoked_at FROM invites WHERE id=$1', [ownInvite])).rows[0]
          .revoked_at,
      ).not.toBeNull();
      expect(
        (await db.query('SELECT revoked_at FROM invites WHERE id=$1', [otherInvite])).rows[0]
          .revoked_at,
      ).toBeNull();
    }));

  it('refuses a manager with nonzero pool balance without detaching team or revoking invites', () =>
    isolated(async () => {
      const id = await invite(1);
      await as(0, () =>
        db.query("SELECT waves_company_pool_post($1,$2,$3,'allocation','1000',$4,$5,NULL)", [
          g.groupId,
          randomUUID(),
          g.memberIds[1],
          project,
          today,
        ]),
      );
      const money = await ledger();
      await denied(() => employment(0, 1), /MANAGER_HAS_POOL/);
      expect((await member(1)).left_at).toBeNull();
      expect((await member()).manager_id).toBe(g.memberIds[1]);
      expect(
        (await db.query('SELECT revoked_at FROM invites WHERE id=$1', [id])).rows[0].revoked_at,
      ).toBeNull();
      expect(await ledger()).toEqual(money);
    }));

  it('authenticated users cannot update either employment column directly', () =>
    isolated(async () => {
      for (const assignment of ['employment_ended_on=current_date', "employment_note='Bypass'"]) {
        await denied(
          () =>
            as(2, () =>
              db.query(`UPDATE group_members SET ${assignment} WHERE id=$1`, [g.memberIds[2]]),
            ),
          /FORBIDDEN_COLUMN/,
        );
        for (const actor of [0, 1]) {
          expect(
            await as(
              actor,
              async () =>
                (
                  await db.query(`UPDATE group_members SET ${assignment} WHERE id=$1`, [
                    g.memberIds[2],
                  ])
                ).rowCount,
            ),
          ).toBe(0);
        }
      }
      expect(await member()).toMatchObject({ employment_ended_on: null, employment_note: null });
    }));

  it('suspended company refuses both ending and restoring employment', () =>
    isolated(async () => {
      await employment(0, 2);
      await as(
        0,
        () =>
          db.query("SELECT waves_admin_company_block($1,'complaint','Staff complaint')", [
            g.groupId,
          ]),
        'service_role',
      );
      await denied(() => employment(0, 2, true), /COMPANY_BLOCKED/);
      await denied(() => employment(0, 4), /COMPANY_BLOCKED/);
      expect((await member()).left_at).not.toBeNull();
      expect((await member(4)).left_at).toBeNull();
    }));
});
