import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
const user = async <T>(i: number, run: () => Promise<T>): Promise<T> => {
  const previous = (
    await db.query(
      "SELECT current_setting('role') AS role, current_setting('request.jwt.claims',true) AS claims",
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
};
const admin = <T>(run: () => Promise<T>) => user(0, run);
const entry = async (
  data: Record<string, unknown> = {},
  kind = 'expense',
  member = g.memberIds[1],
) => {
  const id = randomUUID();
  await db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [
    g.groupId,
    id,
    member,
    kind,
    JSON.stringify({ amount: '100', occurredOn: '2026-11-10', ...data }),
  ]);
  return id;
};
const row = async (id: string) =>
  (await db.query('SELECT * FROM company_entries WHERE id=$1', [id])).rows[0];
const selection = async (ids: string[]) =>
  Promise.all(
    ids.map(async (entryId) => ({ entryId, expectedVersion: (await row(entryId)).version })),
  );
const reimburse = (
  id: string,
  claims: unknown[],
  adjustments: unknown[] = [],
  amount = '100',
  note: string | null = null,
  member = g.memberIds[1],
) =>
  db.query('SELECT waves_company_reimburse($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
    g.groupId,
    id,
    member,
    JSON.stringify(claims),
    JSON.stringify(adjustments),
    '2026-11-30',
    '2026-12-01',
    amount,
    note,
  ]);
const policies = (rules: unknown[], revision = 0) =>
  db.query('SELECT waves_company_policies_set($1,$2,$3)', [
    g.groupId,
    JSON.stringify({ version: 1, rules }),
    revision,
  ]);
// Isolate tests with rollback; no production connection variables are consulted by connect().
async function isolated(run: () => Promise<void>) {
  await db.query('BEGIN');
  try {
    await run();
  } finally {
    await db.query('ROLLBACK');
  }
}
// A failing statement inside our test transaction needs its own savepoint.
async function denied(run: () => Promise<unknown>) {
  await db.query('SAVEPOINT expected_failure');
  try {
    return await expectDenied(run());
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT expected_failure');
  }
}

beforeAll(async () => {
  db = await connect();
  const seed = await seedGroup(db, { memberCount: 4 });
  g = { ...seed, groupId: randomUUID(), memberIds: seed.memberIds.map(() => randomUUID()) };
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
    [g.groupId, g.profileIds[0]],
  );
  for (let i = 0; i < 3; i++)
    await db.query('INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,$4)', [
      g.memberIds[i],
      g.groupId,
      g.profileIds[i],
      i === 0 ? 'admin' : 'member',
    ]);
});
afterAll(async () => {
  if (db) await db.end();
});

describe('company Phase 3', () => {
  it('grants only application RPCs and retains SELECT-only ledger access', async () => {
    for (const signature of [
      'waves_company_policies_set(uuid,jsonb,integer)',
      'waves_company_mileage_rate_set(uuid,uuid,bigint)',
      'waves_company_reimburse(uuid,uuid,uuid,jsonb,jsonb,date,date,bigint,text)',
    ]) {
      const r = (
        await db.query(
          `SELECT p.prosecdef,p.proconfig,has_function_privilege('authenticated',p.oid,'EXECUTE') AS auth,has_function_privilege('anon',p.oid,'EXECUTE') AS anon,has_function_privilege('service_role',p.oid,'EXECUTE') AS service FROM pg_proc p WHERE p.oid=$1::regprocedure`,
          [signature],
        )
      ).rows[0];
      expect(r).toMatchObject({ prosecdef: true, auth: true, anon: false, service: true });
      expect(r.proconfig).toContain('search_path=public, pg_temp');
    }
    for (const signature of [
      'waves_company_gstin_valid(text)',
      'waves_company_phase3_entry_guard()',
      'waves_company_phase3_photo_guard()',
      'waves_company_phase3_settings_guard()',
      'waves_company_entry_values_v3(text,uuid,jsonb)',
      'waves_company_entry_lock(uuid)',
      'waves_company_entry_values(text,uuid,jsonb)',
    ]) {
      expect(
        (
          await db.query("SELECT has_function_privilege('authenticated',$1,'EXECUTE') AS allowed", [
            signature,
          ])
        ).rows[0].allowed,
      ).toBe(false);
    }
    expect(
      (
        await db.query(
          "SELECT has_table_privilege('authenticated','company_entries','INSERT,UPDATE,DELETE') AS allowed",
        )
      ).rows[0].allowed,
    ).toBe(false);
  });
  it('new entry/member columns are scoped to the employee; admin sees all; outsiders see none', () =>
    isolated(async () => {
      let a = '',
        b = '';
      await admin(async () => {
        await db.query('SELECT waves_company_mileage_rate_set($1,$2,123)', [
          g.groupId,
          g.memberIds[1],
        ]);
        a = await entry({
          vendor: 'Private vendor',
          gstin: '27AAPFU0939F1ZV',
          invoiceNo: 'Private invoice',
          gstRateBps: 1800,
          gstAmountMinor: '15',
        });
        b = await entry(
          {
            calcMode: 'distance_rate',
            distanceKm: '1.25',
            rateMinor: '3',
            category: 'fuel',
            fromText: 'Private start',
            toText: 'Private end',
          },
          'expense',
          g.memberIds[2],
        );
      });
      for (const [i, count] of <[number, number][]>[
        [0, 2],
        [1, 1],
        [2, 1],
        [3, 0],
      ])
        await user(i, async () => {
          const entries = await db.query(
            'SELECT vendor,gstin,invoice_no,gst_rate_bps,gst_amount_minor,distance_km,from_text,to_text,reimbursement_id,reimbursement_details FROM company_entries WHERE id=ANY($1::uuid[])',
            [[a, b]],
          );
          expect(entries.rowCount).toBe(count);
          expect(
            (
              await db.query('SELECT mileage_rate_minor FROM group_members WHERE group_id=$1', [
                g.groupId,
              ])
            ).rowCount,
          ).toBe(i === 0 ? 3 : i === 3 ? 0 : 1);
        });
    }));
  it('employees cannot set policies/rates/reimburse or directly change settings', () =>
    isolated(async () => {
      for (const i of [1, 2, 3]) {
        expect(await denied(() => user(i, () => policies([])))).toMatch(/ADMIN_ONLY|NOT_A_MEMBER/);
        expect(
          await denied(() =>
            user(i, () =>
              db.query('SELECT waves_company_mileage_rate_set($1,NULL,1)', [g.groupId]),
            ),
          ),
        ).toMatch(/ADMIN_ONLY|NOT_A_MEMBER/);
        expect(await denied(() => user(i, () => reimburse(randomUUID(), [])))).toMatch(
          /ADMIN_ONLY|NOT_A_MEMBER/,
        );
      }
      expect(
        await denied(() =>
          user(1, () =>
            db.query('UPDATE groups SET company_policy_revision=1 WHERE id=$1', [g.groupId]),
          ),
        ),
      ).toMatch(/FORBIDDEN_COLUMN/);
      expect(
        await denied(() =>
          user(1, () =>
            db.query('UPDATE group_members SET mileage_rate_minor=1 WHERE id=$1', [g.memberIds[1]]),
          ),
        ),
      ).toMatch(/FORBIDDEN_COLUMN/);
    }));
  it.each(['27AAPFU0939F1ZV', '29AAACB2894G1ZJ'])(
    'accepts valid GSTIN %s and normalizes case/whitespace',
    (gstin) =>
      isolated(async () => {
        await admin(async () =>
          expect((await row(await entry({ gstin: ` ${gstin.toLowerCase()} ` }))).gstin).toBe(gstin),
        );
      }),
  );
  it.each([
    '27AAPFU0939F1ZA',
    '00AAPFU0939F1ZV',
    '39AAPFU0939F1ZV',
    '27AAPFU0939F0ZV',
    '27AAPFU0939F1XV',
    'invalid',
  ])('rejects invalid GSTIN %s', (gstin) =>
    isolated(async () => {
      expect(await denied(() => admin(() => entry({ gstin })))).toMatch(/INVALID_GSTIN/);
    }),
  );
  it('gates every GST/vendor field to IN/INR typed expenses and checks GST bounds', () =>
    isolated(async () => {
      expect(await denied(() => admin(() => entry({ vendor: 'Shop' }, 'advance')))).toMatch(
        /GST_NOT_APPLICABLE/,
      );
      expect(
        await denied(() =>
          admin(() =>
            entry({
              vendor: 'Shop',
              calcMode: 'distance_rate',
              distanceKm: '1',
              rateMinor: '1',
              category: 'fuel',
            }),
          ),
        ),
      ).toMatch(/GST_NOT_APPLICABLE/);
      for (const [country, currency] of [
        ['US', 'INR'],
        ['IN', 'USD'],
      ]) {
        await db.query('UPDATE groups SET country_code=$2,default_currency=$3 WHERE id=$1', [
          g.groupId,
          country,
          currency,
        ]);
        expect(await denied(() => admin(() => entry({ invoiceNo: 'A' })))).toMatch(
          /GST_NOT_APPLICABLE/,
        );
      }
      await db.query("UPDATE groups SET country_code='IN',default_currency='INR' WHERE id=$1", [
        g.groupId,
      ]);
      expect(await denied(() => admin(() => entry({ gstAmountMinor: '101' })))).toMatch(
        /check constraint|INVALID_GST/,
      );
      expect(await denied(() => admin(() => entry({ gstRateBps: 10001 })))).toMatch(
        /check constraint|INVALID_GST/,
      );
    }));
  it.each([
    ['0.50', '3', '2'],
    ['1.25', '3', '4'],
    ['1.00', '0', '0'],
    ['999999.99', '1', '1000000'],
  ])('recomputes mileage %s × %s = %s', (distanceKm, rateMinor, amount) =>
    isolated(async () => {
      await admin(async () =>
        expect(
          await row(
            await entry({
              amount: '999',
              category: 'fuel',
              calcMode: 'distance_rate',
              distanceKm,
              rateMinor,
            }),
          ),
        ).toMatchObject({ amount, rate_minor: rateMinor, distance_km: distanceKm }),
      );
    }),
  );
  it.each([
    { distanceKm: '1.001', rateMinor: '1', category: 'fuel' },
    { distanceKm: '0', rateMinor: '1', category: 'fuel' },
    { distanceKm: '1', rateMinor: null, category: 'fuel' },
    { distanceKm: '1', rateMinor: '1', category: 'food' },
  ])('rejects invalid mileage %j', (data) =>
    isolated(async () => {
      expect(
        await denied(() => admin(() => entry({ ...data, calcMode: 'distance_rate' }))),
      ).toMatch(/INVALID_|check constraint/);
    }),
  );
  it('policy equality, self exclusion, calendar periods, rejected/voided exclusions and warn-only receipts', () =>
    isolated(async () => {
      await admin(async () => {
        await policies([
          {
            id: 'fuel',
            type: 'period_limit',
            target: 'fuel',
            period: 'month',
            effect: 'block',
            limitMinor: '200',
          },
          { id: 'receipt', type: 'receipt_above', effect: 'warn', limitMinor: '0' },
        ]);
        const a = await entry({ category: 'fuel' }),
          b = await entry({ category: 'fuel' });
        await db.query('SELECT waves_company_entry_update($1,$2)', [
          a,
          JSON.stringify({ amount: '100' }),
        ]);
        expect(await denied(() => entry({ category: 'fuel', amount: '1' }))).toMatch(
          /POLICY_BLOCKED: period limit exceeded \(rule fuel\)/,
        );
        await entry({ category: 'fuel', occurredOn: '2026-12-01' });
        await db.query("SELECT waves_company_entry_void($1,'correction')", [b]);
        await entry({ category: 'fuel' });
        await db.query('SELECT waves_company_settings_set($1,NULL,true)', [g.groupId]);
        const rejected = await entry({ category: 'food' });
        await db.query("SELECT waves_company_entry_transition($1,'rejected','No',1)", [rejected]);
        await policies(
          [
            {
              id: 'food',
              type: 'period_limit',
              target: 'food',
              period: 'day',
              effect: 'block',
              limitMinor: '100',
            },
          ],
          1,
        );
        await entry({ category: 'food' });
        expect(
          await denied(() =>
            db.query('SELECT waves_company_entry_update($1,$2)', [
              rejected,
              JSON.stringify({ note: 'retry' }),
            ]),
          ),
        ).toMatch(/POLICY_BLOCKED/);
      });
    }));
  it.each(['day', 'month'])('counts null expense categories as other for %s limits', (period) =>
    isolated(async () => {
      await admin(async () => {
        await policies([
          {
            id: 'other-limit',
            type: 'period_limit',
            target: 'other',
            period,
            effect: 'block',
            limitMinor: '100',
          },
        ]);
        // Both the incoming match and cumulative total must use the client's null => other rule.
        expect(await denied(() => entry({ amount: '101', category: null }))).toMatch(
          /POLICY_BLOCKED/,
        );
        const uncategorized = await entry({ amount: '60', category: null });
        const explicit = await entry({ amount: '40', category: 'other' });
        expect((await row(uncategorized)).category).toBeNull();
        expect(await denied(() => entry({ amount: '1', category: 'other' }))).toMatch(
          /POLICY_BLOCKED/,
        );
        expect(await denied(() => entry({ amount: '1', category: null }))).toMatch(
          /POLICY_BLOCKED/,
        );
        for (const id of [uncategorized, explicit]) {
          expect(
            await denied(() =>
              db.query('SELECT waves_company_entry_update($1,$2)', [
                id,
                JSON.stringify({ amount: '61', category: null }),
              ]),
            ),
          ).toMatch(/POLICY_BLOCKED/);
        }
        await entry({ amount: '101', category: 'fuel' }); // unrelated categories remain separate
      });
    }),
  );
  it('entry and evidence RPCs share reimbursement lock order', async () => {
    // PGlite cannot exercise concurrent sessions: inspect the ordering as well as the
    // update-after-reimburse ENTRY_REIMBURSED regression below.
    const definition = async (signature: string) =>
      (await db.query('SELECT pg_get_functiondef($1::regprocedure) AS sql', [signature])).rows[0]
        .sql;
    const guard = await definition('waves_company_phase3_entry_guard()');
    expect(guard.match(/pg_advisory_xact_lock/g)).toHaveLength(1);
    expect(guard).toContain("IF TG_OP='INSERT' THEN PERFORM pg_advisory_xact_lock");
    const lock = await definition('waves_company_entry_lock(uuid)');
    expect(lock.indexOf('pg_advisory_xact_lock')).toBeLessThan(lock.indexOf('FOR UPDATE'));
    expect(lock).toContain('locked.member_id IS DISTINCT FROM scope.member_id');
    expect(lock).toContain('locked.group_id IS DISTINCT FROM scope.group_id');
    for (const signature of [
      'waves_company_entry_update(uuid,jsonb)',
      'waves_company_entry_void(uuid,text)',
      'waves_company_entry_transition(uuid,text,text,integer)',
      'waves_attach_company_entry_image(uuid,text,uuid,text)',
      'waves_remove_company_entry_image(uuid)',
      'waves_company_evidence_changed(uuid,uuid)',
      'waves_company_storage_write(uuid,uuid,text,bigint,text,boolean)',
      'waves_company_cancel_upload(uuid,text,uuid,boolean)',
      'waves_company_expire_unattached()',
    ]) {
      const sql = await definition(signature);
      expect(sql).toContain('waves_company_entry_lock(');
      if (sql.includes('FOR UPDATE')) {
        expect(sql.indexOf('waves_company_entry_lock(')).toBeLessThan(sql.indexOf('FOR UPDATE'));
      }
    }
  });
  it('rechecks approval under current policies without rewriting approved history', () =>
    isolated(async () => {
      await admin(async () => {
        await db.query('SELECT waves_company_settings_set($1,NULL,true)', [g.groupId]);
        const id = await entry({ category: 'fuel' });
        await policies([
          {
            id: 'limit',
            type: 'period_limit',
            target: 'fuel',
            period: 'day',
            effect: 'block',
            limitMinor: '99',
          },
        ]);
        expect(
          await denied(() =>
            db.query("SELECT waves_company_entry_transition($1,'approved',NULL,1)", [id]),
          ),
        ).toMatch(/POLICY_BLOCKED/);
        expect((await row(id)).status).toBe('submitted');
      });
    }));
  it('bulk reimbursement is atomic, accounts for all credits, is idempotent, and freezes covered rows', () =>
    isolated(async () => {
      await admin(async () => {
        const a = await entry({ amount: '200' });
        const advance = await entry({ amount: '30' }, 'advance');
        const payout = await entry({ amount: '20' }, 'reimbursement');
        const cash = await entry(
          { amount: '10', direction: 'employee_to_company' },
          'reimbursement',
        );
        const claims = await selection([a]),
          adjustments = await selection([advance, payout, cash]);
        const id = randomUUID();
        expect(await denied(() => reimburse(id, claims, [], '160'))).toMatch(/SELECTION_CHANGED/);
        expect(await row(id)).toBeUndefined();
        await reimburse(id, claims, adjustments, '160');
        const r = await row(id);
        expect(r).toMatchObject({
          amount: '160',
          status: 'approved',
          occurred_on: expect.any(Date),
        });
        expect(r.reimbursement_details).toMatchObject({
          claimsMinor: '200',
          creditsMinor: '40',
          payoutMinor: '160',
        });
        expect(await row(a)).toMatchObject({
          status: 'reimbursed',
          version: 2,
          reimbursement_id: id,
        });
        expect(await row(advance)).toMatchObject({
          status: 'approved',
          version: 2,
          reimbursement_id: id,
        });
        await reimburse(id, claims, adjustments, '160'); // stale versions are valid on exact retry
        expect((await row(a)).version).toBe(2);
        expect(await denied(() => reimburse(id, claims, adjustments, '160', 'changed'))).toMatch(
          /IDEMPOTENCY_CONFLICT/,
        );
        expect(await denied(() => reimburse(randomUUID(), claims, adjustments, '160'))).toMatch(
          /SELECTION_CHANGED/,
        );
        for (const target of [a, advance, payout, cash, id]) {
          expect(
            await denied(() =>
              db.query('SELECT waves_company_entry_update($1,$2)', [
                target,
                JSON.stringify({ note: 'edit' }),
              ]),
            ),
          ).toMatch(/ENTRY_REIMBURSED/);
          expect(
            await denied(() => db.query("SELECT waves_company_entry_void($1,'void')", [target])),
          ).toMatch(/ENTRY_REIMBURSED/);
        }
      });
    }));
  it('stale versions and incorrect payout roll back every row; zero clearing is supported with approvals on', () =>
    isolated(async () => {
      await admin(async () => {
        const a = await entry(),
          advance = await entry({}, 'advance');
        const claims = await selection([a]),
          adjustments = await selection([advance]);
        const id = randomUUID();
        expect(
          await denied(() =>
            reimburse(id, [{ ...claims[0], expectedVersion: 99 }], adjustments, '0'),
          ),
        ).toMatch(/SELECTION_CHANGED/);
        expect(await denied(() => reimburse(id, claims, adjustments, '1'))).toMatch(
          /SELECTION_CHANGED/,
        );
        expect(await row(id)).toBeUndefined();
        expect((await row(a)).reimbursement_id).toBeNull();
        await db.query('SELECT waves_company_settings_set($1,NULL,true)', [g.groupId]);
        await reimburse(id, claims, adjustments, '0');
        expect(await row(id)).toMatchObject({ amount: '0', status: 'approved' });
        expect((await row(a)).status).toBe('reimbursed');
      });
    }));
  it('refuses negative credit allocation, wages, submitted claims, and claims after cutoff', () =>
    isolated(async () => {
      await admin(async () => {
        const a = await entry(),
          advance = await entry({ amount: '200' }, 'advance');
        const claims = await selection([a]),
          adjustments = await selection([advance]);
        expect(await denied(() => reimburse(randomUUID(), claims, adjustments, '0'))).toMatch(
          /SELECTION_CHANGED/,
        );
        for (const id of [await entry({}, 'wages'), await entry({ occurredOn: '2026-12-01' })]) {
          const selected = await selection([id]);
          expect(await denied(() => reimburse(randomUUID(), selected, adjustments, '0'))).toMatch(
            /SELECTION_CHANGED/,
          );
          expect((await row(id)).reimbursement_id).toBeNull();
        }
        await db.query('SELECT waves_company_settings_set($1,NULL,true)', [g.groupId]);
        const submitted = await entry(),
          selected = await selection([submitted]);
        expect(await denied(() => reimburse(randomUUID(), selected, adjustments, '0'))).toMatch(
          /SELECTION_CHANGED/,
        );
        expect((await row(a)).reimbursement_id).toBeNull();
      });
    }));
  it('freezes photos and reviews on covered rows without partial evidence changes', () =>
    isolated(async () => {
      const id = await admin(() => entry()),
        photo = randomUUID();
      await db.query(
        'INSERT INTO company_entry_attachments(id,entry_id,group_id,uploader_member_id,storage_path) VALUES($1,$2,$3,$4,$5)',
        [photo, id, g.groupId, g.memberIds[0], `${id}/${photo}/${randomUUID()}.jpg`],
      );
      await admin(async () => {
        await reimburse(randomUUID(), await selection([id]));
        expect(
          await denied(() => db.query('SELECT waves_remove_company_entry_image($1)', [photo])),
        ).toMatch(/ENTRY_REIMBURSED/);
        expect(
          (await db.query('SELECT deleted_at FROM company_entry_attachments WHERE id=$1', [photo]))
            .rows[0].deleted_at,
        ).toBeNull();
        // The existing review RPC refuses this state before writing; no change is possible.
        expect(
          await denied(() =>
            db.query("SELECT waves_company_entry_transition($1,'rejected','changed',2)", [id]),
          ),
        ).toMatch(/INVALID_TRANSITION|ENTRY_REIMBURSED/);
        expect((await row(id)).status).toBe('reimbursed');
      });
    }));
  it('SQL boundary independently enforces GST gating, checksum, and mileage amount', () =>
    isolated(async () => {
      const id = await admin(() => entry());
      expect(
        await denied(() =>
          db.query("UPDATE company_entries SET gstin='27AAPFU0939F1ZA' WHERE id=$1", [id]),
        ),
      ).toMatch(/INVALID_GSTIN/);
      await db.query(
        "UPDATE company_entries SET vendor='Shop',gstin='27aapfu0939f1zv',gst_amount_minor=10 WHERE id=$1",
        [id],
      );
      expect((await row(id)).gstin).toBe('27AAPFU0939F1ZV');
      expect(
        await denied(() =>
          db.query(
            "UPDATE company_entries SET calc_mode='distance_rate',category='fuel',distance_km=0.50,rate_minor=3 WHERE id=$1",
            [id],
          ),
        ),
      ).toMatch(/GST_NOT_APPLICABLE/);
      await db.query(
        "UPDATE company_entries SET vendor=NULL,gstin=NULL,gst_amount_minor=NULL,calc_mode='distance_rate',category='fuel',distance_km=0.50,rate_minor=3 WHERE id=$1",
        [id],
      );
      expect((await row(id)).amount).toBe('2');
      expect(
        await denied(() => db.query('UPDATE company_entries SET category=NULL WHERE id=$1', [id])),
      ).toMatch(/check constraint/);
    }));
  it('new validator normalizes GSTIN and computes mileage before any table write', () =>
    isolated(async () => {
      await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: g.profileIds[0], role: 'authenticated' }),
      ]);
      const validate = async (data: Record<string, unknown>) =>
        (
          await db.query("SELECT waves_company_entry_values_v3('expense',$1,$2) AS data", [
            g.memberIds[1],
            JSON.stringify({ amount: '100', occurredOn: '2026-11-10', ...data }),
          ])
        ).rows[0].data;
      expect(await validate({ gstin: ' 27aapfu0939f1zv ' })).toMatchObject({
        gstin: '27AAPFU0939F1ZV',
      });
      expect(
        await validate({
          calcMode: 'distance_rate',
          category: 'fuel',
          distanceKm: '0.50',
          rateMinor: '3',
        }),
      ).toMatchObject({ amount: 2, rateMinor: 3, distanceKm: 0.5 });
      expect(
        await denied(() =>
          validate({
            calcMode: 'distance_rate',
            category: 'fuel',
            distanceKm: '1.001',
            rateMinor: '3',
          }),
        ),
      ).toMatch(/INVALID_DISTANCE/);
      expect(await denied(() => validate({ gstin: '27AAPFU0939F1ZA' }))).toMatch(/INVALID_GSTIN/);
      expect(await denied(() => validate({ distanceKm: 1 }))).toMatch(/INVALID_DATA/);
    }));
  it('policy revision and mileage settings reject foreign employees and malformed rules', () =>
    isolated(async () => {
      await admin(async () => {
        await policies([]);
        expect(await denied(() => policies([], 0))).toMatch(
          /VERSION_CONFLICT: policies changed; refresh before saving/,
        );
        expect(
          await denied(() =>
            policies(
              [{ id: 'receipt', type: 'receipt_above', effect: 'block', limitMinor: '10' }],
              1,
            ),
          ),
        ).toMatch(/INVALID_POLICIES/);
        expect(
          await denied(() =>
            policies(
              [
                {
                  id: 'x',
                  type: 'period_limit',
                  effect: 'block',
                  limitMinor: '-1',
                  target: 'fuel',
                  period: 'month',
                },
              ],
              1,
            ),
          ),
        ).toMatch(/INVALID_POLICIES/);
        expect(
          await denied(() =>
            db.query('SELECT waves_company_mileage_rate_set($1,$2,1)', [g.groupId, randomUUID()]),
          ),
        ).toMatch(/UNKNOWN_MEMBER/);
        await db.query('SELECT waves_company_mileage_rate_set($1,NULL,3)', [g.groupId]);
        await db.query('SELECT waves_company_mileage_rate_set($1,$2,0)', [
          g.groupId,
          g.memberIds[1],
        ]);
        expect(
          (
            await db.query('SELECT company_default_mileage_rate_minor FROM groups WHERE id=$1', [
              g.groupId,
            ])
          ).rows[0].company_default_mileage_rate_minor,
        ).toBe('3');
        expect(
          (
            await db.query('SELECT mileage_rate_minor FROM group_members WHERE id=$1', [
              g.memberIds[1],
            ])
          ).rows[0].mileage_rate_minor,
        ).toBe('0');
        await db.query('SELECT waves_company_mileage_rate_set($1,$2,NULL)', [
          g.groupId,
          g.memberIds[1],
        ]);
        expect(
          (
            await db.query('SELECT mileage_rate_minor FROM group_members WHERE id=$1', [
              g.memberIds[1],
            ])
          ).rows[0].mileage_rate_minor,
        ).toBeNull();
      });
    }));
  it('reimbursement details remain caller-scoped and foreign claims are rejected atomically', () =>
    isolated(async () => {
      const a = await admin(() => entry()),
        foreign = await admin(() => entry({}, 'expense', g.memberIds[2]));
      const id = randomUUID();
      await admin(async () => {
        const foreignSelection = await selection([foreign]);
        expect(await denied(() => reimburse(id, foreignSelection))).toMatch(/SELECTION_CHANGED/);
      });
      await admin(async () => {
        await reimburse(id, await selection([a]));
      });
      for (const [i, count] of <[number, number][]>[
        [0, 1],
        [1, 1],
        [2, 0],
        [3, 0],
      ])
        await user(i, async () => {
          const rows = await db.query(
            'SELECT reimbursement_details FROM company_entries WHERE id=$1',
            [id],
          );
          expect(rows.rowCount).toBe(count);
          if (count) expect(rows.rows[0].reimbursement_details.payoutMinor).toBe('100');
        });
      expect((await row(foreign)).reimbursement_id).toBeNull();
    }));
  it('status alone preserves balance; reimbursement reduces balance once', () =>
    isolated(async () => {
      const a = await admin(() => entry());
      const net = async () =>
        (
          await db.query(
            `SELECT sum(CASE WHEN entry_kind='advance' OR (entry_kind='reimbursement' AND direction='company_to_employee') THEN -amount ELSE amount END)::text AS net FROM company_entries WHERE group_id=$1 AND deleted_at IS NULL AND status IN ('approved','reimbursed') AND entry_kind<>'wages'`,
            [g.groupId],
          )
        ).rows[0].net;
      expect(await net()).toBe('100');
      await db.query("UPDATE company_entries SET status='reimbursed' WHERE id=$1", [a]);
      expect(await net()).toBe('100');
      await db.query("UPDATE company_entries SET status='approved' WHERE id=$1", [a]);
      await admin(async () => {
        const claims = await selection([a]),
          id = randomUUID();
        await reimburse(id, claims);
        expect(await net()).toBe('0');
        await reimburse(id, claims);
        expect(await net()).toBe('0');
      });
    }));
});
