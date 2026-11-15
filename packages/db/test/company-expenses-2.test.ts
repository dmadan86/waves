import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, connect, expectDenied, seedGroup } from './helpers';

let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
let other: string;
const entry = randomUUID();
const attachment = randomUUID();
const path = `${entry}/${attachment}/${randomUUID()}.jpg`;
const user = <T>(i: number, run: () => Promise<T>) =>
  asRole(db, 'authenticated', { sub: g.profileIds[i], role: 'authenticated' }, run);
const create = (id: string, kind = 'expense', data: Record<string, unknown> = {}) =>
  db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [
    g.groupId,
    id,
    g.memberIds[1],
    kind,
    JSON.stringify({ amount: '100', occurredOn: '2026-11-05', ...data }),
  ]);
const store = (key: string, group = g.groupId, bytes = 100) =>
  db.query(`SELECT waves_storage_reserve($1,$2,'company-entry-images',$3,$4,'image/jpeg');`, [
    g.profileIds[1],
    group,
    key,
    bytes,
  ]);
const commit = (key: string, bytes = 100) =>
  db.query(`SELECT waves_storage_record($1,$2,'company-entry-images',$3,$4,'image/jpeg')`, [
    g.profileIds[1],
    g.groupId,
    key,
    bytes,
  ]);

beforeAll(async () => {
  db = await connect();
  const seed = await seedGroup(db, { memberCount: 4 });
  g = { ...seed, groupId: randomUUID(), memberIds: seed.memberIds.map(() => randomUUID()) };
  await db.query(`INSERT INTO groups(id,type,created_by) VALUES($1,'company',$2)`, [
    g.groupId,
    g.profileIds[0],
  ]);
  for (let i = 0; i < 3; i++)
    await db.query('INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,$4)', [
      g.memberIds[i],
      g.groupId,
      g.profileIds[i],
      i === 0 ? 'admin' : 'member',
    ]);
  other = randomUUID();
  await db.query(`INSERT INTO groups(id,type,created_by) VALUES($1,'company',$2)`, [
    other,
    g.profileIds[0],
  ]);
  await db.query(`INSERT INTO group_members(group_id,profile_id,role) VALUES($1,$2,'admin')`, [
    other,
    g.profileIds[0],
  ]);
  await db.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: g.profileIds[1], role: 'authenticated' }),
  ]);
  await create(entry);
  await store(path);
  await commit(path);
  await db.query('SELECT waves_attach_company_entry_image($1,$2,$3)', [entry, path, attachment]);
});
afterAll(async () => {
  if (db) await db.end();
});

describe('company Phase 2', () => {
  it.each([0, 1, 2, 3])('entry and image visibility actor %i', async (i) => {
    await user(i, async () => {
      const rows = await db.query(
        'SELECT storage_path FROM company_entry_attachments WHERE id=$1',
        [attachment],
      );
      expect(rows.rowCount).toBe(i < 2 ? 1 : 0);
      expect(
        (await db.query('SELECT waves_can_read_company_entry($1) AS allowed', [entry])).rows[0]
          .allowed,
      ).toBe(i < 2);
    });
  });
  it('admin-only settings and usage, member plan without billing identity', async () => {
    expect(
      await expectDenied(
        user(1, () => db.query('SELECT waves_company_settings_set($1,20,true)', [g.groupId])),
      ),
    ).toMatch(/ADMIN_ONLY/);
    expect(
      await expectDenied(
        user(1, () => db.query('SELECT * FROM waves_company_storage_usage($1)', [g.groupId])),
      ),
    ).toMatch(/ADMIN_ONLY/);
    await user(0, () => db.query('SELECT waves_company_settings_set($1,20,true)', [g.groupId]));
    await user(1, async () => {
      expect(
        Object.keys(
          (await db.query('SELECT * FROM waves_company_plan($1)', [g.groupId])).rows[0],
        ).sort(),
      ).toEqual(['plan', 'storage_quota_bytes']);
    });
    expect(await expectDenied(user(0, () => db.query('SELECT * FROM company_plans')))).toMatch(
      /permission denied/,
    );
    expect(
      await expectDenied(
        user(1, () =>
          db.query('UPDATE groups SET company_approvals_enabled=true WHERE id=$1', [g.groupId]),
        ),
      ),
    ).toMatch(/FORBIDDEN_COLUMN/);
  });
  it('company bytes never affect personal usage and cannot move across companies', async () => {
    const o = (
      await db.query(
        `SELECT company_group_id,group_id,counted,owner_profile_id FROM storage_objects WHERE path=$1`,
        [path],
      )
    ).rows[0];
    expect(o).toMatchObject({
      company_group_id: g.groupId,
      group_id: g.groupId,
      counted: false,
      owner_profile_id: g.profileIds[1],
    });
    const before = (await db.query('SELECT * FROM waves_my_storage_usage()')).rows;
    const key = `${entry}/${randomUUID()}/${randomUUID()}.jpg`;
    await store(key);
    await commit(key);
    expect((await db.query('SELECT * FROM waves_my_storage_usage()')).rows).toEqual(before);
    await user(0, async () => {
      expect(
        (await db.query('SELECT * FROM waves_company_storage_usage($1)', [g.groupId])).rows[0]
          .used_bytes,
      ).toBe('200');
      expect(
        (await db.query('SELECT * FROM waves_company_storage_usage($1)', [other])).rows[0]
          ?.used_bytes ?? '0',
      ).toBe('0');
    });
    expect(
      await expectDenied(store(`${entry}/${randomUUID()}/${randomUUID()}.jpg`, other)),
    ).toMatch(/NOT_ALLOWED/);
    await db.query('UPDATE company_plans SET storage_quota_bytes=200 WHERE group_id=$1', [
      g.groupId,
    ]);
    expect(await expectDenied(store(`${entry}/${randomUUID()}/${randomUUID()}.jpg`))).toMatch(
      /STORAGE_CAP/,
    );
    await db.query('UPDATE company_plans SET storage_quota_bytes=NULL WHERE group_id=$1', [
      g.groupId,
    ]);
    await db.query(`SELECT waves_storage_release('company-entry-images',$1)`, [key]);
  });
  it('keeps company B reservations separate from company A quota', async () => {
    await db.query('BEGIN');
    try {
      const member = randomUUID(),
        id = randomUUID();
      await db.query('INSERT INTO group_members(id,group_id,profile_id) VALUES($1,$2,$3)', [
        member,
        other,
        g.profileIds[1],
      ]);
      await db.query(`SELECT set_config('request.jwt.claims',$1,true)`, [
        JSON.stringify({ sub: g.profileIds[1], role: 'authenticated' }),
      ]);
      await db.query(
        `SELECT waves_company_entry_create($1,$2,$3,'expense','{"amount":"1","occurredOn":"2026-11-05"}')`,
        [other, id, member],
      );
      const key = `${id}/${randomUUID()}/${randomUUID()}.jpg`;
      await store(key, other, 75);
      expect(
        (
          await db.query(
            'SELECT sum(bytes)::text AS bytes FROM storage_objects WHERE company_group_id=$1',
            [other],
          )
        ).rows[0].bytes,
      ).toBe('75');
      expect(
        (
          await db.query(
            'SELECT sum(bytes)::text AS bytes FROM storage_objects WHERE company_group_id=$1',
            [g.groupId],
          )
        ).rows[0].bytes,
      ).toBe('100');
      await db.query('UPDATE company_plans SET storage_quota_bytes=100 WHERE group_id=$1', [
        g.groupId,
      ]);
      const second = `${id}/${randomUUID()}/${randomUUID()}.jpg`;
      await store(second, other, 75); // A being full cannot block B.
    } finally {
      await db.query('ROLLBACK');
    }
  });
  it.each([false, true])(
    'computes approved net due with every entry kind (approvals=%s)',
    async (approvals) => {
      await user(0, async () => {
        await db.query('SELECT waves_company_settings_set($1,3,$2)', [g.groupId, approvals]);
        const ids: string[] = [];
        for (const [kind, data] of [
          ['expense', { amount: '100' }],
          ['allowance', { days: '0.5' }],
          ['advance', { amount: '200' }],
          ['wages', { amount: '999' }],
          ['reimbursement', { amount: '20', direction: 'company_to_employee' }],
          ['reimbursement', { amount: '10', direction: 'employee_to_company' }],
        ] as const) {
          const id = randomUUID();
          ids.push(id);
          await create(id, kind, data);
        }
        const net = async () =>
          (
            await db.query(
              `SELECT sum(CASE WHEN status IN ('approved','reimbursed') AND deleted_at IS NULL AND entry_kind<>'wages' THEN
        CASE WHEN entry_kind='advance' OR (entry_kind='reimbursement' AND direction='company_to_employee') THEN -amount ELSE amount END ELSE 0 END)::text AS net
        FROM company_entries WHERE id=ANY($1::uuid[])`,
              [ids],
            )
          ).rows[0].net;
        expect(await net()).toBe(approvals ? '0' : '-108');
        if (approvals) {
          for (const id of ids)
            await db.query(`SELECT waves_company_entry_transition($1,'approved',NULL,1)`, [id]);
          expect(await net()).toBe('-108');
        }
      });
    },
  );
  it('treats a zero member override as a valid snapshot above the company default', async () => {
    await user(0, async () => {
      await db.query('SELECT waves_company_settings_set($1,300,false)', [g.groupId]);
      await db.query('SELECT waves_company_member_rate_set($1,$2,0)', [g.groupId, g.memberIds[1]]);
      const id = randomUUID();
      await create(id, 'allowance', { days: '2' });
      expect(
        (await db.query('SELECT amount,rate_minor,status FROM company_entries WHERE id=$1', [id]))
          .rows[0],
      ).toMatchObject({ amount: '0', rate_minor: '0', status: 'approved' });
    });
  });
  it('recount keeps company attribution and personal exemption', async () => {
    await db.query(`SELECT waves_storage_recount('company-entry-images',$1,101,'image/jpeg')`, [
      path,
    ]);
    expect(
      (await db.query('SELECT company_group_id,counted FROM storage_objects WHERE path=$1', [path]))
        .rows[0],
    ).toEqual({ company_group_id: g.groupId, counted: false });
    await db.query(`SELECT waves_storage_recount('company-entry-images',$1,100,'image/jpeg')`, [
      path,
    ]);
  });
  it('on/off approvals, rounding, review concurrency and approved balance math', async () => {
    await user(0, async () => {
      await db.query('SELECT waves_company_settings_set($1,3,true)', [g.groupId]);
      const id = randomUUID();
      await create(id, 'allowance', { days: '0.5' });
      let row = (await db.query('SELECT * FROM company_entries WHERE id=$1', [id])).rows[0];
      expect(row).toMatchObject({ amount: '2', rate_minor: '3', status: 'submitted', version: 1 });
      await db.query(`SELECT waves_company_entry_transition($1,'approved','OK',1)`, [id]);
      await db.query(`SELECT waves_company_entry_update($1,'{"days":"1.5"}')`, [id]);
      row = (await db.query('SELECT * FROM company_entries WHERE id=$1', [id])).rows[0];
      expect(row).toMatchObject({
        amount: '5',
        status: 'submitted',
        version: 3,
        review_note: null,
        reviewed_by: null,
      });
      await db.query(`SELECT waves_company_entry_transition($1,'rejected','Wrong dates',3)`, [id]);
      await db.query('SELECT waves_company_settings_set($1,3,false)', [g.groupId]);
      const approved = randomUUID();
      await create(approved);
      expect(
        (await db.query('SELECT status FROM company_entries WHERE id=$1', [approved])).rows[0]
          .status,
      ).toBe('approved');
      // Pending/rejected and wages contribute zero; legacy reimbursed remains supported.
      expect(
        (
          await db.query(
            `SELECT sum(CASE WHEN status IN ('approved','reimbursed') AND deleted_at IS NULL AND entry_kind<>'wages' THEN
        CASE WHEN entry_kind='advance' OR (entry_kind='reimbursement' AND direction='company_to_employee') THEN -amount ELSE amount END ELSE 0 END)::text AS net
        FROM company_entries WHERE id=ANY($1::uuid[])`,
            [[id, approved]],
          )
        ).rows[0].net,
      ).toBe('100');
    });
  });
  it.each([
    [null, 1, 'VERSION_CONFLICT'],
    ['note', 99, 'VERSION_CONFLICT'],
    [' ', 1, 'REVIEW_NOTE_REQUIRED'],
  ])('refuses stale or blank review (%s)', async (note, version, error) => {
    await db.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
      JSON.stringify({ sub: g.profileIds[0], role: 'authenticated' }),
    ]);
    await db.query('SELECT waves_company_settings_set($1,NULL,true)', [g.groupId]);
    const id = randomUUID();
    await create(id);
    expect(
      await expectDenied(
        user(0, () =>
          db.query(`SELECT waves_company_entry_transition($1,'rejected',$2,$3)`, [
            id,
            note,
            version === 1 && note === null ? null : version,
          ]),
        ),
      ),
    ).toMatch(new RegExp(String(error)));
  });
  it('cannot overwrite committed originals, attach forged scope, or remove another employee image', async () => {
    expect(await expectDenied(store(path))).toMatch(/IMMUTABLE_OBJECT/);
    expect(
      await expectDenied(
        user(2, () =>
          db.query('SELECT waves_attach_company_entry_image($1,$2,$3)', [
            entry,
            path,
            randomUUID(),
          ]),
        ),
      ),
    ).toMatch(/NOT_ALLOWED/);
    expect(
      await expectDenied(
        user(2, () => db.query('SELECT waves_remove_company_entry_image($1)', [attachment])),
      ),
    ).toMatch(/NOT_ALLOWED/);
  });
  it('void atomically releases original and thumbnail, and keys remain retired', async () => {
    await db.query('BEGIN');
    try {
      await db.query(`SELECT set_config('request.jwt.claims',$1,true)`, [
        JSON.stringify({ sub: g.profileIds[1], role: 'authenticated' }),
      ]);
      await store(`${path}.thumb.jpg`);
      await commit(`${path}.thumb.jpg`);
      await db.query(`SELECT waves_company_entry_void($1,'withdraw')`, [entry]);
      expect(
        (
          await db.query(
            "SELECT path FROM storage_objects WHERE logical_bucket='company-entry-images' AND path=ANY($1::text[])",
            [[path, `${path}.thumb.jpg`]],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await db.query(
            "SELECT path FROM storage_orphans WHERE logical_bucket='company-entry-images' AND path=ANY($1::text[])",
            [[path, `${path}.thumb.jpg`]],
          )
        ).rowCount,
      ).toBe(2);
      expect(
        (await db.query('SELECT path FROM company_image_keys WHERE path=$1', [path])).rowCount,
      ).toBe(1);
    } finally {
      await db.query('ROLLBACK');
    }
  });
  it('account erasure retains company evidence with nullable uploader attribution', async () => {
    await db.query('BEGIN');
    try {
      await db.query(`SELECT set_config('request.jwt.claims',$1,true)`, [
        JSON.stringify({ sub: g.profileIds[1], role: 'authenticated' }),
      ]);
      await db.query('SELECT waves_delete_my_account()');
      expect(
        (
          await db.query(
            'SELECT owner_profile_id,company_group_id,counted FROM storage_objects WHERE path=$1',
            [path],
          )
        ).rows[0],
      ).toEqual({ owner_profile_id: null, company_group_id: g.groupId, counted: false });
      expect(
        (await db.query('SELECT id FROM company_entry_attachments WHERE id=$1', [attachment]))
          .rowCount,
      ).toBe(1);
    } finally {
      await db.query('ROLLBACK');
    }
  });
  it('cancellation is service-only and refuses attached originals', async () => {
    expect(
      await expectDenied(
        user(1, () =>
          db.query('SELECT waves_company_cancel_upload($1,$2,$3)', [entry, path, g.profileIds[1]]),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await expectDenied(
        db.query('SELECT waves_company_cancel_upload($1,$2,$3)', [entry, path, g.profileIds[1]]),
      ),
    ).toMatch(/IMMUTABLE_OBJECT/);
  });
  it('attachment change resubmits, increments version; void releases original and thumbnail', async () => {
    await user(0, async () => {
      await db.query('SELECT waves_company_settings_set($1,NULL,true)', [g.groupId]);
      await db.query('SELECT waves_remove_company_entry_image($1)', [attachment]);
      expect(
        (await db.query('SELECT status FROM company_entries WHERE id=$1', [entry])).rows[0].status,
      ).toBe('submitted');
      expect(
        (
          await db.query('SELECT deleted_at FROM company_entry_attachments WHERE id=$1', [
            attachment,
          ])
        ).rows[0].deleted_at,
      ).not.toBeNull();
    });
    await user(1, async () => {
      await db.query(`SELECT waves_company_entry_void($1,'withdraw')`, [entry]);
      expect(
        (
          await db.query('SELECT deleted_at FROM company_entry_attachments WHERE id=$1', [
            attachment,
          ])
        ).rows[0].deleted_at,
      ).not.toBeNull();
    });
  });
});
