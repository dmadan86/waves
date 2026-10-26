import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect, seedGroup, type SeededGroup } from './helpers';

let client: Client;
let group: SeededGroup;
let outsider: SeededGroup;
let potId: string;
let code: string;

beforeAll(async () => {
  client = await connect();
});
afterAll(async () => {
  await client?.end();
});
beforeEach(async () => {
  await client.query('BEGIN');
  group = await seedGroup(client, { memberCount: 3, name: 'Kitty group' });
  outsider = await seedGroup(client, { memberCount: 1 });
  await client.query(`UPDATE group_members SET vpa = 'tara@bank' WHERE id = $1`, [
    group.memberIds[0],
  ]);
  const result = await client.query(
    `INSERT INTO pots(group_id, name, currency, per_head_minor, treasurer_member_id, created_by)
    VALUES ($1, 'Lunch kitty', 'INR', 100, $2, $2) RETURNING id, pay_code`,
    [group.groupId, group.memberIds[0]],
  );
  potId = result.rows[0].id;
  code = result.rows[0].pay_code;
  await claims(group.profileIds[0]!);
});
afterEach(async () => {
  await client.query('ROLLBACK');
});

async function claims(profile: string) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: profile, role: 'authenticated' }),
  ]);
}
async function as<T>(
  role: 'anon' | 'authenticated' | 'service_role',
  profile: string | null,
  run: () => Promise<T>,
): Promise<T> {
  await client.query('SAVEPOINT pot_role');
  try {
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: profile, role }),
    ]);
    await client.query(`SET LOCAL ROLE ${role}`);
    const result = await run();
    await client.query('RESET ROLE');
    await client.query('RELEASE SAVEPOINT pot_role');
    return result;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT pot_role');
    await client.query('RELEASE SAVEPOINT pot_role');
    throw error;
  }
}
async function denied(run: () => Promise<unknown>, pattern: RegExp) {
  await client.query('SAVEPOINT pot_denied');
  try {
    await expect(run()).rejects.toThrow(pattern);
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT pot_denied');
    await client.query('RELEASE SAVEPOINT pot_denied');
  }
}
async function expense(payer = group.memberIds[0]!, expenseId: string | null = null) {
  const { rows } = await client.query(
    `SELECT waves_apply_expense(
    p_group_id := $1, p_expense_id := $2, p_author_member_id := $3,
    p_description := 'Pot lunch', p_category := NULL, p_expense_date := '2026-11-02',
    p_currency := 'INR', p_amount := 180, p_split_type := 'exact', p_split_params := '{"kind":"exact"}',
    p_payers := $4::jsonb, p_shares := $5::jsonb, p_client_mutation_id := $6, p_pot_id := $7) AS result`,
    [
      group.groupId,
      expenseId,
      group.memberIds[0],
      JSON.stringify([{ memberId: payer, amount: '180' }]),
      JSON.stringify([
        { memberId: group.memberIds[1], amount: '60' },
        { memberId: group.memberIds[2], amount: '120' },
      ]),
      randomUUID(),
      potId,
    ],
  );
  return rows[0].result;
}
async function fund(status = 'confirmed') {
  for (const member of group.memberIds.slice(1))
    await client.query(
      `INSERT INTO settlements
    (group_id, pot_id, from_member_id, to_member_id, currency, amount, method, status)
    VALUES ($1, $2, $3, $4, 'INR', 100, 'upi', $5::"SettlementStatus")`,
      [group.groupId, potId, member, group.memberIds[0], status],
    );
}
const close = (mutation = randomUUID()) =>
  as('authenticated', group.profileIds[0]!, () =>
    client.query('SELECT waves_close_pot($1, $2) AS id', [potId, mutation]),
  );
const carry = (target = group.groupId, mutation = randomUUID()) =>
  as('authenticated', group.profileIds[0]!, () =>
    client.query(`SELECT waves_carry_pot($1, $2, 'Next kitty', $3) AS id`, [
      potId,
      target,
      mutation,
    ]),
  );
const state = async () =>
  (await client.query('SELECT status FROM pots WHERE id = $1', [potId])).rows[0].status;

describe('pots (every test rolls back)', () => {
  it('creates through an authorized idempotent RPC', async () => {
    const mutation = randomUUID();
    const create = (profile: string) =>
      as('authenticated', profile, () =>
        client.query(`SELECT waves_create_pot($1, 'New kitty', 'INR', 100, $2, $3) AS id`, [
          group.groupId,
          group.memberIds[0],
          mutation,
        ]),
      );
    await expect(create(group.profileIds[1]!)).rejects.toThrow(/FORBIDDEN/);
    const first = await create(group.profileIds[0]!);
    expect((await create(group.profileIds[0]!)).rows[0].id).toBe(first.rows[0].id);
  });
  it('records pot contributions through normal authorization and replays safely', async () => {
    const mutation = randomUUID();
    const record = (to = group.memberIds[0]!, key = mutation) =>
      as('authenticated', group.profileIds[1]!, () =>
        client.query(
          `SELECT waves_record_pot_settlement($1, $2, $3, 100, $4, '123456789012', 'intent') AS id`,
          [potId, group.memberIds[1], to, key],
        ),
      );
    const first = await record();
    expect((await record()).rows[0].id).toBe(first.rows[0].id);
    await expect(record(group.memberIds[2], randomUUID())).rejects.toThrow(
      /POT_INVALID_SETTLEMENT/,
    );
    const row = (
      await client.query('SELECT pot_id, status, reference_source FROM settlements WHERE id = $1', [
        first.rows[0].id,
      ])
    ).rows[0];
    expect(row).toEqual({ pot_id: potId, status: 'initiated', reference_source: 'intent' });
    await expect(
      as('authenticated', outsider.profileIds[0]!, () =>
        client.query(`SELECT waves_record_pot_settlement($1, $2, $3, 100, $4)`, [
          potId,
          group.memberIds[1],
          group.memberIds[0],
          randomUUID(),
        ]),
      ),
    ).rejects.toThrow(/FORBIDDEN/);
  });
  it('rejects outsiders before looking up or locking a settlement pot', async () => {
    for (const id of [potId, randomUUID()]) {
      await expect(
        as('authenticated', outsider.profileIds[0]!, () =>
          client.query('SELECT waves_record_pot_settlement($1, $2, $3, 100, $4)', [
            id,
            group.memberIds[1],
            group.memberIds[0],
            randomUUID(),
          ]),
        ),
      ).rejects.toThrow(/FORBIDDEN/);
    }
  });
  it('checks pot guards when attaching an existing settlement on UPDATE', async () => {
    const { rows } = await client.query(
      `INSERT INTO settlements(group_id, from_member_id, to_member_id, currency, amount, method)
       VALUES ($1, $2, $3, 'USD', 100, 'upi') RETURNING id`,
      [group.groupId, group.memberIds[1], group.memberIds[0]],
    );
    await denied(
      () => client.query('UPDATE settlements SET pot_id = $1 WHERE id = $2', [potId, rows[0].id]),
      /POT_INVALID_SETTLEMENT/,
    );
    await client.query("UPDATE settlements SET currency = 'INR' WHERE id = $1", [rows[0].id]);
    await close();
    await denied(
      () => client.query('UPDATE settlements SET pot_id = $1 WHERE id = $2', [potId, rows[0].id]),
      /POT_NOT_OPEN/,
    );
  });
  it('requires a live creator on insert, while preserving pots after the creator leaves', async () => {
    await client.query('UPDATE group_members SET left_at = now() WHERE id = $1', [
      group.memberIds[2],
    ]);
    await denied(
      () =>
        client.query(
          `INSERT INTO pots(group_id, name, currency, per_head_minor, treasurer_member_id, created_by)
         VALUES ($1, 'Departed creator', 'INR', 100, $2, $3)`,
          [group.groupId, group.memberIds[0], group.memberIds[2]],
        ),
      /POT_WRONG_GROUP/,
    );
    await client.query('UPDATE group_members SET left_at = NULL WHERE id = $1', [
      group.memberIds[2],
    ]);
    const { rows } = await client.query(
      `INSERT INTO pots(group_id, name, currency, per_head_minor, treasurer_member_id, created_by)
       VALUES ($1, 'Former creator', 'INR', 100, $2, $3) RETURNING id`,
      [group.groupId, group.memberIds[0], group.memberIds[2]],
    );
    await client.query('UPDATE group_members SET left_at = now() WHERE id = $1', [
      group.memberIds[2],
    ]);
    await as('authenticated', group.profileIds[0]!, () =>
      client.query('SELECT waves_close_pot($1, $2)', [rows[0].id, randomUUID()]),
    );
  });
  it('preserves expense history through normal edits and soft deletion', async () => {
    const first = await expense();
    const edited = await expense(group.memberIds[0], first.expenseId);
    expect(edited.versionNo).toBe(2);
    expect(
      (
        await client.query(
          `SELECT ep.member_id FROM expense_payers ep JOIN expense_versions ev ON ev.id = ep.expense_version_id
       WHERE ev.expense_id = $1`,
          [first.expenseId],
        )
      ).rows,
    ).toEqual([{ member_id: group.memberIds[0] }, { member_id: group.memberIds[0] }]);
    await as('authenticated', group.profileIds[0]!, () =>
      client.query('SELECT waves_delete_expense($1)', [first.expenseId]),
    );
    expect(
      (await client.query('SELECT deleted_at FROM expenses WHERE id = $1', [first.expenseId]))
        .rows[0].deleted_at,
    ).not.toBeNull();
  });
  it('prevents changing or clearing an expense version pot on UPDATE', async () => {
    const exp = await expense();
    await denied(
      () =>
        client.query('UPDATE expense_versions SET pot_id = NULL WHERE id = $1', [exp.versionId]),
      /APPEND_ONLY/,
    );
    await denied(
      () =>
        client.query('UPDATE expense_versions SET pot_id = $1 WHERE id = $2', [
          randomUUID(),
          exp.versionId,
        ]),
      /APPEND_ONLY/,
    );
    await close();
    await denied(
      () =>
        client.query('UPDATE expense_versions SET pot_id = pot_id WHERE id = $1', [exp.versionId]),
      /APPEND_ONLY/,
    );
  });
  it('lets group members read, hides rows from outsiders, and denies anon table access', async () => {
    expect(
      (
        await as('authenticated', group.profileIds[1]!, () =>
          client.query('SELECT id FROM pots WHERE id = $1', [potId]),
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await as('authenticated', outsider.profileIds[0]!, () =>
          client.query('SELECT id FROM pots WHERE id = $1', [potId]),
        )
      ).rowCount,
    ).toBe(0);
    await expect(as('anon', null, () => client.query('SELECT * FROM pots'))).rejects.toThrow(
      /permission denied/i,
    );
    expect(code).toMatch(/^[a-f0-9]{32}$/);
  });
  it('only permits admins or the treasurer to manage, and lifecycle changes require RPCs', async () => {
    expect(
      (
        await as('authenticated', group.profileIds[1]!, () =>
          client.query(`UPDATE pots SET name = 'Stolen' WHERE id = $1`, [potId]),
        )
      ).rowCount,
    ).toBe(0);
    await as('authenticated', group.profileIds[0]!, () =>
      client.query(`UPDATE pots SET name = 'Renamed' WHERE id = $1`, [potId]),
    );
    await expect(
      as('authenticated', group.profileIds[1]!, () =>
        client.query('SELECT waves_close_pot($1, $2)', [potId, randomUUID()]),
      ),
    ).rejects.toThrow(/FORBIDDEN/);
    await expect(
      as('authenticated', group.profileIds[0]!, () =>
        client.query(`UPDATE pots SET status = 'closed', closed_at = now() WHERE id = $1`, [potId]),
      ),
    ).rejects.toThrow(/POT_USE_RPC/);
    // A non-admin treasurer has the same management rights.
    const other = await client.query(
      `INSERT INTO pots(group_id, name, currency, per_head_minor, treasurer_member_id, created_by)
      VALUES ($1, 'Member kitty', 'INR', 100, $2, $2) RETURNING id`,
      [group.groupId, group.memberIds[1]],
    );
    expect(
      (
        await as('authenticated', group.profileIds[1]!, () =>
          client.query(`UPDATE pots SET name = 'Treasurer edit' WHERE id = $1`, [other.rows[0].id]),
        )
      ).rowCount,
    ).toBe(1);
  });
  it('refuses another group treasurer and cross-group settlements', async () => {
    await denied(
      () =>
        client.query(
          `INSERT INTO pots(group_id, name, currency, per_head_minor, treasurer_member_id, created_by)
      VALUES ($1, 'Bad', 'INR', 100, $2, $3)`,
          [group.groupId, outsider.memberIds[0], group.memberIds[0]],
        ),
      /POT_WRONG_GROUP/,
    );
    await denied(
      () =>
        client.query(
          `INSERT INTO settlements(group_id, pot_id, from_member_id, to_member_id, currency, amount, method)
      VALUES ($1, $2, $3, $4, 'INR', 100, 'upi')`,
          [group.groupId, potId, outsider.memberIds[0], group.memberIds[0]],
        ),
      /POT_INVALID_SETTLEMENT/,
    );
  });
  it('refuses a pot expense whose payer is not the treasurer, without writing an expense', async () => {
    await denied(() => expense(group.memberIds[1]), /POT_PAYER_MUST_BE_TREASURER/);
    expect(
      (await client.query('SELECT id FROM expenses WHERE group_id = $1', [group.groupId])).rowCount,
    ).toBe(0);
    const result = await expense();
    expect(
      (await client.query('SELECT pot_id FROM expense_versions WHERE id = $1', [result.versionId]))
        .rows[0].pot_id,
    ).toBe(potId);
  });
  it('closes through the treasurer in initiated status, atomically and idempotently', async () => {
    await fund();
    await expense();
    const mutation = randomUUID();
    await close(mutation);
    await close(mutation);
    await close();
    const rows = (
      await client.query(
        `SELECT from_member_id, to_member_id, amount::text, status FROM settlements WHERE pot_id = $1 AND note = 'Pot close' ORDER BY amount DESC`,
        [potId],
      )
    ).rows;
    expect(rows).toEqual([
      {
        from_member_id: group.memberIds[0],
        to_member_id: group.memberIds[1],
        amount: '40',
        status: 'initiated',
      },
      {
        from_member_id: group.memberIds[2],
        to_member_id: group.memberIds[0],
        amount: '20',
        status: 'initiated',
      },
    ]);
    expect(await state()).toBe('closed');
    await denied(() => expense(), /POT_INVALID_EXPENSE/);
    await denied(
      () =>
        client.query('UPDATE expenses SET deleted_at = now() WHERE group_id = $1', [group.groupId]),
      /POT_NOT_OPEN/,
    );
  });
  it('rolls back every close row and the status if any insertion fails', async () => {
    await fund();
    await expense();
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query(
      `ALTER TABLE settlements ADD CONSTRAINT pot_test_fail CHECK (note IS DISTINCT FROM 'Pot close' OR amount <> 20)`,
    );
    await expect(close()).rejects.toThrow(/pot_test_fail/);
    expect(await state()).toBe('open');
    expect(
      (
        await client.query(`SELECT id FROM settlements WHERE pot_id = $1 AND note = 'Pot close'`, [
          potId,
        ])
      ).rowCount,
    ).toBe(0);
    await client.query('ALTER TABLE settlements DROP CONSTRAINT pot_test_fail');
    await close();
    expect(await state()).toBe('closed');
  });
  it('requires pending contributions to finish before closing', async () => {
    await fund('initiated');
    await expect(close()).rejects.toThrow(/POT_PENDING_PAYMENTS/);
    expect(await state()).toBe('open');
  });
  it('carries only to the same group, is idempotent, and never moves ledger rows', async () => {
    await fund();
    const exp = await expense();
    await expect(carry(outsider.groupId)).rejects.toThrow(/POT_WRONG_GROUP/);
    const mutation = randomUUID();
    const first = await carry(group.groupId, mutation);
    const replay = await carry(group.groupId, mutation);
    expect(replay.rows[0].id).toBe(first.rows[0].id);
    expect(await state()).toBe('carried');
    const next = (await client.query('SELECT * FROM pots WHERE id = $1', [first.rows[0].id]))
      .rows[0];
    expect(next).toMatchObject({
      group_id: group.groupId,
      carried_from_pot_id: potId,
      status: 'open',
    });
    expect(next.pay_code).not.toBe(code);
    expect(
      (await client.query('SELECT id FROM settlements WHERE pot_id = $1', [potId])).rowCount,
    ).toBe(2);
    expect(
      (await client.query('SELECT pot_id FROM expense_versions WHERE id = $1', [exp.versionId]))
        .rows[0].pot_id,
    ).toBe(potId);
    expect(
      (await client.query('SELECT id FROM settlements WHERE pot_id = $1', [next.id])).rowCount,
    ).toBe(0);
  });
  it('keeps pay RPCs executable only by the service role', async () => {
    for (const signature of ['pot_pay_lookup(text)', 'pot_pay_self_report(text,text,text)']) {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const result = await client.query('SELECT has_function_privilege($1, $2, $3) AS allowed', [
          role,
          signature,
          'EXECUTE',
        ]);
        expect(result.rows[0].allowed).toBe(role === 'service_role');
      }
    }
  });
  it('public lookup exposes exactly the minimum, and nothing for unknown or closed codes', async () => {
    const lookup = (value: string) =>
      as('service_role', null, () => client.query('SELECT pot_pay_lookup($1) AS result', [value]));
    const result = (await lookup(code)).rows[0].result;
    expect(result).toEqual({
      potName: 'Lunch kitty',
      groupName: 'Kitty group',
      perHeadMinor: '100',
      payeeName: 'Member 1',
      payeeVpa: 'tara@bank',
      currency: 'INR',
    });
    expect((await lookup('unknown')).rows[0].result).toBeNull();
    await close();
    expect((await lookup(code)).rows[0].result).toBeNull();
  });
  it('rejects ambiguous public payer names without exposing a roster', async () => {
    await client.query(
      `UPDATE profiles SET display_name = 'Same name' WHERE id = ANY($1::uuid[])`,
      [group.profileIds.slice(1)],
    );
    const result = await as('service_role', null, () =>
      client.query('SELECT pot_pay_self_report($1, $2, $3) AS ok', [
        code,
        'Same name',
        '123456789012',
      ]),
    );
    expect(result.rows[0].ok).toBe(false);
    expect(
      (await client.query('SELECT id FROM settlements WHERE pot_id = $1', [potId])).rowCount,
    ).toBe(0);
  });
  it.each(['', '   ', null])(
    'accepts an optional public UTR (%j) and keeps self attribution',
    async (ref) => {
      const result = await as('service_role', null, () =>
        client.query('SELECT pot_pay_self_report($1, $2, $3) AS ok', [code, 'Member 2', ref]),
      );
      expect(result.rows[0].ok).toBe(true);
      for (const blank of ['', '   ', null]) {
        expect(
          (
            await as('service_role', null, () =>
              client.query('SELECT pot_pay_self_report($1, $2, $3) AS ok', [
                code,
                ' member 2 ',
                blank,
              ]),
            )
          ).rows[0].ok,
        ).toBe(true);
      }
      const { rows } = await client.query(
        'SELECT status, reference, reference_source FROM settlements WHERE pot_id = $1',
        [potId],
      );
      expect(rows).toEqual([{ status: 'initiated', reference: null, reference_source: 'self' }]);
    },
  );
  it('dedupes blank references per payer only while their self-report is initiated', async () => {
    const report = (name: string) =>
      as('service_role', null, () =>
        client.query('SELECT pot_pay_self_report($1, $2, NULL) AS ok', [code, name]),
      );
    await report('Member 2');
    await report('Member 3');
    expect(
      (await client.query('SELECT id FROM settlements WHERE pot_id = $1', [potId])).rowCount,
    ).toBe(2);
    await client.query("UPDATE settlements SET status = 'confirmed' WHERE pot_id = $1", [potId]);
    await report('Member 2');
    await report('Member 2');
    expect(
      (await client.query('SELECT id FROM settlements WHERE pot_id = $1', [potId])).rowCount,
    ).toBe(3);
  });
  it('public self-report is pending, keeps the UTR, and retries do not duplicate', async () => {
    const report = (name = 'Member 2', ref = '123456789012') =>
      as('service_role', null, () =>
        client.query('SELECT pot_pay_self_report($1, $2, $3) AS ok', [code, name, ref]),
      );
    expect((await report()).rows[0].ok).toBe(true);
    expect((await report()).rows[0].ok).toBe(true);
    expect((await report('Unknown')).rows[0].ok).toBe(false);
    for (const ref of ['bad', '1234', 'UPI/123456789012', '1'.repeat(65)]) {
      expect((await report('Member 2', ref)).rows[0].ok).toBe(false);
    }
    const rows = (
      await client.query(
        'SELECT status, reference, reference_source, from_member_id, to_member_id FROM settlements WHERE pot_id = $1',
        [potId],
      )
    ).rows;
    expect(rows).toEqual([
      {
        status: 'initiated',
        reference: '123456789012',
        reference_source: 'self',
        from_member_id: group.memberIds[1],
        to_member_id: group.memberIds[0],
      },
    ]);
    const id = (await client.query('SELECT id FROM settlements WHERE pot_id = $1', [potId])).rows[0]
      .id;
    await expect(
      as('authenticated', group.profileIds[2]!, () =>
        client.query('SELECT waves_confirm_settlement($1)', [id]),
      ),
    ).rejects.toThrow();
    await as('authenticated', group.profileIds[0]!, () =>
      client.query('SELECT waves_confirm_settlement($1)', [id]),
    );
    expect(
      (await client.query('SELECT status FROM settlements WHERE id = $1', [id])).rows[0].status,
    ).toBe('confirmed');
  });
});
