/**
 * A group settles in its own currency (ADR-003 amendment,
 * 20261009120000_settle_in_group_currency).
 *
 * The headline promise is parity: Postgres (`waves_group_expense_lines` and the
 * truth functions built on it) and @waves/core (`toSettleExpense`) must convert
 * and apportion every bill to the same minor unit, or the app and the server
 * show two different balances. That is checked on random ledgers below, then
 * the switch, its readiness check, the settlement refusal and the currency
 * freeze are checked one rule at a time.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import {
  computeNetBalances,
  computePairwiseBalances,
  computeShares,
  KNOWN_MINOR_UNIT_EXPONENTS,
  minorUnitExponent,
  SettlementStatus,
  toLedgerSnapshots,
  toSettleExpense,
  usableFx,
  type ExpenseSnapshot,
  type SettlementSnapshot,
} from '@waves/core';

import { big, connect, expectDenied, seedGroup } from './helpers.js';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client?.end();
});

/** Seeded, so a failure names a ledger that can be replayed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function asUser<T>(profileId: string | null, run: () => Promise<T>): Promise<T> {
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify(profileId ? { sub: profileId, role: 'authenticated' } : { role: 'anon' }),
  ]);
  await client.query(profileId ? `SET ROLE authenticated` : `SET ROLE anon`);
  try {
    return await run();
  } finally {
    await client.query(`RESET ROLE`);
    await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

interface WrittenBill {
  versionId: string;
  snapshot: ExpenseSnapshot;
}

/** One bill, written the way the ledger stores it, with an optional stored rate. */
async function writeBill(
  groupId: string,
  bill: {
    currency: string;
    amount: bigint;
    payers: Record<string, bigint>;
    shares: Record<string, bigint>;
    fx?: unknown;
  },
): Promise<WrittenBill> {
  const expenseId = randomUUID();
  const versionId = randomUUID();
  const author = Object.keys(bill.payers)[0] ?? null;
  await client.query('BEGIN');
  await client.query(`INSERT INTO expenses (id, group_id) VALUES ($1, $2)`, [expenseId, groupId]);
  await client.query(
    `INSERT INTO expense_versions
       (id, expense_id, version_no, author_member_id, description, expense_date, currency,
        amount, split_type, split_params, fx)
     VALUES ($1, $2, 1, $3, 'Bill', '2026-10-01', $4, $5, 'exact', '{"kind":"exact"}'::jsonb, $6::jsonb)`,
    [
      versionId,
      expenseId,
      author,
      bill.currency,
      bill.amount.toString(),
      bill.fx === undefined || bill.fx === null ? null : JSON.stringify(bill.fx),
    ],
  );
  for (const [member, paid] of Object.entries(bill.payers)) {
    await client.query(
      `INSERT INTO expense_payers (id, expense_version_id, member_id, amount) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), versionId, member, paid.toString()],
    );
  }
  for (const [member, owed] of Object.entries(bill.shares)) {
    await client.query(
      `INSERT INTO expense_shares (id, expense_version_id, member_id, amount) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), versionId, member, owed.toString()],
    );
  }
  await client.query(`UPDATE expenses SET current_version_id = $1 WHERE id = $2`, [
    versionId,
    expenseId,
  ]);
  await client.query('COMMIT');
  return {
    versionId,
    snapshot: {
      id: versionId,
      currency: bill.currency,
      amount: bill.amount,
      payers: bill.payers,
      shares: bill.shares,
      date: '2026-10-01',
      deletedAt: null,
      fx: (bill.fx ?? null) as ExpenseSnapshot['fx'],
    },
  };
}

const rate = (from: string, to: string, num: string, den: string) => ({
  num,
  den,
  from,
  to,
  ts: '2026-10-01T00:00:00.000Z',
  source: 'manual',
});

async function setConvert(groupId: string, on: boolean): Promise<void> {
  // As the superuser, the way the migration's own refresh runs; the RPC is
  // tested separately below.
  await client.query(`UPDATE groups SET convert_to_group_currency = $1 WHERE id = $2`, [
    on,
    groupId,
  ]);
  await client.query(`SELECT waves_refresh_group_balances($1)`, [groupId]);
}

describe('SQL and core convert identically', () => {
  it('agree on every currency exponent core knows', async () => {
    const codes = [...Object.keys(KNOWN_MINOR_UNIT_EXPONENTS), 'THB', 'BRL', 'XTS', 'ZAR'];
    const { rows } = await client.query<{ code: string; exp: number }>(
      `SELECT c AS code, waves_currency_exponent(c) AS exp FROM unnest($1::text[]) AS c`,
      [codes],
    );
    for (const row of rows) expect(row.exp, row.code).toBe(minorUnitExponent(row.code));
  });

  it('agree on which stored rates are usable', async () => {
    // [fx, bill currency, group currency, usable?]
    const cases: [unknown, string, string, boolean][] = [
      [rate('VND', 'INR', '34', '10000'), 'VND', 'INR', true],
      [rate('USD', 'INR', '8350', '100'), 'USD', 'INR', true],
      [rate('VND', 'INR', '0', '1'), 'VND', 'INR', false],
      [rate('VND', 'INR', '1', '0'), 'VND', 'INR', false],
      [rate('VND', 'INR', '1.5', '2'), 'VND', 'INR', false],
      [rate('VND', 'INR', '-1', '2'), 'VND', 'INR', false],
      [rate('VND', 'VND', '1', '2'), 'VND', 'INR', false],
      [rate('EUR', 'INR', '1', '2'), 'VND', 'INR', false],
      [rate('VND', 'inr', '1', '2'), 'VND', 'INR', false],
      [{ ...rate('VND', 'INR', '1', '2'), num: 3 }, 'VND', 'INR', false],
      [{ from: 'VND', to: 'INR', num: '1' }, 'VND', 'INR', false],
      [[], 'VND', 'INR', false],
      ['text', 'VND', 'INR', false],
      [rate('VND', 'INR', '007', '10'), 'VND', 'INR', true],
      // A rate into some currency other than the group's is never used: the
      // bill would land in a bucket the group does not settle in.
      [rate('VND', 'USD', '4', '100000'), 'VND', 'INR', false],
      [rate('VND', 'INR', '34', '10000'), 'VND', 'USD', false],
      [rate('EUR', 'USD', '108', '100'), 'EUR', 'INR', false],
      [rate('EUR', 'USD', '108', '100'), 'EUR', 'USD', true],
      // A bill already in the group currency never converts, whatever it carries.
      [rate('INR', 'USD', '1', '83'), 'INR', 'INR', false],
      [rate('VND', 'INR', '34', '10000'), 'VND', 'inr', false],
      [rate('VND', 'INR', '34', '10000'), 'VND', 'VND', false],
    ];
    for (const [fx, currency, groupCurrency, expected] of cases) {
      const label = `${JSON.stringify(fx)} ${currency}→${groupCurrency}`;
      const { rows } = await client.query<{ ok: boolean }>(
        `SELECT waves_fx_usable($1::jsonb, $2, $3) AS ok`,
        [JSON.stringify(fx), currency, groupCurrency],
      );
      expect(rows[0]?.ok, label).toBe(expected);
      expect(usableFx(fx, currency, groupCurrency) !== null, label).toBe(expected);
    }
    const { rows } = await client.query(`SELECT waves_fx_usable(NULL, 'VND', 'INR') AS ok`);
    expect(rows[0]?.ok).toBe(false);
  });

  it('leaves a bill whose rate is into another currency in its own currency', async () => {
    const { groupId, memberIds } = await seedGroup(client, { memberCount: 2 });
    const [a, b] = memberIds as [string, string];
    await setConvert(groupId, true);
    const bill = await writeBill(groupId, {
      currency: 'VND',
      amount: 1_000_000n,
      payers: { [a]: 1_000_000n },
      shares: { [a]: 500_000n, [b]: 500_000n },
      // VND→USD in an INR group: not the group's rate, so no conversion.
      fx: rate('VND', 'USD', '4', '100000'),
    });
    const { rows } = await client.query(
      `SELECT DISTINCT currency FROM waves_group_expense_lines($1)`,
      [groupId],
    );
    expect(rows.map((row) => String(row.currency).trim())).toEqual(['VND']);
    expect(toSettleExpense(bill.snapshot, 'INR')).toBe(bill.snapshot);
  });

  it('produce the same lines, balances and pairwise edges on random fx ledgers', async () => {
    const CURRENCIES = ['VND', 'USD', 'JPY', 'KWD', 'EUR', 'INR'];
    const LEDGERS = 150;

    for (let run = 0; run < LEDGERS; run += 1) {
      const random = mulberry32(0x5e771e + run);
      const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
      const bigBelow = (max: number): bigint => BigInt(Math.floor(random() * max));

      const memberCount = 2 + Math.floor(random() * 5);
      const { groupId, memberIds } = await seedGroup(client, { memberCount });
      const converts = run % 4 !== 3; // every fourth ledger stays per-currency
      // Every fifth ledger is a USD group: its INR-bound rates (most of them)
      // are into the wrong currency and must not convert, on either side.
      const groupCurrency = run % 5 === 2 ? 'USD' : 'INR';
      if (groupCurrency !== 'INR') {
        await client.query(`UPDATE groups SET default_currency = $1 WHERE id = $2`, [
          groupCurrency,
          groupId,
        ]);
      }
      await setConvert(groupId, converts);

      const bills: WrittenBill[] = [];
      const billCount = 1 + Math.floor(random() * 7);
      for (let index = 0; index < billCount; index += 1) {
        const currency = pick(CURRENCIES);
        const amount = random() < 0.05 ? 0n : 1n + bigBelow(random() < 0.3 ? 1e10 : 5e6);
        const participants = memberIds.filter(() => random() < 0.7);
        if (participants.length === 0) participants.push(memberIds[0] as string);
        const payersList = memberIds.filter(() => random() < 0.4);
        if (payersList.length === 0) payersList.push(pick(memberIds));

        const shares = Object.fromEntries(
          computeShares({
            amount,
            currency,
            params: { kind: 'equal' },
            participants,
            seed: `${run}:${index}`,
          }),
        );
        // Uneven payers, so remainders differ member to member.
        const payers: Record<string, bigint> = {};
        let left = amount;
        payersList.forEach((member, position) => {
          const part = position === payersList.length - 1 ? left : (left * bigBelow(100)) / 100n;
          payers[member] = part;
          left -= part;
        });

        const roll = random();
        // Mostly a rate into INR, some into USD (EUR for a USD bill). Only a
        // rate into the group's own currency converts; the rest stay put.
        const fx =
          currency === 'INR' || roll < 0.15
            ? null
            : roll < 0.3
              ? rate(
                  currency,
                  currency === 'USD' ? 'EUR' : 'USD',
                  String(1n + bigBelow(1e9)),
                  String(1n + bigBelow(1e9)),
                )
              : rate(currency, 'INR', String(1n + bigBelow(1e9)), String(1n + bigBelow(1e9)));
        bills.push(await writeBill(groupId, { currency, amount, payers, shares, fx }));
      }

      const settlements: SettlementSnapshot[] = [];
      for (let index = 0; index < Math.floor(random() * 4); index += 1) {
        const from = pick(memberIds);
        const to = memberIds.find((member) => member !== from) as string;
        const currency = pick(['INR', 'VND', 'USD']);
        const amount = 1n + bigBelow(500_000);
        const status = random() < 0.7 ? 'confirmed' : 'initiated';
        const id = randomUUID();
        await client.query(
          `INSERT INTO settlements (id, group_id, from_member_id, to_member_id, currency, amount, method, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'cash', $7)`,
          [id, groupId, from, to, currency, amount.toString(), status],
        );
        settlements.push({
          id,
          from,
          to,
          currency,
          amount,
          status: status as SettlementStatus,
          at: '2026-10-02T00:00:00Z',
        });
      }

      const label = `ledger ${run} (convert=${converts}, ${groupCurrency})`;

      // 1. Per-bill lines.
      const { rows: lineRows } = await client.query(
        `SELECT expense_version_id, member_id, currency, paid, owed
           FROM waves_group_expense_lines($1)`,
        [groupId],
      );
      const sqlLines = lineRows
        .map(
          (row) =>
            `${row.expense_version_id} ${row.member_id} ${String(row.currency).trim()} ${big(row.paid)} ${big(row.owed)}`,
        )
        .sort();
      const coreLines: string[] = [];
      for (const bill of bills) {
        const settled = converts ? toSettleExpense(bill.snapshot, groupCurrency) : bill.snapshot;
        const members = new Set([...Object.keys(settled.payers), ...Object.keys(settled.shares)]);
        for (const member of members) {
          coreLines.push(
            `${bill.versionId} ${member} ${settled.currency} ${settled.payers[member] ?? 0n} ${settled.shares[member] ?? 0n}`,
          );
        }
      }
      expect(sqlLines, label).toEqual(coreLines.sort());

      // 2. Net balances: the stored projection, the truth, and core.
      const snapshots = toLedgerSnapshots(
        bills.map((bill) => bill.snapshot),
        { default_currency: groupCurrency, convert_to_group_currency: converts },
      );
      const net = computeNetBalances(snapshots, settlements);
      const coreNet: string[] = [];
      for (const [currency, perMember] of net) {
        let total = 0n;
        for (const [member, value] of perMember) {
          total += value;
          if (value !== 0n) coreNet.push(`${currency} ${member} ${value}`);
        }
        expect(total, label).toBe(0n);
      }
      const { rows: stored } = await client.query(
        `SELECT member_id, currency, balance FROM group_balances WHERE group_id = $1`,
        [groupId],
      );
      expect(
        stored
          .map((row) => `${String(row.currency).trim()} ${row.member_id} ${big(row.balance)}`)
          .sort(),
        label,
      ).toEqual(coreNet.sort());

      // 3. Pairwise edges.
      const edges = computePairwiseBalances(snapshots, settlements);
      const { rows: pairRows } = await client.query(
        `SELECT from_member_id, to_member_id, currency, amount FROM pairwise_balances WHERE group_id = $1`,
        [groupId],
      );
      expect(
        pairRows
          .map(
            (row) =>
              `${String(row.currency).trim()} ${row.from_member_id} ${row.to_member_id} ${big(row.amount)}`,
          )
          .sort(),
        label,
      ).toEqual(edges.map((e) => `${e.currency} ${e.from} ${e.to} ${e.amount}`).sort());
    }
  });

  it('lets a confirmed settlement pay pairwise debt down, not up', async () => {
    // Regression for the baseline sign error in `waves_group_pairwise_truth`:
    // b owes a ₹50, b pays it, and the stored edge used to read "b owes a ₹100".
    const { groupId, memberIds } = await seedGroup(client, { memberCount: 2 });
    const [a, b] = memberIds as [string, string];
    await writeBill(groupId, {
      currency: 'INR',
      amount: 10_000n,
      payers: { [a]: 10_000n },
      shares: { [a]: 5_000n, [b]: 5_000n },
    });
    await client.query(
      `INSERT INTO settlements (id, group_id, from_member_id, to_member_id, currency, amount, method, status)
       VALUES ($1, $2, $3, $4, 'INR', 3000, 'cash', 'confirmed')`,
      [randomUUID(), groupId, b, a],
    );
    const { rows } = await client.query(
      `SELECT from_member_id, to_member_id, amount FROM pairwise_balances WHERE group_id = $1`,
      [groupId],
    );
    expect(rows.map((r) => `${r.from_member_id}->${r.to_member_id}:${r.amount}`)).toEqual([
      `${b}->${a}:2000`,
    ]);
  });

  it('works the hand-computed ₫ dinner the core scenario works', async () => {
    const { groupId, memberIds } = await seedGroup(client, { memberCount: 3 });
    const [a, b, c] = memberIds as [string, string, string];
    await setConvert(groupId, true);
    await writeBill(groupId, {
      currency: 'VND',
      amount: 1_234_567n,
      payers: { [a]: 1_234_567n },
      shares: { [a]: 411_523n, [b]: 411_522n, [c]: 411_522n },
      fx: rate('VND', 'INR', '34', '10000'),
    });
    const { rows } = await client.query(
      `SELECT member_id, paid, owed, currency FROM waves_group_expense_lines($1)`,
      [groupId],
    );
    const owed = new Map(rows.map((row) => [String(row.member_id), big(row.owed)]));
    expect(rows.every((row) => String(row.currency) === 'INR')).toBe(true);
    expect(rows.reduce((sum, row) => sum + big(row.paid), 0n)).toBe(419_753n);
    expect(owed.get(a)).toBe(139_918n);
    // b and c tie on remainder: the smaller uuid takes the extra paisa.
    const [low, high] = [b, c].sort();
    expect(owed.get(low as string)).toBe(139_918n);
    expect(owed.get(high as string)).toBe(139_917n);
  });
});

describe('opting a group in', () => {
  it('starts every new group converting, and leaves seeded old ones alone', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 1 });
    const old = await client.query(
      `SELECT convert_to_group_currency AS c FROM groups WHERE id = $1`,
      [groupId],
    );
    expect(old.rows[0]?.c).toBe(false);

    const created = await asUser(profileIds[0]!, () =>
      client.query(
        `SELECT waves_create_group('Hanoi', 'trip', 'INR', NULL, true, NULL, NULL) AS id`,
      ),
    );
    const { rows } = await client.query(
      `SELECT convert_to_group_currency AS c FROM groups WHERE id = $1`,
      [created.rows[0]?.id],
    );
    expect(rows[0]?.c).toBe(true);
  });

  it('reports what is missing, and refuses to switch on until it is fixed', async () => {
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 2 });
    const [a, b] = memberIds as [string, string];
    const admin = profileIds[0]!;
    await writeBill(groupId, {
      currency: 'VND',
      amount: 200_000n,
      payers: { [a]: 200_000n },
      shares: { [a]: 100_000n, [b]: 100_000n },
    });
    await writeBill(groupId, {
      currency: 'USD',
      amount: 1_000n,
      payers: { [b]: 1_000n },
      shares: { [a]: 500n, [b]: 500n },
      fx: rate('USD', 'INR', '8350', '100'),
    });
    await client.query(
      `INSERT INTO settlements (id, group_id, from_member_id, to_member_id, currency, amount, method, status)
       VALUES ($1, $2, $3, $4, 'EUR', 100, 'cash', 'initiated')`,
      [randomUUID(), groupId, b, a],
    );

    const readiness = await asUser(admin, () =>
      client.query(`SELECT * FROM waves_group_currency_readiness($1)`, [groupId]),
    );
    expect(
      readiness.rows.map((r) => `${r.currency} ${r.missing_rates} ${r.foreign_settlements}`),
    ).toEqual(['EUR 0 1', 'VND 1 0']);

    const message = await expectDenied(
      asUser(admin, () => client.query(`SELECT waves_set_group_convert($1, true)`, [groupId])),
    );
    expect(message).toMatch(/NOT_READY/);
  });

  it('switches on when ready, refreshing balances into the group currency', async () => {
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 2 });
    const [a, b] = memberIds as [string, string];
    await writeBill(groupId, {
      currency: 'USD',
      amount: 1_000n,
      payers: { [a]: 1_000n },
      shares: { [a]: 500n, [b]: 500n },
      fx: rate('USD', 'INR', '8350', '100'),
    });
    const before = await client.query(`SELECT currency FROM group_balances WHERE group_id = $1`, [
      groupId,
    ]);
    expect(before.rows.every((row) => String(row.currency) === 'USD')).toBe(true);

    // An ordinary member may not; an admin may.
    expect(
      await expectDenied(
        asUser(profileIds[1]!, () =>
          client.query(`SELECT waves_set_group_convert($1, true)`, [groupId]),
        ),
      ),
    ).toMatch(/NOT_AN_ADMIN/);
    await asUser(profileIds[0]!, () =>
      client.query(`SELECT waves_set_group_convert($1, true)`, [groupId]),
    );

    const { rows } = await client.query(
      `SELECT member_id, currency, balance FROM group_balances WHERE group_id = $1`,
      [groupId],
    );
    // $5.00 at 83.50 = ₹417.50 each way.
    expect(
      Object.fromEntries(rows.map((row) => [`${row.member_id}`, `${row.currency} ${row.balance}`])),
    ).toEqual({ [a]: 'INR 41750', [b]: 'INR -41750' });

    // A settlement now exists, so it cannot be switched back off.
    await client.query(
      `INSERT INTO settlements (id, group_id, from_member_id, to_member_id, currency, amount, method, status)
       VALUES ($1, $2, $3, $4, 'INR', 41750, 'cash', 'confirmed')`,
      [randomUUID(), groupId, b, a],
    );
    expect(
      await expectDenied(
        asUser(profileIds[0]!, () =>
          client.query(`SELECT waves_set_group_convert($1, false)`, [groupId]),
        ),
      ),
    ).toMatch(/CONVERT_LOCKED/);
    expect(
      (
        await client.query(`SELECT count(*)::int AS n FROM group_balances WHERE group_id = $1`, [
          groupId,
        ])
      ).rows[0]?.n,
    ).toBe(0);
  });

  it('cannot be flipped by a direct write', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 1 });
    const message = await expectDenied(
      asUser(profileIds[0]!, () =>
        client.query(`UPDATE groups SET convert_to_group_currency = true WHERE id = $1`, [groupId]),
      ),
    );
    expect(message).toMatch(/FORBIDDEN_COLUMN.*convert_to_group_currency/);
  });
});

describe('settling in a converting group', () => {
  it('refuses a settlement in another currency with the update-the-app code', async () => {
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 2 });
    const [a, b] = memberIds as [string, string];
    await setConvert(groupId, true);
    const message = await expectDenied(
      asUser(profileIds[1]!, () =>
        client.query(`SELECT waves_record_settlement($1, $2, $3, 1000, 'cash', 'VND')`, [
          groupId,
          b,
          a,
        ]),
      ),
    );
    expect(message).toMatch(/UPDATE_APP_TO_SETTLE/);

    await asUser(profileIds[1]!, () =>
      client.query(`SELECT waves_record_settlement($1, $2, $3, 1000, 'cash', 'INR')`, [
        groupId,
        b,
        a,
      ]),
    );
    await asUser(profileIds[1]!, () =>
      client.query(`SELECT waves_record_settlement($1, $2, $3, 1000, 'cash')`, [groupId, b, a]),
    );
  });

  it('still takes any currency in a group that has not opted in', async () => {
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 2 });
    const [a, b] = memberIds as [string, string];
    await asUser(profileIds[1]!, () =>
      client.query(`SELECT waves_record_settlement($1, $2, $3, 1000, 'cash', 'VND')`, [
        groupId,
        b,
        a,
      ]),
    );
  });
});

describe('a group currency is frozen once the ledger has anything in it', () => {
  const patchCurrency = (profileId: string, groupId: string, currency: string) =>
    asUser(profileId, () =>
      client.query(`UPDATE groups SET default_currency = $1 WHERE id = $2`, [currency, groupId]),
    );

  it('lets an empty group change it', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 1 });
    await patchCurrency(profileIds[0]!, groupId, 'EUR');
  });

  it('refuses once there is a bill, a trip rate or a settlement — for every writer', async () => {
    const withBill = await seedGroup(client, { memberCount: 2 });
    await writeBill(withBill.groupId, {
      currency: 'INR',
      amount: 100n,
      payers: { [withBill.memberIds[0]!]: 100n },
      shares: { [withBill.memberIds[1]!]: 100n },
    });
    expect(
      await expectDenied(patchCurrency(withBill.profileIds[0]!, withBill.groupId, 'EUR')),
    ).toMatch(/CURRENCY_LOCKED/);
    // The superuser (and so the service role) is refused too.
    expect(
      await expectDenied(
        client.query(`UPDATE groups SET default_currency = 'EUR' WHERE id = $1`, [
          withBill.groupId,
        ]),
      ),
    ).toMatch(/CURRENCY_LOCKED/);

    const withRate = await seedGroup(client, { memberCount: 1 });
    await asUser(withRate.profileIds[0]!, () =>
      client.query(`SELECT waves_set_group_fx_rate($1, 'USD', 8350, 100)`, [withRate.groupId]),
    );
    expect(
      await expectDenied(patchCurrency(withRate.profileIds[0]!, withRate.groupId, 'EUR')),
    ).toMatch(/CURRENCY_LOCKED/);

    const withSettlement = await seedGroup(client, { memberCount: 2 });
    await client.query(
      `INSERT INTO settlements (id, group_id, from_member_id, to_member_id, currency, amount, method, status)
       VALUES ($1, $2, $3, $4, 'INR', 100, 'cash', 'cancelled')`,
      [
        randomUUID(),
        withSettlement.groupId,
        withSettlement.memberIds[0],
        withSettlement.memberIds[1],
      ],
    );
    expect(
      await expectDenied(
        patchCurrency(withSettlement.profileIds[0]!, withSettlement.groupId, 'EUR'),
      ),
    ).toMatch(/CURRENCY_LOCKED/);
  });
});

describe('the new RPCs’ callers', () => {
  it('are refused signed-out', async () => {
    const { groupId } = await seedGroup(client, { memberCount: 1 });
    for (const sql of [
      `SELECT * FROM waves_group_currency_readiness($1)`,
      `SELECT waves_set_group_convert($1, true)`,
      `SELECT * FROM waves_group_expense_lines($1)`,
      `SELECT * FROM waves_group_movements($1)`,
    ]) {
      expect(await expectDenied(asUser(null, () => client.query(sql, [groupId])))).toMatch(
        /permission denied/,
      );
    }
  });

  it('refuse somebody outside the group', async () => {
    const { groupId } = await seedGroup(client, { memberCount: 1 });
    const outsider = await seedGroup(client, { memberCount: 1 });
    expect(
      await expectDenied(
        asUser(outsider.profileIds[0]!, () =>
          client.query(`SELECT * FROM waves_group_currency_readiness($1)`, [groupId]),
        ),
      ),
    ).toMatch(/NOT_A_MEMBER/);
    expect(
      await expectDenied(
        asUser(outsider.profileIds[0]!, () =>
          client.query(`SELECT waves_set_group_convert($1, true)`, [groupId]),
        ),
      ),
    ).toMatch(/NOT_AN_ADMIN/);
  });
});
