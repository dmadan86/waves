/**
 * Importing into a group that already exists.
 *
 * `waves_import_into_group` takes one CHUNK of an import under a batch id the
 * phone chose up front; `waves_undo_import` reverses a whole batch. These tests
 * pin the promises a shared ledger is owed when somebody bulk-writes into it:
 *
 *   - names map to existing members or to ghosts, and the batch owns what it
 *     wrote;
 *   - a replay (a second tap, a lost response, a retried chunk) writes nothing
 *     twice - including the ghosts, which used to be minted again on every call;
 *   - 500 rows is the most one call takes;
 *   - an import is quiet: no per-expense notifications, one activity entry per
 *     batch, one digest to the other people on Waves (and none to a muted group);
 *   - undo puts every balance back, but never over somebody's edit, never after
 *     24 hours, and only for the importer or an admin;
 *   - 250 rows fit comfortably inside the API's statement timeout.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { IMPORT_CHUNK_SIZE, IMPORT_MAX_ROWS_PER_CALL, IMPORT_UNDO_WINDOW_HOURS } from '@waves/core';

import {
  addEqualSplitExpense,
  big,
  connect,
  expectDenied,
  readTruth,
  seedGroup,
} from './helpers.js';
import type { SeededGroup } from './helpers.js';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client?.end();
});

/** Run as a signed-in user. Not rolled back: the writes are the point. */
async function asUser<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  await client.query(`SET ROLE authenticated`);
  try {
    return await run();
  } finally {
    await client.query(`RESET ROLE`);
    await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

interface Person {
  name: string;
  memberId: string | null;
}

interface ExpenseRow {
  clientMutationId: string;
  description: string;
  date: string;
  currency: string;
  amount: string;
  payers: Record<string, string>;
  shares: Record<string, string>;
  splitHint?: string;
}

interface SettlementRow {
  clientMutationId: string;
  from: string;
  to: string;
  currency: string;
  amount: string;
  method: string;
  status?: string;
  at?: string;
}

interface ChunkResult {
  groupId: string;
  batchId: string;
  expenses: number;
  ghosts: number;
  settlements: number;
  settlementsPending: number;
  members: Record<string, string>;
  totals: { expenses: number; settlements: number; ghosts: number };
}

function expense(
  amount: bigint,
  payer: string,
  shares: Record<string, bigint>,
  extra: Partial<ExpenseRow> = {},
): ExpenseRow {
  return {
    clientMutationId: randomUUID(),
    description: 'Imported lunch',
    date: '2026-09-14',
    currency: 'INR',
    amount: amount.toString(),
    payers: { [payer]: amount.toString() },
    shares: Object.fromEntries(Object.entries(shares).map(([name, n]) => [name, n.toString()])),
    ...extra,
  };
}

function settlement(
  from: string,
  to: string,
  amount: bigint,
  extra: Partial<SettlementRow> = {},
): SettlementRow {
  return {
    clientMutationId: randomUUID(),
    from,
    to,
    currency: 'INR',
    amount: amount.toString(),
    method: 'cash',
    status: 'confirmed',
    ...extra,
  };
}

async function importChunk(
  profileId: string,
  args: {
    groupId: string;
    batchId: string;
    people: Person[];
    expenses: ExpenseRow[];
    settlements?: SettlementRow[];
    source?: string;
    final?: boolean;
  },
): Promise<ChunkResult> {
  return asUser(profileId, async () => {
    const { rows } = await client.query(
      `SELECT waves_import_into_group($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7) AS out`,
      [
        args.groupId,
        args.batchId,
        args.source ?? 'csv',
        JSON.stringify(args.people),
        JSON.stringify(args.expenses),
        JSON.stringify(args.settlements ?? []),
        args.final ?? true,
      ],
    );
    return rows[0]!.out as ChunkResult;
  });
}

async function undo(profileId: string, batchId: string): Promise<Record<string, unknown>> {
  return asUser(profileId, async () => {
    const { rows } = await client.query(`SELECT waves_undo_import($1) AS out`, [batchId]);
    return rows[0]!.out as Record<string, unknown>;
  });
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await client.query(sql, params);
  return Number(rows[0]!.n);
}

/** Only the non-zero entries: a ghost that nets to nothing is not a difference. */
function nonZero(map: Map<string, bigint>): Record<string, bigint> {
  return Object.fromEntries([...map].filter(([, balance]) => balance !== 0n));
}

/** A group of three real people (the first an admin) and one old ghost. */
async function scene(): Promise<{
  group: SeededGroup;
  admin: string;
  second: string;
  third: string;
}> {
  const group = await seedGroup(client, { memberCount: 3, ghostCount: 1 });
  return {
    group,
    admin: group.profileIds[0]!,
    second: group.profileIds[1]!,
    third: group.profileIds[2]!,
  };
}

function peopleOf(group: SeededGroup, ghostNames: string[] = ['Meera']): Person[] {
  return [
    { name: 'Asha', memberId: group.memberIds[0]! },
    { name: 'Ravi', memberId: group.memberIds[1]! },
    ...ghostNames.map((name) => ({ name, memberId: null })),
  ];
}

describe('importing a chunk into an existing group', () => {
  it('maps names onto members, mints a ghost for the rest, and stamps the batch on all of it', async () => {
    const { group, admin } = await scene();
    const batchId = randomUUID();
    const equal = expense(
      30_000n,
      'Asha',
      { Asha: 10_000n, Ravi: 10_000n, Meera: 10_000n },
      {
        description: 'Equal hint',
        splitHint: 'equal',
      },
    );
    const equalWithRemainder = expense(
      10_001n,
      'Ravi',
      { Asha: 3_334n, Ravi: 3_334n, Meera: 3_333n },
      {
        description: 'Equal hint, remainder',
        splitHint: 'equal',
      },
    );
    const lopsided = expense(
      10_300n,
      'Asha',
      { Asha: 100n, Ravi: 10_000n, Meera: 200n },
      {
        description: 'Lopsided but called equal',
        splitHint: 'equal',
      },
    );
    const exact = expense(
      9_000n,
      'Meera',
      { Asha: 3_000n, Ravi: 6_000n },
      { description: 'Exact' },
    );

    const result = await importChunk(admin, {
      groupId: group.groupId,
      batchId,
      people: peopleOf(group),
      expenses: [equal, equalWithRemainder, lopsided, exact],
    });

    expect(result.expenses).toBe(4);
    expect(result.ghosts).toBe(1);
    expect(result.totals).toEqual({ expenses: 4, settlements: 0, ghosts: 1 });
    expect(result.members.Asha).toBe(group.memberIds[0]);
    expect(result.members.Ravi).toBe(group.memberIds[1]);
    expect(group.memberIds).not.toContain(result.members.Meera);

    const { rows } = await client.query(
      `SELECT ev.description, ev.split_type::text AS split_type, ev.split_params, ev.source::text AS source,
              ev.import_batch_id
         FROM expense_versions ev JOIN expenses e ON e.id = ev.expense_id
        WHERE e.group_id = $1 ORDER BY ev.description`,
      [group.groupId],
    );
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.import_batch_id === batchId)).toBe(true);
    expect(rows.every((row) => row.source === 'imported')).toBe(true);
    const byDescription = Object.fromEntries(rows.map((row) => [row.description, row]));
    // Shares within one minor unit of each other, and the file said equal.
    expect(byDescription['Equal hint'].split_type).toBe('equal');
    expect(byDescription['Equal hint'].split_params).toEqual({ kind: 'equal' });
    expect(byDescription['Equal hint, remainder'].split_type).toBe('equal');
    // Called equal, but the shares say otherwise: the shares win.
    expect(byDescription['Lopsided but called equal'].split_type).toBe('exact');
    // No hint: exact, as it always was.
    expect(byDescription['Exact'].split_type).toBe('exact');

    const ghost = await client.query(
      `SELECT ghost_name, import_batch_id, joined_via FROM group_members WHERE id = $1`,
      [result.members.Meera],
    );
    expect(ghost.rows[0]).toMatchObject({
      ghost_name: 'Meera',
      import_batch_id: batchId,
      joined_via: 'ghost',
    });

    const batch = await client.query(
      `SELECT group_id, actor_member_id, source, expense_count, settlement_count, ghost_count
         FROM import_batches WHERE id = $1`,
      [batchId],
    );
    expect(batch.rows[0]).toMatchObject({
      group_id: group.groupId,
      actor_member_id: group.memberIds[0],
      source: 'csv',
      expense_count: 4,
      settlement_count: 0,
      ghost_count: 1,
    });

    // The books still balance.
    const truth = await readTruth(client, group.groupId);
    expect([...truth.values()].reduce((sum, value) => sum + value, 0n)).toBe(0n);
  });

  it('writes settlements under the batch too, with the file’s own confirmed status kept or asked for', async () => {
    const { group, admin } = await scene();
    const batchId = randomUUID();
    const result = await importChunk(admin, {
      groupId: group.groupId,
      batchId,
      people: peopleOf(group),
      expenses: [expense(6_000n, 'Asha', { Asha: 2_000n, Ravi: 2_000n, Meera: 2_000n })],
      settlements: [
        // The importer is the payee: stays settled.
        settlement('Ravi', 'Asha', 1_000n),
        // Two people on Waves, neither the importer: the payee has to confirm.
        settlement('Asha', 'Ravi', 500n, { from: 'Asha', to: 'Ravi' }),
      ],
    });
    expect(result.settlements).toBe(2);
    expect(result.settlementsPending).toBe(1);

    const { rows } = await client.query(
      `SELECT status::text AS status, import_batch_id FROM settlements WHERE group_id = $1 ORDER BY amount DESC`,
      [group.groupId],
    );
    expect(rows).toEqual([
      { status: 'confirmed', import_batch_id: batchId },
      { status: 'initiated', import_batch_id: batchId },
    ]);
  });

  it('is a replay when the same batch is sent again: no second row, ghost, or settlement', async () => {
    const { group, admin } = await scene();
    const batchId = randomUUID();
    const args = {
      groupId: group.groupId,
      batchId,
      people: peopleOf(group, ['Meera', 'Kiran']),
      expenses: [
        expense(3_000n, 'Asha', { Asha: 1_000n, Ravi: 1_000n, Meera: 1_000n }),
        expense(4_000n, 'Kiran', { Asha: 2_000n, Kiran: 2_000n }),
      ],
      settlements: [settlement('Meera', 'Asha', 700n)],
    };

    const first = await importChunk(admin, args);
    expect(first).toMatchObject({ expenses: 2, ghosts: 2, settlements: 1 });
    const before = await readTruth(client, group.groupId);

    const again = await importChunk(admin, args);
    expect(again).toMatchObject({ expenses: 0, ghosts: 0, settlements: 0 });
    expect(again.totals).toEqual({ expenses: 2, settlements: 1, ghosts: 2 });
    // The same people, not new ones.
    expect(again.members).toEqual(first.members);

    expect(
      await count(`SELECT count(*) AS n FROM expenses WHERE group_id = $1`, [group.groupId]),
    ).toBe(2);
    expect(
      await count(`SELECT count(*) AS n FROM settlements WHERE group_id = $1`, [group.groupId]),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*) AS n FROM group_members WHERE group_id = $1 AND import_batch_id = $2`,
        [group.groupId, batchId],
      ),
    ).toBe(2);
    expect(await readTruth(client, group.groupId)).toEqual(before);
  });

  it('lands later chunks on the ghosts the first chunk minted', async () => {
    const { group, admin } = await scene();
    const batchId = randomUUID();
    const people = peopleOf(group);

    const one = await importChunk(admin, {
      groupId: group.groupId,
      batchId,
      people,
      expenses: [expense(3_000n, 'Meera', { Asha: 1_000n, Ravi: 1_000n, Meera: 1_000n })],
      final: false,
    });
    const two = await importChunk(admin, {
      groupId: group.groupId,
      batchId,
      people,
      expenses: [expense(1_200n, 'Asha', { Asha: 600n, Meera: 600n })],
    });

    expect(one.ghosts).toBe(1);
    expect(two.ghosts).toBe(0);
    expect(two.members.Meera).toBe(one.members.Meera);
    expect(two.totals).toEqual({ expenses: 2, settlements: 0, ghosts: 1 });
    expect(
      await count(
        `SELECT count(*) AS n FROM group_members WHERE group_id = $1 AND ghost_name = 'Meera'`,
        [group.groupId],
      ),
    ).toBe(1);
  });

  it('still mints a fresh ghost for a different batch (two imports are two imports)', async () => {
    const { group, admin } = await scene();
    const people = peopleOf(group);
    const rows = () => [expense(2_000n, 'Asha', { Asha: 1_000n, Meera: 1_000n })];
    const a = await importChunk(admin, {
      groupId: group.groupId,
      batchId: randomUUID(),
      people,
      expenses: rows(),
    });
    const b = await importChunk(admin, {
      groupId: group.groupId,
      batchId: randomUUID(),
      people,
      expenses: rows(),
    });
    expect(a.ghosts).toBe(1);
    expect(b.ghosts).toBe(1);
    expect(a.members.Meera).not.toBe(b.members.Meera);
  });

  it('keeps ONE activity entry per batch, at the running totals', async () => {
    const { group, admin } = await scene();
    const batchId = randomUUID();
    const people = peopleOf(group);

    await importChunk(admin, {
      groupId: group.groupId,
      batchId,
      people,
      expenses: [expense(1_000n, 'Asha', { Asha: 500n, Ravi: 500n })],
      final: false,
    });
    await importChunk(admin, {
      groupId: group.groupId,
      batchId,
      people,
      expenses: [
        expense(2_000n, 'Ravi', { Asha: 1_000n, Ravi: 1_000n }),
        expense(500n, 'Ravi', { Asha: 250n, Ravi: 250n }),
      ],
      settlements: [settlement('Ravi', 'Asha', 100n)],
    });

    const { rows } = await client.query(
      `SELECT verb, actor_member_id, payload FROM activity_log
        WHERE group_id = $1 AND object_type = 'import_batch' AND object_id = $2`,
      [group.groupId, batchId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      verb: 'imported',
      actor_member_id: group.memberIds[0],
      payload: { expenses: 3, settlements: 1, ghosts: 1, from: 'csv' },
    });
    // The rows themselves wrote no per-expense entries.
    expect(
      await count(
        `SELECT count(*) AS n FROM activity_log WHERE group_id = $1 AND object_type = 'expense'`,
        [group.groupId],
      ),
    ).toBe(3); // waves_apply_expense's own 'added' rows, as for every write path
  });

  it('refuses more than 500 rows in one call, and writes nothing', async () => {
    const { group, admin } = await scene();
    const batchId = randomUUID();
    const one = expense(100n, 'Asha', { Asha: 50n, Ravi: 50n });

    const message = await expectDenied(
      importChunk(admin, {
        groupId: group.groupId,
        batchId,
        people: peopleOf(group),
        expenses: Array.from({ length: IMPORT_MAX_ROWS_PER_CALL }, () => ({
          ...one,
          clientMutationId: randomUUID(),
        })),
        settlements: [settlement('Ravi', 'Asha', 10n)],
      }),
    );
    expect(message).toMatch(/TOO_MANY_ROWS/);
    expect(await count(`SELECT count(*) AS n FROM import_batches WHERE id = $1`, [batchId])).toBe(
      0,
    );
    expect(
      await count(`SELECT count(*) AS n FROM expenses WHERE group_id = $1`, [group.groupId]),
    ).toBe(0);
  });

  it('refuses somebody who is not in the group', async () => {
    const { group } = await scene();
    const outsider = randomUUID();
    await client.query(
      `INSERT INTO profiles (id, display_name, default_currency) VALUES ($1, 'Outsider', 'INR')`,
      [outsider],
    );

    const message = await expectDenied(
      importChunk(outsider, {
        groupId: group.groupId,
        batchId: randomUUID(),
        people: peopleOf(group),
        expenses: [expense(100n, 'Asha', { Asha: 50n, Ravi: 50n })],
      }),
    );
    expect(message).toMatch(/NOT_A_MEMBER/);
  });

  it('refuses somebody who has left the group', async () => {
    const { group, second } = await scene();
    await client.query(`UPDATE group_members SET left_at = now() WHERE id = $1`, [
      group.memberIds[1],
    ]);
    const message = await expectDenied(
      importChunk(second, {
        groupId: group.groupId,
        batchId: randomUUID(),
        people: peopleOf(group),
        expenses: [expense(100n, 'Asha', { Asha: 50n, Ravi: 50n })],
      }),
    );
    expect(message).toMatch(/NOT_A_MEMBER/);
  });

  it('does not let one person write under another person’s, or another group’s, batch id', async () => {
    const mine = await scene();
    const theirs = await scene();
    const batchId = randomUUID();
    await importChunk(mine.admin, {
      groupId: mine.group.groupId,
      batchId,
      people: peopleOf(mine.group),
      expenses: [expense(100n, 'Asha', { Asha: 50n, Ravi: 50n })],
    });

    // A different person in the same group.
    expect(
      await expectDenied(
        importChunk(mine.second, {
          groupId: mine.group.groupId,
          batchId,
          people: peopleOf(mine.group),
          expenses: [expense(100n, 'Asha', { Asha: 50n, Ravi: 50n })],
        }),
      ),
    ).toMatch(/BATCH_CONFLICT/);

    // The same id from a member of another group.
    expect(
      await expectDenied(
        importChunk(theirs.admin, {
          groupId: theirs.group.groupId,
          batchId,
          people: peopleOf(theirs.group),
          expenses: [expense(100n, 'Asha', { Asha: 50n, Ravi: 50n })],
        }),
      ),
    ).toMatch(/BATCH_CONFLICT/);
  });

  it('refuses a made-up source, an import of nobody, and a batch that was undone', async () => {
    const { group, admin } = await scene();
    const base = {
      groupId: group.groupId,
      people: peopleOf(group),
      expenses: [expense(100n, 'Asha', { Asha: 50n, Ravi: 50n })],
    };
    expect(
      await expectDenied(
        importChunk(admin, { ...base, batchId: randomUUID(), source: 'carrier-pigeon' }),
      ),
    ).toMatch(/INVALID_SOURCE/);
    expect(
      await expectDenied(importChunk(admin, { ...base, batchId: randomUUID(), people: [] })),
    ).toMatch(/NO_PEOPLE/);

    const batchId = randomUUID();
    await importChunk(admin, { ...base, batchId });
    await undo(admin, batchId);
    expect(await expectDenied(importChunk(admin, { ...base, batchId }))).toMatch(/IMPORT_UNDONE/);
  });

  it('is not callable signed-out, and the internal row writer is not callable signed-in', async () => {
    const { group, admin } = await scene();
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ role: 'anon' }),
      ]);
      await client.query('SET LOCAL ROLE anon');
      const message = await expectDenied(
        client.query(`SELECT waves_import_into_group($1, $2, 'csv', '[]', '[]', '[]')`, [
          group.groupId,
          randomUUID(),
        ]),
      );
      expect(message).toMatch(/permission denied/i);
    } finally {
      await client.query('ROLLBACK');
    }

    const message = await expectDenied(
      asUser(admin, () =>
        client.query(`SELECT waves_import_rows($1, $2, '[{"name":"x"}]', '[]', '[]', NULL)`, [
          group.groupId,
          group.memberIds[0],
        ]),
      ),
    );
    expect(message).toMatch(/permission denied/i);
  });
});

describe('what an import tells the other people in the group', () => {
  it('sends no per-expense notification, and ONE digest per other real member on the last chunk', async () => {
    const { group, admin, second, third } = await scene();
    const batchId = randomUUID();
    const people = peopleOf(group);

    await importChunk(admin, {
      groupId: group.groupId,
      batchId,
      people,
      expenses: [expense(1_000n, 'Asha', { Asha: 500n, Ravi: 500n })],
      final: false,
    });
    expect(
      await count(`SELECT count(*) AS n FROM notifications WHERE group_id = $1`, [group.groupId]),
    ).toBe(0);

    const args = {
      groupId: group.groupId,
      batchId,
      people,
      expenses: [expense(2_000n, 'Ravi', { Asha: 1_000n, Ravi: 1_000n })],
    };
    await importChunk(admin, args);
    // Retrying the last chunk (a lost response) tells nobody twice.
    await importChunk(admin, args);

    const { rows } = await client.query(
      `SELECT profile_id, kind, payload FROM notifications WHERE group_id = $1 ORDER BY profile_id`,
      [group.groupId],
    );
    expect(rows.map((row) => row.kind)).toEqual(['group_import', 'group_import']);
    expect(rows.map((row) => row.profile_id).sort()).toEqual([second, third].sort());
    expect(rows[0].payload).toMatchObject({ counterparty: 'Member 1', count: '2', batchId });
    // Not the importer, and nothing of the expense_added kind.
    expect(rows.some((row) => row.profile_id === admin)).toBe(false);
  });

  it('pushes the digest to somebody with a phone, and keeps it quiet for a muted group', async () => {
    const { group, admin, second, third } = await scene();
    for (const profile of [second, third]) {
      await client.query(
        `INSERT INTO push_tokens (profile_id, expo_push_token, platform) VALUES ($1, $2, 'android')`,
        [profile, `ExponentPushToken[${randomUUID()}]`],
      );
    }
    await client.query(
      `INSERT INTO group_mutes (id, owner_user_id, group_id) VALUES ($1, $2, $3)`,
      [randomUUID(), third, group.groupId],
    );

    await importChunk(admin, {
      groupId: group.groupId,
      batchId: randomUUID(),
      people: peopleOf(group),
      expenses: [expense(1_000n, 'Asha', { Asha: 500n, Ravi: 500n })],
    });

    const ids = await client.query(`SELECT id, profile_id FROM notifications WHERE group_id = $1`, [
      group.groupId,
    ]);
    const claimed = await client.query(`SELECT id FROM waves_claim_push_notifications(500)`);
    const claimedIds = new Set(claimed.rows.map((row) => String(row.id)));
    const forSecond = ids.rows.find((row) => row.profile_id === second)!;
    const forThird = ids.rows.find((row) => row.profile_id === third)!;
    expect(claimedIds.has(String(forSecond.id))).toBe(true);
    expect(claimedIds.has(String(forThird.id))).toBe(false);

    // The muted person still has it in their inbox; it is only the buzz that is held back.
    const status = await client.query(
      `SELECT push_status::text AS status FROM notifications WHERE id = $1`,
      [forThird.id],
    );
    expect(status.rows[0]!.status).toBe('suppressed');
  });

  it('sits under the "involves me" switch, like the expense notices it stands in for', async () => {
    const { rows } = await client.query(
      `SELECT waves_pref_key_for_kind('group_import') AS key,
              waves_pref_key_for_kind('expense_added') AS expense_key`,
    );
    expect(rows[0]).toEqual({ key: 'involvesMe', expense_key: 'involvesMe' });
  });

  it('tells nobody when the import wrote nothing', async () => {
    const { group, admin } = await scene();
    await importChunk(admin, {
      groupId: group.groupId,
      batchId: randomUUID(),
      people: peopleOf(group),
      expenses: [],
    });
    expect(
      await count(`SELECT count(*) AS n FROM notifications WHERE group_id = $1`, [group.groupId]),
    ).toBe(0);
  });
});

describe('waves_import_ledger is what it was', () => {
  it('still mints ghosts per call, writes a group-level "imported" entry, and carries no batch', async () => {
    const { group, admin } = await scene();
    const people = peopleOf(group);
    const rows = JSON.stringify([expense(2_000n, 'Asha', { Asha: 1_000n, Meera: 1_000n })]);
    const out = await asUser(admin, async () => {
      const { rows: r } = await client.query(
        `SELECT waves_import_ledger($1, $2::jsonb, $3::jsonb, '[]'::jsonb, 'splitwise') AS out`,
        [group.groupId, JSON.stringify(people), rows],
      );
      return r[0]!.out as Record<string, unknown>;
    });
    expect(out).toMatchObject({
      groupId: group.groupId,
      expenses: 1,
      ghosts: 1,
      settlements: 0,
      settlementsPending: 0,
    });
    expect(Object.keys(out.members as Record<string, string>).sort()).toEqual([
      'Asha',
      'Meera',
      'Ravi',
    ]);

    const activity = await client.query(
      `SELECT object_type, payload FROM activity_log WHERE group_id = $1 AND verb = 'imported'`,
      [group.groupId],
    );
    expect(activity.rows).toEqual([
      {
        object_type: 'group',
        payload: {
          expenses: 1,
          ghosts: 1,
          settlements: 0,
          settlementsPending: 0,
          from: 'splitwise',
        },
      },
    ]);
    expect(
      await count(
        `SELECT count(*) AS n FROM expense_versions ev JOIN expenses e ON e.id = ev.expense_id
          WHERE e.group_id = $1 AND ev.import_batch_id IS NOT NULL`,
        [group.groupId],
      ),
    ).toBe(0);
  });
});

describe('undoing an import', () => {
  /** An import with expenses, a ghost, a confirmed settlement and a pending one. */
  async function imported(): Promise<{
    group: SeededGroup;
    admin: string;
    second: string;
    third: string;
    batchId: string;
    before: Record<string, bigint>;
    result: ChunkResult;
  }> {
    const { group, admin, second, third } = await scene();
    // Something already in the group, so "back to what it was" is not "back to nothing".
    await addEqualSplitExpense(client, {
      groupId: group.groupId,
      payers: { [group.memberIds[1]!]: 4_000n },
      participants: [group.memberIds[0]!, group.memberIds[1]!],
      amount: 4_000n,
    });
    const before = nonZero(await readTruth(client, group.groupId));
    const batchId = randomUUID();
    const result = await importChunk(admin, {
      groupId: group.groupId,
      batchId,
      people: peopleOf(group),
      expenses: [
        expense(9_000n, 'Asha', { Asha: 3_000n, Ravi: 3_000n, Meera: 3_000n }),
        expense(5_000n, 'Meera', { Asha: 2_500n, Meera: 2_500n }),
      ],
      settlements: [
        settlement('Ravi', 'Asha', 1_500n),
        settlement('Asha', 'Ravi', 400n, { status: 'confirmed' }),
      ],
    });
    return { group, admin, second, third, batchId, before, result };
  }

  it('puts every balance back, soft-deletes the expenses, cancels the settlements and takes the ghost out', async () => {
    const { group, admin, batchId, before, result } = await imported();
    expect(nonZero(await readTruth(client, group.groupId))).not.toEqual(before);

    const out = await undo(admin, batchId);
    expect(out).toMatchObject({
      undone: true,
      replayed: false,
      expenses: 2,
      settlements: 2,
      ghostsRemoved: 1,
      ghostsKept: 0,
    });

    expect(nonZero(await readTruth(client, group.groupId))).toEqual(before);
    // The group_balances cache agrees with the ledger it is derived from.
    const cached = await client.query(
      `SELECT member_id, balance FROM group_balances WHERE group_id = $1`,
      [group.groupId],
    );
    expect(
      nonZero(new Map(cached.rows.map((row) => [String(row.member_id), big(row.balance)]))),
    ).toEqual(before);

    const live = await count(
      `SELECT count(*) AS n FROM expenses e JOIN expense_versions ev ON ev.expense_id = e.id
        WHERE e.group_id = $1 AND ev.import_batch_id = $2 AND e.deleted_at IS NULL`,
      [group.groupId, batchId],
    );
    expect(live).toBe(0);
    const deleted = await client.query(
      `SELECT DISTINCT deleted_by FROM expenses e JOIN expense_versions ev ON ev.expense_id = e.id
        WHERE ev.import_batch_id = $1`,
      [batchId],
    );
    expect(deleted.rows).toEqual([{ deleted_by: group.memberIds[0] }]);

    const statuses = await client.query(
      `SELECT DISTINCT status::text AS status FROM settlements WHERE import_batch_id = $1`,
      [batchId],
    );
    expect(statuses.rows).toEqual([{ status: 'cancelled' }]);

    const ghost = await client.query(`SELECT left_at FROM group_members WHERE id = $1`, [
      result.members.Meera,
    ]);
    expect(ghost.rows[0]!.left_at).not.toBeNull();

    const batch = await client.query(
      `SELECT undone_at, undone_by FROM import_batches WHERE id = $1`,
      [batchId],
    );
    expect(batch.rows[0]!.undone_at).not.toBeNull();
    expect(batch.rows[0]!.undone_by).toBe(group.memberIds[0]);

    const activity = await client.query(
      `SELECT payload FROM activity_log WHERE group_id = $1 AND verb = 'import_undone' AND object_id = $2`,
      [group.groupId, batchId],
    );
    expect(activity.rows).toHaveLength(1);
    expect(activity.rows[0]!.payload).toMatchObject({
      expenses: 2,
      settlements: 2,
      ghostsRemoved: 1,
      ghostsKept: 0,
      from: 'csv',
    });
    // The batch's own "imported" entry stays: the feed reads "imported", then "undid".
    expect(
      await count(
        `SELECT count(*) AS n FROM activity_log WHERE object_id = $1 AND verb = 'imported'`,
        [batchId],
      ),
    ).toBe(1);
  });

  it('does not tell anyone a payment was "withdrawn"', async () => {
    const { group, admin, batchId } = await imported();
    await undo(admin, batchId);
    expect(
      await count(
        `SELECT count(*) AS n FROM notifications WHERE group_id = $1 AND kind LIKE 'settlement_%'`,
        [group.groupId],
      ),
    ).toBe(0);
  });

  it('is a no-op the second time', async () => {
    const { admin, batchId } = await imported();
    await undo(admin, batchId);
    expect(await undo(admin, batchId)).toMatchObject({ undone: true, replayed: true });
  });

  it('works for the importer and for an admin, and for nobody else', async () => {
    const { group, admin, second, third } = await scene();
    const people = [
      { name: 'Asha', memberId: group.memberIds[0]! },
      { name: 'Ravi', memberId: group.memberIds[1]! },
    ];
    const run = async (): Promise<string> => {
      const batchId = randomUUID();
      // The SECOND member imports; the admin and the third did not.
      await importChunk(second, {
        groupId: group.groupId,
        batchId,
        people,
        expenses: [expense(1_000n, 'Asha', { Asha: 500n, Ravi: 500n })],
      });
      return batchId;
    };

    const outsider = randomUUID();
    await client.query(
      `INSERT INTO profiles (id, display_name, default_currency) VALUES ($1, 'Outsider', 'INR')`,
      [outsider],
    );

    const first = await run();
    expect(await expectDenied(undo(outsider, first))).toMatch(/NOT_A_MEMBER/);
    expect(await expectDenied(undo(third, first))).toMatch(/NOT_ALLOWED/);
    expect(await undo(admin, first)).toMatchObject({ undone: true, expenses: 1 });

    const mine = await run();
    expect(await undo(second, mine)).toMatchObject({ undone: true, expenses: 1 });
  });

  it('refuses a batch that does not exist', async () => {
    const { second } = await scene();
    expect(await expectDenied(undo(second, randomUUID()))).toMatch(/NOT_FOUND/);
  });

  it('works at 23 hours 50 minutes and is refused after 24', async () => {
    expect(IMPORT_UNDO_WINDOW_HOURS).toBe(24);
    const inside = await imported();
    await client.query(
      `UPDATE import_batches SET created_at = now() - interval '23 hours 50 minutes' WHERE id = $1`,
      [inside.batchId],
    );
    expect(await undo(inside.admin, inside.batchId)).toMatchObject({ undone: true });

    const outside = await imported();
    await client.query(
      `UPDATE import_batches SET created_at = now() - interval '24 hours 1 minute' WHERE id = $1`,
      [outside.batchId],
    );
    expect(await expectDenied(undo(outside.admin, outside.batchId))).toMatch(/IMPORT_UNDO_EXPIRED/);
    // Nothing moved.
    expect(
      await count(`SELECT count(*) AS n FROM import_batches WHERE id = $1 AND undone_at IS NULL`, [
        outside.batchId,
      ]),
    ).toBe(1);
  });

  it('keeps the window in SQL equal to the one in @waves/core', async () => {
    const { rows } = await client.query(
      `SELECT prosrc FROM pg_proc WHERE proname = 'waves_undo_import'`,
    );
    expect(rows[0]!.prosrc).toContain(`interval '${IMPORT_UNDO_WINDOW_HOURS} hours'`);
    const cap = await client.query(
      `SELECT prosrc FROM pg_proc WHERE proname = 'waves_import_into_group'`,
    );
    expect(cap.rows[0]!.prosrc).toContain(
      `v_max_rows    constant int := ${IMPORT_MAX_ROWS_PER_CALL}`,
    );
  });

  it('refuses once an imported expense has been edited, and leaves everything as it was', async () => {
    const { group, admin, batchId, result } = await imported();
    const target = await client.query(
      `SELECT e.id FROM expenses e JOIN expense_versions ev ON ev.expense_id = e.id
        WHERE ev.import_batch_id = $1 LIMIT 1`,
      [batchId],
    );
    await client.query(
      `SELECT waves_apply_expense(
         p_group_id := $1, p_expense_id := $2, p_author_member_id := $3, p_description := 'Fixed it',
         p_category := NULL, p_expense_date := '2026-09-14', p_currency := 'INR', p_amount := 600,
         p_split_type := 'exact', p_split_params := '{"kind":"exact","amounts":{}}'::jsonb,
         p_payers := $4::jsonb, p_shares := $5::jsonb, p_client_mutation_id := $6)`,
      [
        group.groupId,
        target.rows[0]!.id,
        group.memberIds[1],
        JSON.stringify([{ memberId: group.memberIds[1], amount: '600' }]),
        JSON.stringify([
          { memberId: group.memberIds[0], amount: '300' },
          { memberId: group.memberIds[1], amount: '300' },
        ]),
        randomUUID(),
      ],
    );

    const before = nonZero(await readTruth(client, group.groupId));
    expect(await expectDenied(undo(admin, batchId))).toMatch(/IMPORT_EDITED/);
    expect(nonZero(await readTruth(client, group.groupId))).toEqual(before);
    expect(
      await count(`SELECT count(*) AS n FROM import_batches WHERE id = $1 AND undone_at IS NULL`, [
        batchId,
      ]),
    ).toBe(1);
    expect(
      await count(`SELECT count(*) AS n FROM group_members WHERE id = $1 AND left_at IS NULL`, [
        result.members.Meera,
      ]),
    ).toBe(1);
  });

  it('refuses once somebody has confirmed or disputed one of the imported settlements', async () => {
    const { admin, batchId } = await imported();
    // The pending one (Asha -> Ravi, neither the importer's to vouch for... Ravi is a real member): Ravi confirms it.
    const pending = await client.query(
      `SELECT id FROM settlements WHERE import_batch_id = $1 AND status = 'initiated'`,
      [batchId],
    );
    // `imported()` makes the Asha -> Ravi row confirmed (the importer is the payer, payee is real) or initiated;
    // move whichever is pending, or a confirmed one, to a later state.
    if (pending.rows.length > 0) {
      await client.query(`UPDATE settlements SET status = 'confirmed' WHERE id = $1`, [
        pending.rows[0]!.id,
      ]);
    } else {
      await client.query(
        `UPDATE settlements SET status = 'disputed'
          WHERE id = (SELECT id FROM settlements WHERE import_batch_id = $1 AND status = 'initiated' LIMIT 1)`,
        [batchId],
      );
    }
    expect(await expectDenied(undo(admin, batchId))).toMatch(/IMPORT_EDITED/);
  });

  it('keeps a ghost that something else now refers to', async () => {
    const { group, admin, batchId, result } = await imported();
    // After the import somebody adds an ordinary expense that includes the new ghost.
    await addEqualSplitExpense(client, {
      groupId: group.groupId,
      payers: { [group.memberIds[1]!]: 2_000n },
      participants: [group.memberIds[1]!, result.members.Meera!],
      amount: 2_000n,
      description: 'Drinks with Meera',
    });

    const out = await undo(admin, batchId);
    expect(out).toMatchObject({ ghostsRemoved: 0, ghostsKept: 1 });
    expect(
      await count(`SELECT count(*) AS n FROM group_members WHERE id = $1 AND left_at IS NULL`, [
        result.members.Meera,
      ]),
    ).toBe(1);
  });

  it('leaves ghosts that were already in the group alone', async () => {
    const { group, admin } = await scene();
    const oldGhost = group.memberIds[3]!;
    const batchId = randomUUID();
    await importChunk(admin, {
      groupId: group.groupId,
      batchId,
      people: [
        { name: 'Asha', memberId: group.memberIds[0]! },
        { name: 'Old ghost', memberId: oldGhost },
      ],
      expenses: [expense(1_000n, 'Asha', { Asha: 500n, 'Old ghost': 500n })],
    });
    expect(await undo(admin, batchId)).toMatchObject({ ghostsRemoved: 0, ghostsKept: 0 });
    expect(
      await count(`SELECT count(*) AS n FROM group_members WHERE id = $1 AND left_at IS NULL`, [
        oldGhost,
      ]),
    ).toBe(1);
  });

  it('can undo a batch that only half arrived', async () => {
    const { group, admin } = await scene();
    const batchId = randomUUID();
    await importChunk(admin, {
      groupId: group.groupId,
      batchId,
      people: peopleOf(group),
      expenses: [expense(1_000n, 'Asha', { Asha: 500n, Ravi: 500n, Meera: 0n })],
      final: false,
    });
    expect(await undo(admin, batchId)).toMatchObject({ undone: true, expenses: 1 });
  });
});

describe('the exemptions that make undo possible stay narrow', () => {
  it('a signed-in client still cannot edit or delete the activity log', async () => {
    const { group, admin } = await scene();
    const batchId = randomUUID();
    await importChunk(admin, {
      groupId: group.groupId,
      batchId,
      people: peopleOf(group),
      expenses: [expense(1_000n, 'Asha', { Asha: 500n, Ravi: 500n })],
    });

    // Even naming the batch in the setting the definer function uses.
    for (const statement of [
      `UPDATE activity_log SET payload = '{}' WHERE object_id = $1`,
      `DELETE FROM activity_log WHERE object_id = $1`,
    ]) {
      const message = await expectDenied(
        asUser(admin, async () => {
          await client.query(`SELECT set_config('waves.import_activity', $1, false)`, [batchId]);
          await client.query(statement, [batchId]);
        }),
      );
      expect(message).toMatch(/permission denied|APPEND_ONLY/);
      // Session-level on this connection: clear it so it cannot leak into the next check.
      await client.query(`SELECT set_config('waves.import_activity', '', false)`);
    }
    // A superuser outside the function is still stopped.
    expect(
      await expectDenied(
        client.query(`UPDATE activity_log SET payload = '{}' WHERE object_id = $1`, [batchId]),
      ),
    ).toMatch(/APPEND_ONLY/);
    // And an ordinary activity row can never be updated.
    expect(
      await expectDenied(
        client.query(
          `UPDATE activity_log SET payload = '{}' WHERE group_id = $1 AND object_type = 'expense'`,
          [group.groupId],
        ),
      ),
    ).toMatch(/APPEND_ONLY/);
  });

  it('a settlement still cannot go from confirmed back to cancelled by anyone but an undo', async () => {
    const { group, admin } = await scene();
    const batchId = randomUUID();
    await importChunk(admin, {
      groupId: group.groupId,
      batchId,
      people: peopleOf(group),
      expenses: [expense(1_000n, 'Asha', { Asha: 500n, Ravi: 500n })],
      settlements: [settlement('Ravi', 'Asha', 100n)],
    });
    const { rows } = await client.query(`SELECT id FROM settlements WHERE import_batch_id = $1`, [
      batchId,
    ]);
    const id = rows[0]!.id;

    // As the payee, with the undo setting forged: refused.
    const forged = await expectDenied(
      asUser(admin, async () => {
        await client.query(`SELECT set_config('waves.undoing_import', $1, false)`, [batchId]);
        await client.query(`UPDATE settlements SET status = 'cancelled' WHERE id = $1`, [id]);
      }),
    );
    expect(forged).toMatch(/INVALID_TRANSITION|permission denied|row-level security/);
    await client.query(`SELECT set_config('waves.undoing_import', '', false)`);
    // Without the setting, even a superuser is refused.
    expect(
      await expectDenied(
        client.query(`UPDATE settlements SET status = 'cancelled' WHERE id = $1`, [id]),
      ),
    ).toMatch(/INVALID_TRANSITION/);
  });

  it('a signed-in client cannot read or write import_batches directly', async () => {
    const { group, admin } = await scene();
    const batchId = randomUUID();
    await importChunk(admin, {
      groupId: group.groupId,
      batchId,
      people: peopleOf(group),
      expenses: [expense(1_000n, 'Asha', { Asha: 500n, Ravi: 500n })],
    });
    // A member reads it.
    const seen = await asUser(
      admin,
      async () =>
        (await client.query(`SELECT id FROM import_batches WHERE id = $1`, [batchId])).rows,
    );
    expect(seen).toHaveLength(1);
    // A non-member does not.
    const outsider = randomUUID();
    await client.query(
      `INSERT INTO profiles (id, display_name, default_currency) VALUES ($1, 'Outsider', 'INR')`,
      [outsider],
    );
    const hidden = await asUser(
      outsider,
      async () =>
        (await client.query(`SELECT id FROM import_batches WHERE id = $1`, [batchId])).rows,
    );
    expect(hidden).toHaveLength(0);
    // Nobody writes.
    for (const statement of [
      `UPDATE import_batches SET expense_count = 0 WHERE id = $1`,
      `DELETE FROM import_batches WHERE id = $1`,
      `INSERT INTO import_batches (id, group_id, source) SELECT gen_random_uuid(), group_id, 'csv' FROM import_batches WHERE id = $1`,
    ]) {
      expect(await expectDenied(asUser(admin, () => client.query(statement, [batchId])))).toMatch(
        /permission denied/,
      );
    }
  });
});

describe('a full chunk', () => {
  it(`takes ${IMPORT_CHUNK_SIZE} rows well inside the API statement timeout`, async () => {
    const { group, admin } = await scene();
    const batchId = randomUUID();
    const people: Person[] = [
      { name: 'Asha', memberId: group.memberIds[0]! },
      { name: 'Ravi', memberId: group.memberIds[1]! },
      { name: 'Kiran', memberId: group.memberIds[2]! },
      { name: 'Meera', memberId: null },
    ];
    const expenses = Array.from({ length: IMPORT_CHUNK_SIZE }, (_, index) => {
      const payer = ['Asha', 'Ravi', 'Kiran', 'Meera'][index % 4]!;
      return expense(
        10_000n + BigInt(index),
        payer,
        { Asha: 2_500n, Ravi: 2_500n, Kiran: 2_500n, Meera: 2_500n + BigInt(index) },
        {
          description: `Row ${index}`,
          date: `2026-08-${String((index % 28) + 1).padStart(2, '0')}`,
        },
      );
    });

    // Supabase's `authenticated` role has an 8 s statement timeout; hold the test to it.
    await client.query(`SELECT set_config('statement_timeout', '8s', false)`);
    const started = performance.now();
    let result: ChunkResult;
    try {
      result = await importChunk(admin, { groupId: group.groupId, batchId, people, expenses });
    } finally {
      await client.query(`RESET statement_timeout`);
    }
    const elapsed = performance.now() - started;
    // eslint-disable-next-line no-console
    console.log(
      `[group-import] ${IMPORT_CHUNK_SIZE}-row chunk: ${elapsed.toFixed(0)} ms (${(elapsed / IMPORT_CHUNK_SIZE).toFixed(1)} ms/row)`,
    );

    expect(result.expenses).toBe(IMPORT_CHUNK_SIZE);
    expect(elapsed).toBeLessThan(8_000);
    const truth = await readTruth(client, group.groupId);
    expect([...truth.values()].reduce((sum, value) => sum + value, 0n)).toBe(0n);

    // And undoing it is no slower.
    const undoStarted = performance.now();
    await undo(admin, batchId);
    // eslint-disable-next-line no-console
    console.log(
      `[group-import] undo of ${IMPORT_CHUNK_SIZE} rows: ${(performance.now() - undoStarted).toFixed(0)} ms`,
    );
    expect(performance.now() - undoStarted).toBeLessThan(8_000);
  });
});

describe('the balance refresh survives deferred triggers firing early', () => {
  it('includes a write made after SET CONSTRAINTS ALL IMMEDIATE in the same transaction', async () => {
    const { group } = await scene();
    const [a, b] = group.memberIds as [string, string];
    const apply = (amount: number, description: string) =>
      client.query(
        `SELECT waves_apply_expense(
           p_group_id := $1, p_expense_id := NULL, p_author_member_id := $2, p_description := $3,
           p_category := NULL, p_expense_date := '2026-09-14', p_currency := 'INR', p_amount := $4,
           p_split_type := 'exact', p_split_params := '{"kind":"exact","amounts":{}}'::jsonb,
           p_payers := $5::jsonb, p_shares := $6::jsonb, p_client_mutation_id := $7)`,
        [
          group.groupId,
          a,
          description,
          amount,
          JSON.stringify([{ memberId: a, amount: String(amount) }]),
          JSON.stringify([
            { memberId: a, amount: String(amount / 2) },
            { memberId: b, amount: String(amount / 2) },
          ]),
          randomUUID(),
        ],
      );

    await client.query('BEGIN');
    try {
      await apply(1_000, 'A');
      // Deferred triggers fire now, for A only...
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      const early = await client.query(
        `SELECT balance FROM group_balances WHERE group_id = $1 AND member_id = $2`,
        [group.groupId, b],
      );
      expect(big(early.rows[0]!.balance)).toBe(-500n);
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      // ...and B is written after.
      await apply(4_000, 'B');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    const cached = await client.query(
      `SELECT member_id, balance FROM group_balances WHERE group_id = $1`,
      [group.groupId],
    );
    const truth = await readTruth(client, group.groupId);
    expect(truth.get(b)).toBe(-2_500n);
    expect(nonZero(new Map(cached.rows.map((r) => [String(r.member_id), big(r.balance)])))).toEqual(
      nonZero(truth),
    );
  });
});
