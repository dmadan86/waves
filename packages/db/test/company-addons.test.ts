import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

// Members: 0 owner, 1 owner, 2 manager, 3 employee (team of 2), 4 employee (owners), 5 manager (no team).
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
const siteA = randomUUID();
const siteB = randomUUID();

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
const entry = async (creator: number, member: number, amount = '100') => {
  const id = randomUUID();
  await user(creator, () =>
    db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [
      g.groupId,
      id,
      g.memberIds[member],
      'expense',
      JSON.stringify({ amount, occurredOn: '2026-11-10' }),
    ]),
  );
  return id;
};
const review = async (reviewer: number, id: string) => {
  const version = (await db.query('SELECT version FROM company_entries WHERE id=$1', [id])).rows[0]
    .version;
  return user(reviewer, () =>
    db.query("SELECT waves_company_entry_transition($1,'approved',NULL,$2)", [id, version]),
  );
};
const second = (enabled: boolean, threshold: string | null) =>
  user(0, () =>
    db.query('SELECT waves_company_second_approval_set($1,$2,$3)', [g.groupId, enabled, threshold]),
  );
const wage = (caller: number, lines: unknown[]) =>
  user(caller, () =>
    db.query('SELECT waves_company_wage_pay($1,$2,$3,$4,$5,$6)', [
      g.groupId,
      randomUUID(),
      '2026-11-01',
      '2026-11-15',
      '2026-11-15',
      JSON.stringify(lines),
    ]),
  );
const line = (member: number, fixed: string, extra: Record<string, unknown> = {}) => ({
  paymentEntryId: randomUUID(),
  memberId: g.memberIds[member],
  calcMode: 'typed',
  fixedMinor: fixed,
  claimIds: [],
  expectedGrossMinor: fixed,
  expectedRecoveryMinor: '0',
  expectedNetMinor: fixed,
  ...extra,
});

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
  await user(0, async () => {
    for (const [id, name] of [
      [siteA, 'Site A'],
      [siteB, 'Site B'],
    ])
      await db.query('SELECT waves_company_project_set($1,$2,$3)', [
        g.groupId,
        id,
        JSON.stringify({ name, budgetMinor: '5000', archived: false }),
      ]);
  });
  await db.query('COMMIT');
});
afterAll(async () => {
  if (db) await db.end();
});

describe('company add-ons: wages split across sites', () => {
  it('records a split run, reports it per site and hides it from other teams', () =>
    isolated(async () => {
      const l = line(3, '1000', {
        splits: [
          { projectId: siteA, amountMinor: '600' },
          { projectId: siteB, amountMinor: '400' },
        ],
      });
      await wage(0, [l]);
      const rows = (
        await db.query(
          'SELECT project_id,amount_minor FROM company_wage_splits ORDER BY amount_minor',
        )
      ).rows;
      expect(rows.map((r) => r.amount_minor)).toEqual(['400', '600']);
      const report = (
        await user(0, () =>
          db.query('SELECT waves_company_project_report($1,$2,$3) r', [
            g.groupId,
            '2026-11-01',
            '2026-11-30',
          ]),
        )
      ).rows[0].r;
      const spent = Object.fromEntries(
        report.projects.map((p: { id: string; spent: string }) => [p.id, p.spent]),
      );
      expect(spent[siteA]).toBe('600');
      expect(spent[siteB]).toBe('400');
      const visible = async (i: number) =>
        (await user(i, () => db.query('SELECT count(*)::int n FROM company_wage_splits'))).rows[0]
          .n;
      expect(await visible(0)).toBe(2); // owner
      expect(await visible(2)).toBe(2); // the employee's current manager
      expect(await visible(3)).toBe(2); // the employee
      expect(await visible(4)).toBe(0); // another employee
      expect(await visible(5)).toBe(0); // another manager
    }));

  it('refuses splits that do not add up, repeat a site, or mix with a single site', () =>
    isolated(async () => {
      await denied(
        () => wage(0, [line(3, '1000', { splits: [{ projectId: siteA, amountMinor: '900' }] })]),
        /SPLIT_MISMATCH/,
      );
      await denied(
        () =>
          wage(0, [
            line(3, '1000', {
              splits: [
                { projectId: siteA, amountMinor: '500' },
                { projectId: siteA, amountMinor: '500' },
              ],
            }),
          ]),
        /INVALID_SPLITS/,
      );
      await denied(
        () =>
          wage(0, [
            line(3, '1000', {
              projectId: siteA,
              splits: [{ projectId: siteB, amountMinor: '1000' }],
            }),
          ]),
        /INVALID_SPLITS/,
      );
      expect((await db.query('SELECT count(*)::int n FROM company_wage_splits')).rows[0].n).toBe(0);
    }));

  it('direct writes to splits are denied and reassignment re-stamps them', () =>
    isolated(async () => {
      await wage(0, [line(3, '1000', { splits: [{ projectId: siteA, amountMinor: '1000' }] })]);
      await denied(() =>
        user(0, () =>
          db.query(
            'INSERT INTO company_wage_splits(group_id,entry_id,project_id,amount_minor) SELECT group_id,entry_id,project_id,1 FROM company_wage_splits',
          ),
        ),
      );
      const before = (await db.query('SELECT updated_seq FROM company_wage_splits')).rows[0]
        .updated_seq;
      const siteBefore = (
        await db.query('SELECT updated_seq FROM company_projects WHERE id=$1', [siteA])
      ).rows[0].updated_seq;
      await user(0, () =>
        db.query('SELECT waves_company_member_assign($1,$2,NULL)', [
          g.memberIds[3],
          g.memberIds[5],
        ]),
      );
      const after = (await db.query('SELECT updated_seq FROM company_wage_splits')).rows[0]
        .updated_seq;
      expect(BigInt(after)).toBeGreaterThan(BigInt(before));
      const siteAfter = (
        await db.query('SELECT updated_seq FROM company_projects WHERE id=$1', [siteA])
      ).rows[0].updated_seq;
      expect(BigInt(siteAfter)).toBeGreaterThan(BigInt(siteBefore)); // the new manager re-pulls the site
      const visible = async (i: number) =>
        (await user(i, () => db.query('SELECT count(*)::int n FROM company_wage_splits'))).rows[0]
          .n;
      expect(await visible(2)).toBe(0); // old manager loses it at once
      expect(await visible(5)).toBe(1); // new manager gets it
    }));
});

describe('company add-ons: second owner approval', () => {
  it('needs two owners to switch on', () =>
    isolated(async () => {
      await db.query("UPDATE group_members SET role='member' WHERE id=$1", [g.memberIds[1]]);
      await denied(() => second(true, null), /NEEDS_SECOND_OWNER/);
    }));

  it('large claims need an owner other than their creator; small ones keep the normal rule', () =>
    isolated(async () => {
      await db.query('UPDATE groups SET company_approvals_enabled=true WHERE id=$1', [g.groupId]);
      await second(true, '500');
      const small = await entry(3, 3, '100');
      const large = await entry(3, 3, '600');
      await review(2, small); // manager approves a small claim as before
      await denied(() => review(2, large), /SECOND_OWNER_REQUIRED/);
      await review(1, large); // any owner may (the creator is an employee)
      expect(
        (await db.query('SELECT status FROM company_entries WHERE id=$1', [large])).rows[0].status,
      ).toBe('approved');
    }));

  it('an owner-raised claim is approved by the other owner, never its creator', () =>
    isolated(async () => {
      await db.query('UPDATE groups SET company_approvals_enabled=true WHERE id=$1', [g.groupId]);
      await second(true, null);
      const raised = await entry(0, 3, '50');
      await denied(() => review(0, raised), /SECOND_OWNER_REQUIRED/);
      await denied(() => review(2, raised), /SECOND_OWNER_REQUIRED/);
      await review(1, raised);
    }));

  it('is off by default, and only owners can change it', () =>
    isolated(async () => {
      expect(
        (await db.query('SELECT company_second_approval FROM groups WHERE id=$1', [g.groupId]))
          .rows[0].company_second_approval,
      ).toBe(false);
      await denied(() =>
        user(2, () =>
          db.query('SELECT waves_company_second_approval_set($1,true,NULL)', [g.groupId]),
        ),
      );
    }));
});
