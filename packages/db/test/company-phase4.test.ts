import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
const project = randomUUID();
async function user<T>(i: number, run: () => Promise<T>): Promise<T> {
  const previous = (
    await db.query(
      "SELECT current_setting('role') role,current_setting('request.jwt.claims',true) claims",
    )
  ).rows[0];
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
    await db.query(previous.role === 'none' ? 'RESET ROLE' : `SET LOCAL ROLE ${previous.role}`);
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [previous.claims ?? '']);
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
    return await expectDenied(run());
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT expected_failure');
  }
}
const entry = async (member: number, kind = 'expense', data: Record<string, unknown> = {}) => {
  const id = randomUUID();
  await db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [
    g.groupId,
    id,
    g.memberIds[member],
    kind,
    JSON.stringify({ amount: '100', occurredOn: '2026-11-10', ...data }),
  ]);
  return id;
};
const pool = (
  kind = 'allocation',
  amount = '1000',
  reason: string | null = null,
  manager = 1,
  id = randomUUID(),
) =>
  db.query('SELECT waves_company_pool_post($1,$2,$3,$4,$5,$6,$7,$8)', [
    g.groupId,
    id,
    g.memberIds[manager],
    kind,
    amount,
    project,
    '2026-11-10',
    reason,
  ]);
const balance = async (manager = 1) =>
  (await db.query('SELECT waves_company_pool_balance($1,$2) b', [g.groupId, g.memberIds[manager]]))
    .rows[0].b;
const line = (
  member = 3,
  fixed = '600',
  recovery = '600',
  net = '0',
  data: Record<string, unknown> = {},
) => ({
  paymentEntryId: randomUUID(),
  memberId: g.memberIds[member],
  calcMode: 'typed',
  fixedMinor: fixed,
  claimIds: [],
  expectedGrossMinor: fixed,
  expectedRecoveryMinor: recovery,
  expectedNetMinor: net,
  ...data,
});
const wage = (lines: unknown[], start = '2026-11-01', end = '2026-11-15', id = randomUUID()) =>
  db.query('SELECT waves_company_wage_pay($1,$2,$3,$4,$5,$6)', [
    g.groupId,
    id,
    start,
    end,
    end,
    JSON.stringify(lines),
  ]);

beforeAll(async () => {
  db = await connect();
  g = await seedGroup(db, { memberCount: 6 });
  // No unrelated common trip: profiles must exercise company-only visibility.
  await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
  g.groupId = randomUUID();
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
    [g.groupId, g.profileIds[0]],
  );
  for (let i = 0; i < 6; i++)
    await db.query(
      'INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)',
      [
        g.memberIds[i],
        g.groupId,
        g.profileIds[i],
        i === 0 ? 'admin' : i < 3 ? 'manager' : 'member',
        i === 3 ? g.memberIds[1] : i === 4 ? g.memberIds[2] : null,
      ],
    );
  await isolated(async () => {});
  await db.query('BEGIN');
  await user(0, async () => {
    await db.query('SELECT waves_company_project_set($1,$2,$3)', [
      g.groupId,
      project,
      JSON.stringify({ name: 'Site A', budgetMinor: '2000', archived: false }),
    ]);
    await db.query('SELECT waves_company_member_projects_set($1,$2)', [g.memberIds[3], [project]]);
  });
  await db.query('COMMIT');
});
afterAll(async () => {
  if (db) await db.end();
});

describe('company Phase 4', () => {
  it('migration exposes exact RPCs with definer search paths and no anonymous/direct writes', async () => {
    for (const signature of [
      'waves_company_people(uuid)',
      'waves_company_member_add(uuid,uuid,jsonb)',
      'waves_company_member_assign(uuid,uuid,text)',
      'waves_company_member_projects_set(uuid,uuid[])',
      'waves_company_project_set(uuid,uuid,jsonb)',
      'waves_company_pool_post(uuid,uuid,uuid,text,bigint,uuid,date,text)',
      'waves_company_pool_balance(uuid,uuid)',
      'waves_company_project_report(uuid,date,date)',
      'waves_company_wage_pay(uuid,uuid,date,date,date,jsonb)',
    ]) {
      const r = (
        await db.query(
          "SELECT p.prosecdef,p.proconfig,has_function_privilege('authenticated',p.oid,'EXECUTE') auth,has_function_privilege('anon',p.oid,'EXECUTE') anon FROM pg_proc p WHERE p.oid=$1::regprocedure",
          [signature],
        )
      ).rows[0];
      expect(r).toMatchObject({ prosecdef: true, auth: true, anon: false });
      expect(r.proconfig).toContain('search_path=public, pg_temp');
    }
    for (const table of [
      'company_projects',
      'company_project_members',
      'company_project_budgets',
      'company_wage_runs',
    ])
      expect(
        (
          await db.query(
            "SELECT has_table_privilege('authenticated',$1,'INSERT,UPDATE,DELETE') allowed",
            [table],
          )
        ).rows[0].allowed,
      ).toBe(false);
  });
  it('privacy matrix: ledger, helper, attachments, members, profiles, projects, directory and caller export/pull', () =>
    isolated(async () => {
      const ids: string[] = [];
      await user(0, async () => {
        for (let i = 0; i < 6; i++) ids.push(await entry(i));
      });
      const attachmentIds: string[] = [];
      for (const id of ids) {
        const attachment = randomUUID();
        attachmentIds.push(attachment);
        await db.query(
          'INSERT INTO company_entry_attachments(id,entry_id,group_id,uploader_member_id,storage_path) VALUES($1,$2,$3,$4,$5)',
          [attachment, id, g.groupId, g.memberIds[0], `${id}/${attachment}/${randomUUID()}.jpg`],
        );
      }
      const visible = [[0, 1, 2, 3, 4, 5], [1, 3], [2, 4], [3], [4], [5]];
      const people = [
        [0, 1, 2, 3, 4, 5],
        [0, 1, 3],
        [0, 2, 4],
        [0, 1, 3],
        [0, 2, 4],
        [0, 5],
      ];
      for (let actor = 0; actor < 6; actor++)
        await user(actor, async () => {
          // Generic sync and export read these exact tables as caller, including notes/GST.
          for (const sql of [
            'SELECT id FROM company_entries WHERE group_id=$1',
            'SELECT id,note,vendor,gstin,reimbursement_details FROM company_entries WHERE group_id=$1 AND updated_seq>=0',
          ])
            expect((await db.query(sql, [g.groupId])).rows.map((r) => r.id).sort()).toEqual(
              visible[actor]!.map((i) => ids[i]).sort(),
            );
          expect(
            (
              await db.query(
                'SELECT id,storage_path,preview FROM company_entry_attachments WHERE group_id=$1',
                [g.groupId],
              )
            ).rows
              .map((r) => r.id)
              .sort(),
          ).toEqual(visible[actor]!.map((i) => attachmentIds[i]).sort());
          for (let target = 0; target < 6; target++)
            expect(
              (await db.query('SELECT waves_can_read_company_entry($1) ok', [ids[target]])).rows[0]
                .ok,
            ).toBe(visible[actor]!.includes(target));
          expect(
            (await db.query('SELECT id FROM group_members WHERE group_id=$1', [g.groupId])).rows
              .map((r) => r.id)
              .sort(),
          ).toEqual(visible[actor]!.map((i) => g.memberIds[i]).sort());
          expect(
            (
              await db.query('SELECT id FROM profiles WHERE id=ANY($1::uuid[])', [g.profileIds])
            ).rows
              .map((r) => r.id)
              .sort(),
          ).toEqual(visible[actor]!.map((i) => g.profileIds[i]).sort());
          const directory = (await db.query('SELECT * FROM waves_company_people($1)', [g.groupId]))
            .rows;
          expect(directory.map((r) => r.member_id).sort()).toEqual(
            people[actor]!.map((i) => g.memberIds[i]).sort(),
          );
          for (const p of directory)
            expect(p.detail).toBe(visible[actor]!.some((i) => g.memberIds[i] === p.member_id));
          expect(
            (await db.query('SELECT * FROM company_projects WHERE group_id=$1', [g.groupId]))
              .rowCount,
          ).toBe([0, 1, 3].includes(actor) ? 1 : 0);
          expect(
            (await db.query('SELECT * FROM company_project_budgets WHERE group_id=$1', [g.groupId]))
              .rowCount,
          ).toBe(actor === 0 ? 1 : 0);
          if (actor !== 0)
            expect(
              (
                await db.query('SELECT * FROM waves_person_profile($1)', [
                  g.profileIds[actor === 1 ? 4 : actor === 2 ? 3 : actor === 3 ? 4 : 3],
                ])
              ).rowCount,
            ).toBe(0);
        });
    }));
  it('manager adds only employees on own team; cannot promote/reassign or set another team projects', () =>
    isolated(async () => {
      const id = randomUUID();
      await user(1, async () => {
        await db.query('SELECT waves_company_member_add($1,$2,$3)', [
          g.groupId,
          id,
          JSON.stringify({
            name: 'New employee',
            managerId: g.memberIds[2],
            projectIds: [project],
          }),
        ]);
        expect(
          (await db.query('SELECT manager_id,role FROM group_members WHERE id=$1', [id])).rows[0],
        ).toMatchObject({ manager_id: g.memberIds[1], role: 'member' });
        await denied(() => db.query("SELECT waves_set_member_role($1,'manager')", [id]));
        await denied(() =>
          db.query("SELECT waves_company_member_assign($1,$2,'move')", [id, g.memberIds[2]]),
        );
        await denied(() =>
          db.query('SELECT waves_company_member_projects_set($1,$2)', [g.memberIds[4], [project]]),
        );
        await denied(() =>
          db.query('SELECT waves_company_member_add($1,$2,$3)', [
            g.groupId,
            randomUUID(),
            JSON.stringify({ name: 'Invalid', role: 'admin' }),
          ]),
        );
        await denied(() =>
          db.query('UPDATE group_members SET manager_id=$2 WHERE id=$1', [id, g.memberIds[2]]),
        );
      });
    }));
  it('reassignment flips full historical access, including attachments and profiles', () =>
    isolated(async () => {
      const id = await user(0, () => entry(3));
      await user(1, async () =>
        expect((await db.query('SELECT id FROM company_entries WHERE id=$1', [id])).rowCount).toBe(
          1,
        ),
      );
      await user(0, () =>
        db.query("SELECT waves_company_member_assign($1,$2,'New site')", [
          g.memberIds[3],
          g.memberIds[2],
        ]),
      );
      for (const [actor, count] of [
        [1, 0],
        [2, 1],
        [3, 1],
      ] as [number, number][])
        await user(actor, async () => {
          expect(
            (await db.query('SELECT id FROM company_entries WHERE id=$1', [id])).rowCount,
          ).toBe(count);
          expect(
            (await db.query('SELECT waves_can_read_company_entry($1) ok', [id])).rows[0].ok,
          ).toBe(count === 1);
          expect(
            (await db.query('SELECT id FROM profiles WHERE id=$1', [g.profileIds[3]])).rowCount,
          ).toBe(count);
        });
    }));
  it('pool arithmetic includes signed corrections, wages, own spend, cash returns; reasons required; negative allowed', () =>
    isolated(async () => {
      await user(0, async () => {
        await pool();
        await pool('pool_return', '50', 'Unspent');
        await pool('pool_adjustment', '-25', 'Cash correction');
        await denied(() => pool('pool_return', '1', '  '));
        await denied(() => pool('pool_adjustment', '1', null));
      });
      await user(1, async () => {
        await entry(3, 'advance', { amount: '1000' });
        await entry(1, 'expense', { amount: '100' });
        await entry(3, 'reimbursement', { amount: '30', direction: 'employee_to_company' });
        await wage([line()]);
        expect(await balance()).toMatchObject({
          allocated: '1000',
          returned: '50',
          adjusted: '-25',
          advances: '1000',
          wages: '0',
          ownSpend: '100',
          cashReturned: '30',
          balance: '-145',
        });
        await denied(() => pool());
        await denied(() => balance(2));
      });
      await user(2, () => denied(() => balance()));
      await user(0, async () => expect((await balance()).balance).toBe('-145'));
    }));
  it('wages cap recovery, carry over two runs, record zero net, replay exactly, reject changed/overlap/mismatch', () =>
    isolated(async () => {
      await user(1, async () => {
        await entry(3, 'advance', { amount: '1000' });
        const a = line(),
          run = randomUUID();
        await wage([a], undefined, undefined, run);
        await wage([a], undefined, undefined, run);
        await denied(() => wage([{ ...a, note: 'changed' }], undefined, undefined, run));
        await denied(() => wage([line()], '2026-11-10', '2026-11-20'));
        await denied(() => wage([line(3, '600', '400', '201')], '2026-11-16', '2026-11-30'));
        const b = line(3, '600', '400', '200');
        await wage([b], '2026-11-16', '2026-11-30');
        expect(
          (
            await db.query(
              'SELECT amount,gross_minor,claims_minor,recovery_minor FROM company_entries WHERE id=$1',
              [a.paymentEntryId],
            )
          ).rows[0],
        ).toMatchObject({
          amount: '0',
          gross_minor: '600',
          claims_minor: '0',
          recovery_minor: '600',
        });
        expect(
          (
            await db.query(
              'SELECT amount,recovery_minor,funding_manager_id FROM company_entries WHERE id=$1',
              [b.paymentEntryId],
            )
          ).rows[0],
        ).toMatchObject({
          amount: '200',
          recovery_minor: '400',
          funding_manager_id: g.memberIds[1],
        });
        expect((await balance()).balance).toBe('-1200');
        await denied(() => wage([line(4, '100', '0', '100')]));
        await denied(() =>
          db.query('SELECT waves_company_entry_void($1,$2)', [b.paymentEntryId, 'Correction']),
        );
      });
    }));
  it('wage half-up math folds approved bata/mileage claims, links and freezes them without double-counting project spend', () =>
    isolated(async () => {
      await user(1, async () => {
        const claim = await entry(3, 'allowance', {
          calcMode: 'days_rate',
          days: '1',
          rateMinor: '100',
          projectId: project,
        });
        const l = line(3, '0', '0', '102', {
          projectId: project,
          calcMode: 'days_rate',
          days: '0.50',
          rateMinor: '3',
          expectedGrossMinor: '102',
          claimIds: [{ entryId: claim, expectedVersion: 1 }],
        });
        await wage([l]);
        expect(
          (
            await db.query('SELECT reimbursement_id,status FROM company_entries WHERE id=$1', [
              claim,
            ])
          ).rows[0],
        ).toMatchObject({ reimbursement_id: l.paymentEntryId, status: 'reimbursed' });
        await denied(() =>
          db.query('SELECT waves_company_entry_update($1,$2)', [
            claim,
            JSON.stringify({ note: 'Changed' }),
          ]),
        );
        await denied(() =>
          wage(
            [
              line(3, '1', '0', '101', {
                expectedGrossMinor: '101',
                claimIds: [{ entryId: claim, expectedVersion: 2 }],
              }),
            ],
            '2026-11-16',
            '2026-11-30',
          ),
        );
      });
      await user(0, async () => {
        const report = (
          await db.query('SELECT waves_company_project_report($1,$2,$3) r', [
            g.groupId,
            '2026-11-01',
            '2026-11-30',
          ])
        ).rows[0].r;
        expect(report.projects[0]).toMatchObject({
          id: project,
          budget: '2000',
          spent: '102',
          remaining: '1898',
        });
      });
    }));
  it('employees cannot mutate any Phase 4 RPC or read pools/reports', () =>
    isolated(async () => {
      for (const actor of [3, 4, 5])
        await user(actor, async () => {
          for (const run of [
            () => pool(),
            () => balance(),
            () => wage([line()]),
            () =>
              db.query('SELECT waves_company_project_set($1,$2,$3)', [
                g.groupId,
                randomUUID(),
                JSON.stringify({ name: 'No' }),
              ]),
            () =>
              db.query('SELECT waves_company_member_add($1,$2,$3)', [
                g.groupId,
                randomUUID(),
                JSON.stringify({ name: 'No' }),
              ]),
            () =>
              db.query("SELECT waves_company_member_assign($1,NULL,'No')", [g.memberIds[actor]]),
            () =>
              db.query('SELECT waves_company_member_projects_set($1,$2)', [
                g.memberIds[actor],
                [project],
              ]),
            () =>
              db.query('SELECT waves_company_project_report($1,$2,$3)', [
                g.groupId,
                '2026-11-01',
                '2026-11-30',
              ]),
          ])
            await denied(run);
          // Directory is intentionally available to employees, with names-only authority rows.
          expect(
            (await db.query('SELECT * FROM waves_company_people($1)', [g.groupId])).rowCount,
          ).toBeGreaterThan(0);
        });
    }));
});

describe('company Phase 4: people, invites and approvals', () => {
  const invite = async (actor: number) =>
    user(actor, async () => {
      const id = randomUUID();
      await db.query(
        "INSERT INTO invites(id,group_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
        [id, g.groupId, randomUUID()],
      );
      return id;
    });
  it('a manager invite attaches the joiner to that manager; other managers cannot see it; employees cannot mint', () =>
    isolated(async () => {
      const id = await invite(1);
      expect(
        (await db.query('SELECT company_manager_id FROM invites WHERE id=$1', [id])).rows[0]
          .company_manager_id,
      ).toBe(g.memberIds[1]);
      await user(2, async () =>
        expect((await db.query('SELECT id FROM invites WHERE id=$1', [id])).rowCount).toBe(0),
      );
      const joiner = randomUUID();
      await db.query(
        "INSERT INTO profiles(id,display_name,default_currency) VALUES($1,'Joiner','INR')",
        [joiner],
      );
      const joined = (await db.query('SELECT waves_join_via_invite($1,$2) r', [id, joiner])).rows[0]
        .r;
      expect(joined.ok).toBe(true);
      expect(
        (
          await db.query('SELECT manager_id,role FROM group_members WHERE id=$1', [
            joined.member_id,
          ])
        ).rows[0],
      ).toMatchObject({ manager_id: g.memberIds[1], role: 'member' });
      await denied(() =>
        user(3, async () =>
          db.query(
            "INSERT INTO invites(id,group_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
            [randomUUID(), g.groupId, randomUUID()],
          ),
        ),
      );
    }));
  it('an owner invite lands under the owners; a manager cannot see the new joiner outside the team', () =>
    isolated(async () => {
      const id = await invite(0);
      expect(
        (await db.query('SELECT company_manager_id FROM invites WHERE id=$1', [id])).rows[0]
          .company_manager_id,
      ).toBeNull();
      const joiner = randomUUID();
      await db.query(
        "INSERT INTO profiles(id,display_name,default_currency) VALUES($1,'Direct','INR')",
        [joiner],
      );
      const joined = (await db.query('SELECT waves_join_via_invite($1,$2) r', [id, joiner])).rows[0]
        .r;
      await user(1, async () =>
        expect(
          (await db.query('SELECT id FROM group_members WHERE id=$1', [joined.member_id])).rowCount,
        ).toBe(0),
      );
    }));
  it('reassignment needs no reason and only to a manager or the owners; managers cannot remove another team', () =>
    isolated(async () => {
      await user(0, async () => {
        await db.query('SELECT waves_company_member_assign($1,$2,NULL)', [
          g.memberIds[3],
          g.memberIds[2],
        ]);
        expect(
          (await db.query('SELECT manager_id FROM group_members WHERE id=$1', [g.memberIds[3]]))
            .rows[0].manager_id,
        ).toBe(g.memberIds[2]);
        await db.query('SELECT waves_company_member_assign($1,NULL,NULL)', [g.memberIds[3]]);
        expect(
          (await db.query('SELECT manager_id FROM group_members WHERE id=$1', [g.memberIds[3]]))
            .rows[0].manager_id,
        ).toBeNull();
        await denied(() =>
          db.query('SELECT waves_company_member_assign($1,$2,NULL)', [
            g.memberIds[3],
            g.memberIds[4],
          ]),
        );
      });
      await user(1, async () => {
        await denied(() => db.query('SELECT waves_remove_member($1)', [g.memberIds[4]]));
      });
    }));
  it('managers pay and review only their own team, never themselves', () =>
    isolated(async () => {
      await user(1, async () => {
        await denied(() => entry(4, 'advance', { amount: '10' }));
        await denied(() => entry(2, 'advance', { amount: '10' }));
        await entry(3, 'advance', { amount: '10' });
      });
      await db.query('UPDATE groups SET company_approvals_enabled=true WHERE id=$1', [g.groupId]);
      const own = await user(3, () => entry(3));
      const other = await user(4, () => entry(4));
      const mine = await user(1, () => entry(1));
      await user(1, async () => {
        await db.query("SELECT waves_company_entry_transition($1,'approved',NULL,1)", [own]);
        await denied(() =>
          db.query("SELECT waves_company_entry_transition($1,'approved',NULL,1)", [other]),
        );
        await denied(() =>
          db.query("SELECT waves_company_entry_transition($1,'approved',NULL,1)", [mine]),
        );
      });
      await user(0, () =>
        db.query("SELECT waves_company_entry_transition($1,'approved',NULL,1)", [mine]),
      );
    }));
  it('no activity or notification row is written for money entries, and activity is owner-only', () =>
    isolated(async () => {
      await user(1, async () => {
        await entry(3, 'advance', { amount: '10' });
      });
      await user(0, async () => {
        await pool();
      });
      expect(
        (await db.query('SELECT count(*)::int n FROM activity_log WHERE group_id=$1', [g.groupId]))
          .rows[0].n,
      ).toBe(0);
      expect(
        (await db.query('SELECT count(*)::int n FROM notifications WHERE group_id=$1', [g.groupId]))
          .rows[0].n,
      ).toBe(0);
      for (const actor of [1, 3])
        await user(actor, async () =>
          expect(
            (await db.query('SELECT 1 FROM activity_log WHERE group_id=$1', [g.groupId])).rowCount,
          ).toBe(0),
        );
    }));
  it('an employee on a team can update their own row; a filterless update cannot touch rows they cannot see', () =>
    isolated(async () => {
      await user(3, async () => {
        await db.query("UPDATE group_members SET payment_handle='x' WHERE id=$1", [g.memberIds[3]]);
      });
      const ghost = randomUUID();
      await user(1, () =>
        db.query('SELECT waves_company_member_add($1,$2,$3)', [
          g.groupId,
          ghost,
          JSON.stringify({ name: 'Ghost' }),
        ]),
      );
      await user(5, async () => {
        await db.query('UPDATE group_members SET payment_handle=payment_handle');
      });
      expect(
        (await db.query('SELECT payment_handle FROM group_members WHERE id=$1', [ghost])).rows[0]
          .payment_handle,
      ).toBeNull();
      expect(
        (await db.query('SELECT updated_at FROM group_members WHERE id=$1', [ghost])).rowCount,
      ).toBe(1);
    }));
  it('reassignment re-stamps history so the new manager pulls it', () =>
    isolated(async () => {
      const id = await user(0, () => entry(3));
      const before = (await db.query('SELECT updated_seq FROM company_entries WHERE id=$1', [id]))
        .rows[0].updated_seq;
      await user(0, () =>
        db.query('SELECT waves_company_member_assign($1,$2,NULL)', [
          g.memberIds[3],
          g.memberIds[2],
        ]),
      );
      const after = (await db.query('SELECT updated_seq FROM company_entries WHERE id=$1', [id]))
        .rows[0].updated_seq;
      expect(BigInt(after)).toBeGreaterThan(BigInt(before));
    }));
  it('wage recovery is not counted again after a reimbursement consumed the advance; cash returns reduce it', () =>
    isolated(async () => {
      await user(1, async () => {
        await entry(3, 'advance', { amount: '1000' });
        await wage([line(3, '400', '400', '0')]);
        await entry(3, 'reimbursement', { amount: '100', direction: 'employee_to_company' });
        // 1000 advance - 400 recovered - 100 returned = 500 still outstanding.
        await wage([line(3, '600', '500', '100')], '2026-11-16', '2026-11-30');
      });
    }));
  it('a manager can ask the owners for budget for themselves only; owners and the manager see it, others do not', () =>
    isolated(async () => {
      const id = randomUUID();
      await user(1, () => pool('pool_request', '5000', 'Diesel for the new site', 1, id));
      await denied(() => user(1, () => pool('pool_request', '5000', null, 2)));
      await denied(() => user(3, () => pool('pool_request', '5000', null, 1)));
      for (const [actor, n] of [
        [0, 1],
        [1, 1],
        [2, 0],
        [3, 0],
      ] as [number, number][])
        await user(actor, async () =>
          expect(
            (await db.query('SELECT id FROM company_entries WHERE id=$1', [id])).rowCount,
          ).toBe(n),
        );
      await user(1, async () => expect((await balance()).balance).toBe('0'));
    }));
  it('an advance already recovered through a wage run cannot be edited or voided', () =>
    isolated(async () => {
      await user(1, async () => {
        const adv = await entry(3, 'advance', { amount: '1000' });
        await wage([line(3, '400', '400', '0')]);
        await denied(() => db.query('SELECT waves_company_entry_void($1,$2)', [adv, 'oops']));
        await denied(() =>
          db.query('SELECT waves_company_entry_update($1,$2)', [
            adv,
            JSON.stringify({ amount: '900' }),
          ]),
        );
      });
    }));
  it('a company group with wage runs, pools and entries can be hard-deleted', () =>
    isolated(async () => {
      await user(0, () => pool());
      await user(1, async () => {
        await entry(3, 'advance', { amount: '1000' });
        await wage([line(3, '400', '400', '0')]);
      });
      await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
      expect(
        (
          await db.query('SELECT count(*)::int n FROM company_entries WHERE group_id=$1', [
            g.groupId,
          ])
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await db.query('SELECT count(*)::int n FROM company_wage_runs WHERE group_id=$1', [
            g.groupId,
          ])
        ).rows[0].n,
      ).toBe(0);
    }));
  it('reassigning an employee with wage payments and reimbursed claims re-stamps without error', () =>
    isolated(async () => {
      const adv = await user(1, () => entry(3, 'advance', { amount: '1000' }));
      await user(1, () => wage([line(3, '400', '400', '0')]));
      await user(0, () =>
        db.query('SELECT waves_company_member_assign($1,$2,NULL)', [
          g.memberIds[3],
          g.memberIds[2],
        ]),
      );
      expect(adv).toBeTruthy();
    }));
  it('an ordinary reimbursement after a wage recovery works and consumes the recovery', () =>
    isolated(async () => {
      const adv = await user(1, () => entry(3, 'advance', { amount: '1000' }));
      await user(1, () => wage([line(3, '400', '400', '0')]));
      const claim = await user(3, () => entry(3, 'expense', { amount: '800' }));
      await user(1, () =>
        db.query('SELECT waves_company_reimburse($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
          g.groupId,
          randomUUID(),
          g.memberIds[3],
          JSON.stringify([{ entryId: claim, expectedVersion: 1 }]),
          JSON.stringify([{ entryId: adv, expectedVersion: 1 }]),
          '2026-11-30',
          '2026-11-30',
          '200',
          null,
        ]),
      );
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM company_entries WHERE entry_kind='wage_payment' AND reimbursement_id IS NOT NULL",
          )
        ).rows[0].n,
      ).toBe(1);
    }));
  it('only approved advances reduce a wage; project budgets sync with a sequence', () =>
    isolated(async () => {
      await db.query('UPDATE groups SET company_approvals_enabled=true WHERE id=$1', [g.groupId]);
      await user(0, () => entry(3, 'advance', { amount: '1000' }));
      await db.query(
        "UPDATE company_entries SET status='submitted' WHERE entry_kind='advance' AND group_id=$1",
        [g.groupId],
      );
      await user(1, () => wage([line(3, '600', '0', '600')]));
      const b = (
        await db.query(
          'SELECT id,updated_seq,deleted_at FROM company_project_budgets WHERE group_id=$1',
          [g.groupId],
        )
      ).rows[0];
      expect(b.id).toBe(project);
      expect(Number(b.updated_seq)).toBeGreaterThan(0);
    }));
  it('replaying member add with different projects is a conflict', () =>
    isolated(async () => {
      const id = randomUUID();
      await user(1, async () => {
        await db.query('SELECT waves_company_member_add($1,$2,$3)', [
          g.groupId,
          id,
          JSON.stringify({ name: 'Same', projectIds: [project] }),
        ]);
        await db.query('SELECT waves_company_member_add($1,$2,$3)', [
          g.groupId,
          id,
          JSON.stringify({ name: 'Same', projectIds: [project] }),
        ]);
        await denied(() =>
          db.query('SELECT waves_company_member_add($1,$2,$3)', [
            g.groupId,
            id,
            JSON.stringify({ name: 'Same', projectIds: [] }),
          ]),
        );
      });
    }));
  it('a company group with reimbursed claims and wage runs can be hard-deleted', () =>
    isolated(async () => {
      const adv = await user(1, () => entry(3, 'advance', { amount: '1000' }));
      await user(1, () => wage([line(3, '400', '400', '0')]));
      const claim = await user(3, () => entry(3, 'expense', { amount: '800' }));
      await user(1, () =>
        db.query('SELECT waves_company_reimburse($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
          g.groupId,
          randomUUID(),
          g.memberIds[3],
          JSON.stringify([{ entryId: claim, expectedVersion: 1 }]),
          JSON.stringify([{ entryId: adv, expectedVersion: 1 }]),
          '2026-11-30',
          '2026-11-30',
          '200',
          null,
        ]),
      );
      await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
      expect(
        (
          await db.query('SELECT count(*)::int n FROM company_entries WHERE group_id=$1', [
            g.groupId,
          ])
        ).rows[0].n,
      ).toBe(0);
    }));
});
