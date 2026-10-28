import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { asRole, connect, expectDenied, seedGroup, addEqualSplitExpense } from './helpers.js';

let client: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
let normal: Awaited<ReturnType<typeof seedGroup>>;
const ids = [randomUUID(), randomUUID()];
const user = <T>(index: number, run: () => Promise<T>) =>
  asRole(client, 'authenticated', { sub: g.profileIds[index], role: 'authenticated' }, run);
const create = (
  id: string,
  member: string,
  kind = 'expense',
  data: object = { amount: '100', occurredOn: '2026-11-04' },
) =>
  client.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5::jsonb) AS id', [
    g.groupId,
    id,
    member,
    kind,
    JSON.stringify(data),
  ]);
beforeAll(async () => {
  client = await connect();
  // Seed a company directly: type conversion is deliberately impossible.
  normal = await seedGroup(client, { memberCount: 4 });
  g = { ...normal, groupId: randomUUID(), memberIds: normal.memberIds.map(() => randomUUID()) };
  await client.query(
    `INSERT INTO groups(id,name,type,default_currency,created_by) VALUES($1,'Company','company','INR',$2)`,
    [g.groupId, g.profileIds[0]],
  );
  for (let i = 0; i < 3; i++) {
    await client.query(
      `INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,$4)`,
      [g.memberIds[i], g.groupId, g.profileIds[i], i === 0 ? 'admin' : 'member'],
    );
  }
  // Remove shared ordinary membership so profile privacy is tested in isolation.
  await client.query('DELETE FROM group_members WHERE group_id=$1', [normal.groupId]);
  await client.query('DELETE FROM groups WHERE id=$1', [normal.groupId]);
  normal = await seedGroup(client, { memberCount: 2 });
  // asRole rolls back writes; persist fixtures as owner with authenticated claims.
  await client.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: g.profileIds[0], role: 'authenticated' }),
  ]);
  await create(ids[0]!, g.memberIds[1]!);
  await create(ids[1]!, g.memberIds[2]!);
});
afterAll(async () => {
  if (!client) return;
  await client.end();
});

describe('company privacy and write boundaries', () => {
  it.each([0, 1, 2, 3])('filters entries, members and profiles for actor %i', async (actor) => {
    await user(actor, async () => {
      const entries = await client.query(
        'SELECT member_id FROM company_entries WHERE group_id=$1',
        [g.groupId],
      );
      expect(entries.rows.map((r) => r.member_id).sort()).toEqual(
        (actor === 0
          ? [g.memberIds[1], g.memberIds[2]]
          : actor === 3
            ? []
            : [g.memberIds[actor]]
        ).sort(),
      );
      const members = await client.query('SELECT id FROM group_members WHERE group_id=$1', [
        g.groupId,
      ]);
      expect(members.rows.map((r) => r.id).sort()).toEqual(
        (actor === 0 ? g.memberIds.slice(0, 3) : actor === 3 ? [] : [g.memberIds[actor]]).sort(),
      );
      const profiles = await client.query('SELECT id FROM profiles WHERE id=$1', [g.profileIds[2]]);
      expect(profiles.rowCount).toBe(actor === 0 || actor === 2 ? 1 : 0);
    });
  });
  it.each([
    'INSERT INTO company_entries(id) VALUES(gen_random_uuid())',
    "UPDATE company_entries SET note='x'",
    'DELETE FROM company_entries',
  ])('denies direct ledger writes: %s', async (sql) => {
    expect(await expectDenied(user(1, () => client.query(sql)))).toMatch(/permission denied/i);
  });
  it.each(['advance', 'wages', 'reimbursement'])('refuses employee %s creation', async (kind) => {
    expect(await expectDenied(user(1, () => create(randomUUID(), g.memberIds[1]!, kind)))).toMatch(
      /NOT_ALLOWED/,
    );
  });
  it('refuses merging members in a company group', async () => {
    expect(
      await expectDenied(
        client.query('UPDATE group_members SET merged_into_member_id=$1 WHERE id=$2', [
          g.memberIds[1],
          g.memberIds[2],
        ]),
      ),
    ).toMatch(/COMPANY_GROUP/);
  });
  it('refuses creating for another employee', async () => {
    expect(await expectDenied(user(1, () => create(randomUUID(), g.memberIds[2]!)))).toMatch(
      /NOT_ALLOWED/,
    );
  });
  it('allows own create/edit/void and replay without duplicate rows', async () => {
    await user(1, async () => {
      const id = randomUUID();
      await create(id, g.memberIds[1]!);
      expect((await create(id, g.memberIds[1]!)).rows[0].id).toBe(id);
      await client.query(`SELECT waves_company_entry_update($1,'{"note":"updated"}')`, [id]);
      await client.query(`SELECT waves_company_entry_void($1,'correction')`, [id]);
      const r = (
        await client.query('SELECT deleted_at,version FROM company_entries WHERE id=$1', [id])
      ).rows[0];
      expect(r.deleted_at).not.toBeNull();
      expect(r.version).toBe(3);
    });
  });
  it.each(['update', 'void'])('refuses another employee entry %s', async (action) => {
    const sql =
      action === 'update'
        ? `SELECT waves_company_entry_update($1,'{}')`
        : `SELECT waves_company_entry_void($1,'x')`;
    expect(await expectDenied(user(1, () => client.query(sql, [ids[1]])))).toMatch(/NOT_ALLOWED/);
  });
  it.each([
    ['2.5', '40000', '100000'],
    ['0.5', '1', '1'],
  ])('calculates allowance %s × %s = %s', async (days, rate, amount) => {
    await user(1, async () => {
      const id = randomUUID();
      await create(id, g.memberIds[1]!, 'allowance', {
        days,
        rateMinor: rate,
        occurredOn: '2026-11-04',
      });
      expect(
        (await client.query('SELECT amount FROM company_entries WHERE id=$1', [id])).rows[0].amount,
      ).toBe(amount);
    });
  });
  it('denies anon execution and requires live company membership', async () => {
    expect(
      await expectDenied(
        asRole(client, 'anon', { role: 'anon' }, () => create(randomUUID(), g.memberIds[1]!)),
      ),
    ).toMatch(/permission denied/i);
    await client.query('UPDATE group_members SET left_at=now() WHERE id=$1', [g.memberIds[1]]);
    try {
      expect(await expectDenied(user(1, () => create(randomUUID(), g.memberIds[1]!)))).toMatch(
        /NOT_A_MEMBER/,
      );
    } finally {
      await client.query('UPDATE group_members SET left_at=NULL WHERE id=$1', [g.memberIds[1]]);
    }
  });
  it('reserves member rates to admins and uses the snapshot default', async () => {
    expect(
      await expectDenied(
        user(1, () =>
          client.query('SELECT waves_company_member_rate_set($1,$2,40000)', [
            g.groupId,
            g.memberIds[1],
          ]),
        ),
      ),
    ).toMatch(/ADMIN_ONLY/);
    expect(
      await expectDenied(
        user(1, () =>
          client.query('UPDATE group_members SET daily_rate_minor=1 WHERE id=$1', [g.memberIds[1]]),
        ),
      ),
    ).toMatch(/FORBIDDEN_COLUMN/);
    await user(0, async () => {
      await client.query('SELECT waves_company_member_rate_set($1,$2,40000)', [
        g.groupId,
        g.memberIds[1],
      ]);
      const id = randomUUID();
      await create(id, g.memberIds[1]!, 'allowance', { days: '2.5', occurredOn: '2026-11-04' });
      expect(
        (await client.query('SELECT amount FROM company_entries WHERE id=$1', [id])).rows[0].amount,
      ).toBe('100000');
    });
  });
  it.each(['advance', 'wages', 'reimbursement', 'expense', 'allowance'])(
    'allows admin %s for another member',
    async (kind) => {
      await user(0, () =>
        create(randomUUID(), g.memberIds[2]!, kind, {
          amount: '100',
          days: '1',
          rateMinor: '100',
          occurredOn: '2026-11-04',
        }),
      );
    },
  );
  it('admin edits/voids and transitions submitted entries; reimbursed is reserved', async () => {
    await user(0, async () => {
      await client.query(`SELECT waves_company_entry_update($1,'{"amount":"200"}')`, [ids[1]]);
      await client.query(`SELECT waves_company_entry_void($1,'x')`, [ids[1]]);
    });
    await client.query(`UPDATE company_entries SET status='submitted' WHERE id=$1`, [ids[0]]);
    await user(0, () =>
      client.query(
        `SELECT waves_company_entry_transition($1,'approved',NULL,(SELECT version FROM company_entries WHERE id=$1))`,
        [ids[0]],
      ),
    );
    expect(
      await expectDenied(
        user(0, () =>
          client.query(`SELECT waves_company_entry_transition($1,'reimbursed')`, [ids[0]]),
        ),
      ),
    ).toMatch(/INVALID_TRANSITION/);
    expect(
      await expectDenied(
        user(1, () =>
          client.query(
            `SELECT waves_company_entry_transition($1,'approved',NULL,(SELECT version FROM company_entries WHERE id=$1))`,
            [ids[0]],
          ),
        ),
      ),
    ).toMatch(/ADMIN_ONLY/);
  });
  it('rejects cross-group replay and outsiders', async () => {
    expect(await expectDenied(user(3, () => create(ids[0]!, g.memberIds[3]!)))).toMatch(
      /NOT_A_MEMBER/,
    );
    await user(0, async () => {
      expect((await create(ids[0]!, g.memberIds[1]!)).rows[0].id).toBe(ids[0]);
    });
    expect(await expectDenied(user(1, () => create(ids[1]!, g.memberIds[1]!)))).toMatch(
      /NOT_ALLOWED/,
    );
  });
  it('refuses replay of an id owned by a different company', async () => {
    const otherGroup = randomUUID();
    const otherMember = randomUUID();
    await client.query(
      `INSERT INTO groups(id,type,default_currency,created_by) VALUES($1,'company','INR',$2)`,
      [otherGroup, g.profileIds[0]],
    );
    await client.query(
      `INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,'admin')`,
      [otherMember, otherGroup, g.profileIds[0]],
    );
    expect(
      await expectDenied(
        user(0, () =>
          client.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5::jsonb)', [
            otherGroup,
            ids[0],
            otherMember,
            'expense',
            JSON.stringify({ amount: '100', occurredOn: '2026-11-04' }),
          ]),
        ),
      ),
    ).toMatch(/NOT_ALLOWED/);
  });
  it('pins function and table grants for the company surface', async () => {
    const functions = [
      'waves_is_company',
      'waves_company_actor',
      'waves_company_entry_values',
      'waves_company_entry_create',
      'waves_company_entry_update',
      'waves_company_entry_void',
      'waves_company_entry_transition',
      'waves_company_member_rate_set',
    ];
    const { rows } = await client.query(
      `SELECT proname, prosecdef,
      has_function_privilege('anon', oid, 'EXECUTE') AS anon,
      has_function_privilege('authenticated', oid, 'EXECUTE') AS authenticated
      FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY($1::text[])`,
      [functions],
    );
    expect(rows).toHaveLength(functions.length);
    for (const row of rows)
      expect(row).toMatchObject({ prosecdef: true, anon: false, authenticated: true });
    const grants =
      await client.query(`SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_schema='public' AND table_name='company_entries' AND grantee='authenticated'`);
    expect(grants.rows.map((row) => row.privilege_type)).toEqual(['SELECT']);
  });
  it('blocks recurring rule insertion for company groups', async () => {
    expect(
      await expectDenied(
        user(0, () =>
          client.query(
            `SELECT waves_create_group_recurring_expense($1,$2,'Rent',NULL,'INR',100,'equal','{}'::jsonb,
       $3::jsonb,$3::jsonb,NULL,'monthly',1,NULL,'2026-11-04',NULL,false)`,
            [
              g.groupId,
              randomUUID(),
              JSON.stringify([{ memberId: g.memberIds[0], amount: '100' }]),
            ],
          ),
        ),
      ),
    ).toMatch(/COMPANY_GROUP/);
  });
  it('keeps rate snapshots private even through the calculation helper', async () => {
    expect(
      await expectDenied(
        user(1, () =>
          client.query(
            `SELECT waves_company_entry_values('allowance',$1,'{"days":"1","occurredOn":"2026-11-04"}')`,
            [g.memberIds[2]],
          ),
        ),
      ),
    ).toMatch(/NOT_ALLOWED/);
  });

  it('keeps company activity admin-only, including member-trigger activity', async () => {
    await client.query("UPDATE groups SET name=name || ' updated' WHERE id=$1", [g.groupId]);
    await user(0, async () => {
      expect(
        (await client.query('SELECT id FROM activity_log WHERE group_id=$1', [g.groupId])).rowCount,
      ).toBeGreaterThan(0);
    });
    for (const actor of [1, 2, 3])
      await user(actor, async () => {
        expect(
          (await client.query('SELECT id FROM activity_log WHERE group_id=$1', [g.groupId]))
            .rowCount,
        ).toBe(0);
      });
  });
  it('allows only admins to mint company invites', async () => {
    const mint = () =>
      client.query(
        "INSERT INTO invites(group_id,token_hash,created_by,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
        [g.groupId, randomUUID(), g.profileIds[1]],
      );
    expect(await expectDenied(user(1, mint))).toMatch(/row-level security/);
    await user(0, mint);
  });
  it('protects profile and ghost RPCs and avatar sharing while preserving self access', async () => {
    const ghost = randomUUID();
    await client.query(
      "INSERT INTO group_members(id,group_id,ghost_name) VALUES($1,$2,'Private ghost')",
      [ghost, g.groupId],
    );
    for (const actor of [0, 1, 3])
      await user(actor, async () => {
        for (const key of [g.profileIds[2], ghost]) {
          expect(
            (await client.query('SELECT * FROM waves_person_profile($1)', [key])).rowCount,
          ).toBe(actor === 0 ? 1 : 0);
        }
        expect(
          (await client.query('SELECT waves_shares_a_group_with($1) AS shared', [g.profileIds[2]]))
            .rows[0].shared,
        ).toBe(actor === 0);
        expect(
          (await client.query('SELECT * FROM waves_person_profile($1)', [g.profileIds[actor]]))
            .rowCount,
        ).toBe(1);
      });
  });
  it('excludes company source memberships from link candidates unless admin', async () => {
    for (const actor of [0, 1])
      await client.query('INSERT INTO group_members(group_id,profile_id) VALUES($1,$2)', [
        normal.groupId,
        g.profileIds[actor],
      ]);
    try {
      await user(1, async () => {
        const rows = (
          await client.query('SELECT * FROM waves_member_link_candidates($1)', [normal.groupId])
        ).rows;
        expect(rows.map((r) => r.profile_id)).not.toContain(g.profileIds[2]);
      });
      await user(0, async () => {
        const rows = (
          await client.query('SELECT * FROM waves_member_link_candidates($1)', [normal.groupId])
        ).rows;
        expect(rows.map((r) => r.profile_id)).toContain(g.profileIds[2]);
      });
    } finally {
      await client.query(
        'DELETE FROM group_members WHERE group_id=$1 AND profile_id=ANY($2::uuid[])',
        [normal.groupId, g.profileIds.slice(0, 2)],
      );
    }
  });
  it('locks currency when company ledger rows exist', async () => {
    expect(
      await expectDenied(
        client.query("UPDATE groups SET default_currency='USD' WHERE id=$1", [g.groupId]),
      ),
    ).toMatch(/CURRENCY_LOCKED/);
    // This employee has no entries of their own, so invoker RLS sees no ledger.
    await client.query('INSERT INTO group_members(group_id,profile_id) VALUES($1,$2)', [
      g.groupId,
      g.profileIds[3],
    ]);
    try {
      expect(
        await expectDenied(
          user(3, () =>
            client.query("UPDATE groups SET default_currency='USD' WHERE id=$1", [g.groupId]),
          ),
        ),
      ).toMatch(/CURRENCY_LOCKED/);
    } finally {
      await client.query('DELETE FROM group_members WHERE group_id=$1 AND profile_id=$2', [
        g.groupId,
        g.profileIds[3],
      ]);
    }
  });
  it.each([false, true])(
    'allows only admins to add members through RPC (profile=%s)',
    async (byProfile) => {
      const add = () =>
        client.query('SELECT waves_add_ghost_member($1,$2,NULL,NULL,NULL,$3)', [
          g.groupId,
          'New colleague',
          byProfile ? normal.profileIds[1] : null,
        ]);
      expect(await expectDenied(user(1, add))).toMatch(/ADMIN_ONLY/);
      await user(0, add);
    },
  );
  it('allows only admins to insert company ghosts directly', async () => {
    const add = () =>
      client.query("INSERT INTO group_members(group_id,ghost_name) VALUES($1,'Ghost')", [
        g.groupId,
      ]);
    expect(await expectDenied(user(1, add))).toMatch(/row-level security/);
    await user(0, add);
  });
  it.each(['member_id', 'created_by', 'updated_by'])(
    'counts company ledger history via %s, including voided entries',
    async (column) => {
      await client.query('BEGIN');
      try {
        const member = randomUUID();
        await client.query(
          "INSERT INTO group_members(id,group_id,ghost_name) VALUES($1,$2,'History')",
          [member, g.groupId],
        );
        await client.query(
          'UPDATE company_entries SET ' + column + '=$1,deleted_at=now() WHERE id=$2',
          [member, ids[0]],
        );
        expect(
          (await client.query('SELECT waves_member_has_history($1) AS history', [member])).rows[0]
            .history,
        ).toBe(true);
      } finally {
        await client.query('ROLLBACK');
      }
    },
  );
  it.each([0, 1])('repeat void by authorised actor %i changes no columns', async (actor) => {
    await user(actor, async () => {
      const id = randomUUID();
      await create(id, g.memberIds[1]!);
      await client.query("SELECT waves_company_entry_void($1,'first')", [id]);
      const before = (await client.query('SELECT * FROM company_entries WHERE id=$1', [id]))
        .rows[0];
      await client.query("SELECT waves_company_entry_void($1,'second')", [id]);
      expect(
        (await client.query('SELECT * FROM company_entries WHERE id=$1', [id])).rows[0],
      ).toEqual(before);
    });
  });
  it('blocks conversions both ways', async () => {
    expect(
      await expectDenied(client.query(`UPDATE groups SET type='trip' WHERE id=$1`, [g.groupId])),
    ).toMatch(/COMPANY_TYPE_IMMUTABLE/);
    expect(
      await expectDenied(
        client.query(`UPDATE groups SET type='company' WHERE id=$1`, [normal.groupId]),
      ),
    ).toMatch(/COMPANY_TYPE_IMMUTABLE/);
  });
  it('normal groups still share member rows', async () => {
    await asRole(
      client,
      'authenticated',
      { sub: normal.profileIds[1], role: 'authenticated' },
      async () => {
        expect(
          (await client.query('SELECT id FROM group_members WHERE group_id=$1', [normal.groupId]))
            .rowCount,
        ).toBe(2);
      },
    );
  });
  it('blocks legacy expense writes but normal expenses work', async () => {
    const write = (group: typeof g) =>
      addEqualSplitExpense(client, {
        groupId: group.groupId,
        payers: { [group.memberIds[0]!]: 100n },
        participants: group.memberIds.slice(0, 2),
        amount: 100n,
      });
    try {
      expect(await expectDenied(write(g))).toMatch(/COMPANY_GROUP/);
    } finally {
      // addEqualSplitExpense opens a transaction before the rejected INSERT.
      await client.query('ROLLBACK');
    }
    await client.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
      JSON.stringify({ sub: normal.profileIds[0], role: 'authenticated' }),
    ]);
    await write(normal);
  });
  it('blocks company settlements; permits ordinary settlements', async () => {
    const write = (group: typeof g) =>
      client.query(
        `SELECT waves_record_settlement($1,$2,$3,100,'cash','INR',NULL,'[]'::jsonb,$4)`,
        [group.groupId, group.memberIds[0], group.memberIds[1], randomUUID()],
      );
    expect(await expectDenied(user(0, () => write(g)))).toMatch(/COMPANY_GROUP/);
    await asRole(
      client,
      'authenticated',
      { sub: normal.profileIds[0], role: 'authenticated' },
      () => write(normal),
    );
  });
});
