/**
 * G42–G43: Admin RPCs – monitor, block/unblock, complaint, export, remove-member,
 * quota, moderation matrix, rate limits, append-only log.
 *
 * Members: 0 owner, 1 manager, 2 employee, 3 vendor.
 * Uses service_role for admin calls.
 */
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

const today = new Date().toISOString().slice(0, 10);

let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
const vendorId = randomUUID();

async function as<T>(
  profileId: string,
  run: () => Promise<T>,
  role: 'authenticated' | 'service_role' = 'authenticated',
): Promise<T> {
  await db.query('SAVEPOINT actor_scope');
  try {
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify(role === 'service_role' ? { role } : { sub: profileId, role }),
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

const admin = <T>(run: () => Promise<T>) => as('', run, 'service_role');

async function isolated(run: () => Promise<void>) {
  await db.query('BEGIN');
  try {
    await run();
  } finally {
    await db.query('ROLLBACK');
  }
}

async function denied(run: () => Promise<unknown>, match = /permission denied|NOT_ALLOWED|INVALID_DATA/) {
  await db.query('SAVEPOINT expected_failure');
  try {
    expect(await expectDenied(run())).toMatch(match);
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT expected_failure');
  }
}

const block = (reason = 'Complaint from staff') =>
  admin(() =>
    db.query("SELECT waves_admin_company_block($1,'complaint',$2)", [g.groupId, reason]),
  );

const unblock = (reason = 'Resolved') =>
  admin(() => db.query("SELECT waves_admin_company_unblock($1,$2)", [g.groupId, reason]));

const expense = (i: number) =>
  as(g.profileIds[i]!, () =>
    db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [
      g.groupId,
      randomUUID(),
      g.memberIds[i]!,
      'expense',
      JSON.stringify({ amount: '100', occurredOn: today }),
    ]),
  );

beforeAll(async () => {
  db = await connect();

  g = await seedGroup(db, { memberCount: 4 });
  await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
  g.groupId = randomUUID();
  await db.query(
    "INSERT INTO groups(id,name,type,default_currency,country_code,created_by) VALUES($1,'Acme Works','company','INR','IN',$2)",
    [g.groupId, g.profileIds[0]!],
  );
  const roles = ['admin', 'manager', 'member', 'vendor'];
  for (let i = 0; i < 4; i++) {
    await db.query(
      'INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)',
      [g.memberIds[i]!, g.groupId, g.profileIds[i]!, roles[i], i === 2 ? g.memberIds[1]! : null],
    );
  }

  // Seed a vendor (can't use as() here because SAVEPOINT requires a transaction)
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: g.profileIds[0]!, role: 'authenticated' }),
  ]);
  await db.query('SET ROLE authenticated');
  await db.query('SELECT waves_company_vendor_set($1,$2,$3)', [
    g.groupId,
    vendorId,
    JSON.stringify({ name: 'Test Vendor' }),
  ]);
  await db.query('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claims','',false)");
  await db.query('UPDATE company_vendors SET member_id=$1 WHERE id=$2', [g.memberIds[3]!, vendorId]);
});

afterAll(async () => {
  if (db) await db.end();
});

// ---------------------------------------------------------------------------
// G42: Admin RPCs – require admin role, reason required, metadata-only monitor
// ---------------------------------------------------------------------------
describe('G42: admin RPCs – block, unblock, export, records, complaint', () => {
  it('non-admin cannot call admin RPCs', () =>
    isolated(async () => {
      for (let i = 0; i < 4; i++) {
        await denied(
          () => as(g.profileIds[i]!, () => db.query('SELECT waves_admin_companies()')),
          /permission denied/,
        );
        await denied(
          () =>
            as(g.profileIds[i]!, () =>
              db.query("SELECT waves_admin_company_block($1,'other','x')", [g.groupId]),
            ),
          /permission denied/,
        );
      }
    }));

  it('block requires a non-blank reason', () =>
    isolated(async () => {
      await denied(
        () => admin(() => db.query("SELECT waves_admin_company_block($1,'complaint','  ')", [g.groupId])),
        /INVALID_DATA/,
      );
    }));

  it('block suspends the company; unblock restores it; both are logged', () =>
    isolated(async () => {
      await block('Staff wages complaint');
      const suspended = (
        await db.query('SELECT suspended_at FROM groups WHERE id=$1', [g.groupId])
      ).rows[0].suspended_at;
      expect(suspended).not.toBeNull();

      await unblock();
      const restored = (
        await db.query('SELECT suspended_at FROM groups WHERE id=$1', [g.groupId])
      ).rows[0].suspended_at;
      expect(restored).toBeNull();

      const log = (
        await db.query(
          'SELECT action,reason FROM company_moderation_log WHERE group_id=$1 ORDER BY id',
          [g.groupId],
        )
      ).rows;
      expect(log.map((r) => r.action)).toEqual(['block', 'unblock']);
      expect(log[0].reason).toBe('Staff wages complaint');
    }));

  it('admin detail shows complaint body but omits reporter profile_id', () =>
    isolated(async () => {
      await db.query("DELETE FROM rate_limit_hits WHERE bucket='company-report'");
      await as(g.profileIds[2]!, () =>
        db.query("SELECT waves_company_report($1,'wages','They owe me')", [g.groupId]),
      );
      const detail = await admin(
        async () =>
          (await db.query('SELECT waves_admin_company_detail($1) AS r', [g.groupId])).rows[0].r,
      );
      expect(detail.members).toBeDefined();
      expect(detail.complaints).toHaveLength(1);
      // Admin can see the complaint body (that's the purpose of admin_company_detail)
      expect(detail.complaints[0].body).toBe('They owe me');
      // But reporter's raw profile_id must not be exposed (it's anonymized to reporter_role only)
      expect(detail.complaints[0].reporter_profile_id).toBeUndefined();
      // reporter_role is visible (member/manager) – this is not PII
      expect(detail.complaints[0].reporter_role).toBeDefined();
    }));

  it('records export requires open_records first; export log is appended', () =>
    isolated(async () => {
      await denied(
        () => admin(() => db.query('SELECT waves_admin_company_records($1)', [g.groupId])),
        /REASON_REQUIRED/,
      );

      await admin(() =>
        db.query("SELECT waves_admin_company_open_records($1,'Police FIR')", [g.groupId]),
      );
      const recs = await admin(
        async () =>
          (await db.query('SELECT waves_admin_company_records($1) AS r', [g.groupId])).rows[0].r,
      );
      expect(recs).toBeDefined();

      const actions = (
        await db.query(
          'SELECT action FROM company_moderation_log WHERE group_id=$1 ORDER BY id',
          [g.groupId],
        )
      ).rows.map((r) => r.action);
      expect(actions).toContain('records_opened');
    }));

  it('moderation log is append-only (no UPDATE or DELETE)', () =>
    isolated(async () => {
      await block('Test block');
      await denied(
        () => admin(() => db.query("UPDATE company_moderation_log SET reason='x'")),
        /LOG_APPEND_ONLY/,
      );
      await denied(
        () => admin(() => db.query('DELETE FROM company_moderation_log')),
        /LOG_APPEND_ONLY|permission denied/,
      );
    }));
});

// ---------------------------------------------------------------------------
// G43: Moderation – report rate limits, blocked-state consistency
// ---------------------------------------------------------------------------
describe('G43: moderation – rate limits, reports, blocked state', () => {
  it('any member or vendor can report; outsider cannot', () =>
    isolated(async () => {
      await db.query("DELETE FROM rate_limit_hits WHERE bucket='company-report'");
      const r0 = await as(
        g.profileIds[0]!,
        async () =>
          (
            await db.query("SELECT waves_company_report($1,'wages','Not paid') AS r", [g.groupId])
          ).rows[0].r,
      );
      expect(r0.ok).toBe(true);

      const r3 = await as(
        g.profileIds[3]!,
        async () =>
          (
            await db.query("SELECT waves_company_report($1,'wages','Not paid') AS r", [g.groupId])
          ).rows[0].r,
      );
      expect(r3.ok).toBe(true);

      // Outsider (no membership) is rejected
      const outsider = randomUUID();
      await db.query('INSERT INTO profiles(id,display_name,default_currency) VALUES($1,$2,$3)', [
        outsider,
        'Outsider',
        'INR',
      ]);
      await denied(
        () =>
          as(outsider, () =>
            db.query("SELECT waves_company_report($1,'wages','Not paid') AS r", [g.groupId]),
          ),
        /NOT_A_MEMBER/,
      );
    }));

  it('report is rate-limited per person', () =>
    isolated(async () => {
      await db.query("DELETE FROM rate_limit_hits WHERE bucket='company-report'");
      for (let i = 0; i < 5; i++) {
        await as(g.profileIds[2]!, () =>
          db.query("SELECT waves_company_report($1,'wages','Not paid') AS r", [g.groupId]),
        );
      }
      const limited = await as(
        g.profileIds[2]!,
        async () =>
          (
            await db.query("SELECT waves_company_report($1,'wages','Not paid') AS r", [g.groupId])
          ).rows[0].r,
      );
      expect(limited).toMatchObject({ ok: false, reason: 'RATE_LIMITED' });

      // Other person is not rate-limited
      const other = await as(
        g.profileIds[1]!,
        async () =>
          (
            await db.query("SELECT waves_company_report($1,'wages','Not paid') AS r", [g.groupId])
          ).rows[0].r,
      );
      expect(other.ok).toBe(true);
    }));

  it('blocked state prevents all writes; report and unblock remain available', () =>
    isolated(async () => {
      await block('Wage complaint');
      await denied(() => expense(0), /COMPANY_BLOCKED/);
      await denied(() => expense(2), /COMPANY_BLOCKED/);

      // Members can still report even when blocked
      await db.query("DELETE FROM rate_limit_hits WHERE bucket='company-report'");
      const r = await as(
        g.profileIds[2]!,
        async () =>
          (
            await db.query("SELECT waves_company_report($1,'wages','Still unpaid') AS r", [
              g.groupId,
            ])
          ).rows[0].r,
      );
      expect(r.ok).toBe(true);

      // Admin can unblock
      await unblock();
      // After unblock, writes are permitted again
      await expense(0);
    }));
});
