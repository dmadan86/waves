/**
 * ADR-004 / ADR-014: balances are derived, and they always sum to zero.
 * The Postgres derived tables are tested against these same rules in
 * packages/db, so client and server can never disagree.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  balanceSums,
  computeNetBalances,
  computePairwiseBalances,
  netFromPairwise,
} from '../src/balances/balances.js';
import { toSettleExpense, toSettleExpenses, usableFx } from '../src/balances/convert.js';
import { SettlementStatus } from '../src/balances/types.js';
import type { ExpenseSnapshot, NetBalances, SettlementSnapshot } from '../src/balances/types.js';
import { minorUnitExponent } from '../src/money/currency.js';
import { convertWithRecord } from '../src/money/fx.js';
import { money } from '../src/money/money.js';
import { simplify } from '../src/simplify/simplify.js';
import { computeShares } from '../src/split/computeShares.js';
import type { MemberId } from '../src/split/types.js';
import {
  amounts,
  FX_FROM,
  FX_TO,
  fxRecords,
  memberIds,
  positiveAmounts,
  unusableFx,
  type FxRecordDraw,
} from './arbitraries.js';

const INR = 'INR';

/** A group of expenses whose payers and shares are internally consistent. */
const groupLedger = fc
  .record({
    members: memberIds(2, 6),
    expenseCount: fc.integer({ min: 0, max: 12 }),
    settlementCount: fc.integer({ min: 0, max: 5 }),
  })
  .chain(({ members, expenseCount, settlementCount }) =>
    fc.record({
      members: fc.constant(members),
      expenses: fc.array(
        fc.record({
          amount: positiveAmounts(500_000n),
          payerCount: fc.integer({ min: 1, max: members.length }),
          payerOffset: fc.integer({ min: 0, max: members.length - 1 }),
          participantCount: fc.integer({ min: 1, max: members.length }),
          participantOffset: fc.integer({ min: 0, max: members.length - 1 }),
          day: fc.integer({ min: 1, max: 28 }),
          deleted: fc.boolean(),
        }),
        { minLength: expenseCount, maxLength: expenseCount },
      ),
      settlements: fc.array(
        fc.record({
          amount: positiveAmounts(200_000n),
          fromIndex: fc.integer({ min: 0, max: members.length - 1 }),
          toOffset: fc.integer({ min: 1, max: Math.max(1, members.length - 1) }),
          status: fc.constantFrom(
            SettlementStatus.Initiated,
            SettlementStatus.Confirmed,
            SettlementStatus.AutoConfirmed,
            SettlementStatus.Cancelled,
          ),
        }),
        { minLength: settlementCount, maxLength: settlementCount },
      ),
    }),
  )
  .map(({ members, expenses, settlements }) => {
    const built: ExpenseSnapshot[] = expenses.map((draw, index) => {
      const participants: MemberId[] = [];
      for (let step = 0; step < draw.participantCount; step += 1) {
        participants.push(members[(draw.participantOffset + step) % members.length] as MemberId);
      }
      const uniqueParticipants = [...new Set(participants)];
      const id = `exp-${index}`;
      const shareMap = computeShares({
        amount: draw.amount,
        currency: INR,
        params: { kind: 'equal' },
        participants: uniqueParticipants,
        seed: id,
      });

      // Split what was actually paid across `payerCount` members.
      const payerList: MemberId[] = [];
      for (let step = 0; step < draw.payerCount; step += 1) {
        payerList.push(members[(draw.payerOffset + step) % members.length] as MemberId);
      }
      const uniquePayers = [...new Set(payerList)];
      const paidMap = computeShares({
        amount: draw.amount,
        currency: INR,
        params: { kind: 'equal' },
        participants: uniquePayers,
        seed: `${id}:payers`,
      });

      return {
        id,
        currency: INR,
        amount: draw.amount,
        payers: Object.fromEntries(paidMap),
        shares: Object.fromEntries(shareMap),
        date: `2026-03-${String(draw.day).padStart(2, '0')}`,
        deletedAt: draw.deleted ? '2026-04-01T00:00:00Z' : null,
      } satisfies ExpenseSnapshot;
    });

    const builtSettlements: SettlementSnapshot[] = settlements.map((draw, index) => {
      const from = members[draw.fromIndex] as MemberId;
      const to = members[(draw.fromIndex + draw.toOffset) % members.length] as MemberId;
      return {
        id: `set-${index}`,
        from,
        to,
        currency: INR,
        amount: draw.amount,
        status: draw.status,
        at: `2026-04-0${(index % 9) + 1}T10:00:00Z`,
      } satisfies SettlementSnapshot;
    });

    return { members, expenses: built, settlements: builtSettlements };
  });

describe('derived balances', () => {
  it('always sum to zero per currency', () => {
    fc.assert(
      fc.property(groupLedger, ({ expenses, settlements }) => {
        const balances = computeNetBalances(expenses, settlements);
        for (const total of balanceSums(balances).values()) {
          expect(total).toBe(0n);
        }
      }),
    );
  });

  it('sum to zero with pending settlements included too', () => {
    fc.assert(
      fc.property(groupLedger, ({ expenses, settlements }) => {
        const balances = computeNetBalances(expenses, settlements, { includePending: true });
        for (const total of balanceSums(balances).values()) {
          expect(total).toBe(0n);
        }
      }),
    );
  });

  it('reconcile exactly with the pairwise ledger', () => {
    fc.assert(
      fc.property(groupLedger, ({ members, expenses, settlements }) => {
        const net = computeNetBalances(expenses, settlements);
        const pairwise = computePairwiseBalances(expenses, settlements);
        const impliedNet = netFromPairwise(pairwise);
        for (const member of members) {
          expect(impliedNet.get(INR)?.get(member) ?? 0n).toBe(net.get(INR)?.get(member) ?? 0n);
        }
      }),
    );
  });

  it('ignores soft-deleted expenses but keeps them restorable data', () => {
    const live: ExpenseSnapshot = {
      id: 'e1',
      currency: INR,
      amount: 10000n,
      payers: { asha: 10000n },
      shares: { asha: 5000n, ravi: 5000n },
      date: '2026-03-01',
      deletedAt: null,
    };
    const deleted: ExpenseSnapshot = { ...live, id: 'e2', deletedAt: '2026-03-02T00:00:00Z' };

    const balances = computeNetBalances([live, deleted], []);
    expect(balances.get(INR)?.get('asha')).toBe(5000n);
    expect(balances.get(INR)?.get('ravi')).toBe(-5000n);
  });

  it('counts confirmed settlements and excludes pending ones from the headline', () => {
    const expense: ExpenseSnapshot = {
      id: 'e1',
      currency: INR,
      amount: 10000n,
      payers: { asha: 10000n },
      shares: { asha: 5000n, ravi: 5000n },
      date: '2026-03-01',
    };
    const pending: SettlementSnapshot = {
      id: 's1',
      from: 'ravi',
      to: 'asha',
      currency: INR,
      amount: 5000n,
      status: SettlementStatus.Initiated,
      at: '2026-03-02T00:00:00Z',
    };

    expect(computeNetBalances([expense], [pending]).get(INR)?.get('ravi')).toBe(-5000n);
    expect(
      computeNetBalances([expense], [pending], { includePending: true }).get(INR)?.get('ravi'),
    ).toBe(0n);
    expect(
      computeNetBalances([expense], [{ ...pending, status: SettlementStatus.Confirmed }])
        .get(INR)
        ?.get('ravi'),
    ).toBe(0n);
  });
});

// ─────────────────────────── a group that settles in its own currency ──
//
// ADR-003 amendment: a foreign bill with a stored rate counts in the group's
// currency, its payers and shares apportioned over the converted total by
// largest remainder. Everything ADR-004 promised above has to survive that.

/** The scaled rational `toSettleExpense` multiplies by: n / d minor units. */
function scaledRate(from: string, fx: FxRecordDraw): { n: bigint; d: bigint } {
  const delta = minorUnitExponent(fx.to) - minorUnitExponent(from);
  return {
    n: BigInt(fx.num) * (delta > 0 ? 10n ** BigInt(delta) : 1n),
    d: BigInt(fx.den) * (delta < 0 ? 10n ** BigInt(-delta) : 1n),
  };
}

const sumOf = (record: Readonly<Record<string, bigint>>): bigint =>
  Object.values(record).reduce((total, value) => total + value, 0n);

interface FxLedger {
  /** The group's currency: the only `to` a rate may convert into. */
  groupCurrency: string;
  members: MemberId[];
  expenses: ExpenseSnapshot[];
  settlements: SettlementSnapshot[];
}

const fxLedger: fc.Arbitrary<FxLedger> = fc
  .record({
    groupCurrency: fc.constantFrom<string>(...FX_TO),
    members: memberIds(2, 6),
    expenseCount: fc.integer({ min: 0, max: 10 }),
    settlementCount: fc.integer({ min: 0, max: 4 }),
  })
  .chain(({ groupCurrency, members, expenseCount, settlementCount }) =>
    fc.record({
      groupCurrency: fc.constant(groupCurrency),
      members: fc.constant(members),
      expenses: fc.array(
        fc.constantFrom(...FX_FROM).chain((currency) =>
          fc.record({
            currency: fc.constant(currency),
            amount: amounts(5_000_000n),
            payerCount: fc.integer({ min: 1, max: members.length }),
            payerOffset: fc.integer({ min: 0, max: members.length - 1 }),
            participantCount: fc.integer({ min: 1, max: members.length }),
            participantOffset: fc.integer({ min: 0, max: members.length - 1 }),
            exactWeights: fc.option(
              fc.array(fc.integer({ min: 0, max: 50 }), {
                minLength: members.length,
                maxLength: members.length,
              }),
            ),
            fx:
              currency === groupCurrency
                ? fc.oneof(
                    { arbitrary: fxRecords(currency) as fc.Arbitrary<unknown>, weight: 1 },
                    { arbitrary: unusableFx(currency), weight: 1 },
                  )
                : fc.oneof(
                    {
                      arbitrary: fxRecords(currency, groupCurrency) as fc.Arbitrary<unknown>,
                      weight: 4,
                    },
                    // Into some other currency: possibly the group's, mostly not.
                    { arbitrary: fxRecords(currency) as fc.Arbitrary<unknown>, weight: 2 },
                    { arbitrary: unusableFx(currency), weight: 1 },
                  ),
            deleted: fc.boolean(),
          }),
        ),
        { minLength: expenseCount, maxLength: expenseCount },
      ),
      settlements: fc.array(
        fc.record({
          currency: fc.constantFrom<string>(...FX_TO, 'VND'),
          amount: positiveAmounts(200_000n),
          fromIndex: fc.integer({ min: 0, max: members.length - 1 }),
          toOffset: fc.integer({ min: 1, max: Math.max(1, members.length - 1) }),
          status: fc.constantFrom(
            SettlementStatus.Initiated,
            SettlementStatus.Confirmed,
            SettlementStatus.AutoConfirmed,
            SettlementStatus.Cancelled,
          ),
        }),
        { minLength: settlementCount, maxLength: settlementCount },
      ),
    }),
  )
  .map(({ groupCurrency, members, expenses, settlements }) => {
    const rotate = (offset: number, count: number): MemberId[] => {
      const picked: MemberId[] = [];
      for (let step = 0; step < count; step += 1) {
        picked.push(members[(offset + step) % members.length] as MemberId);
      }
      return [...new Set(picked)];
    };

    const built: ExpenseSnapshot[] = expenses.map((draw, index) => {
      const id = `fx-${index}`;
      const participants = rotate(draw.participantOffset, draw.participantCount);
      // An exact split with uneven parts when drawn, so remainders differ per
      // member; otherwise the equal split the app writes most often.
      let shareMap: Map<MemberId, bigint>;
      const weights = draw.exactWeights;
      if (weights && weights.some((weight) => weight > 0)) {
        const totalWeight = BigInt(weights.reduce((sum, weight) => sum + weight, 0));
        const exact: Record<MemberId, bigint> = {};
        let given = 0n;
        members.forEach((member, memberIndex) => {
          const part = (draw.amount * BigInt(weights[memberIndex] ?? 0)) / totalWeight;
          exact[member] = part;
          given += part;
        });
        const first = members[0] as MemberId;
        exact[first] = (exact[first] ?? 0n) + (draw.amount - given);
        shareMap = new Map(Object.entries(exact));
      } else {
        shareMap = computeShares({
          amount: draw.amount,
          currency: draw.currency,
          params: { kind: 'equal' },
          participants,
          seed: id,
        });
      }
      const paidMap = computeShares({
        amount: draw.amount,
        currency: draw.currency,
        params: { kind: 'equal' },
        participants: rotate(draw.payerOffset, draw.payerCount),
        seed: `${id}:payers`,
      });
      return {
        id,
        currency: draw.currency,
        amount: draw.amount,
        payers: Object.fromEntries(paidMap),
        shares: Object.fromEntries(shareMap),
        date: '2026-10-01',
        deletedAt: draw.deleted ? '2026-10-02T00:00:00Z' : null,
        fx: draw.fx as ExpenseSnapshot['fx'],
      } satisfies ExpenseSnapshot;
    });

    const builtSettlements: SettlementSnapshot[] = settlements.map((draw, index) => ({
      id: `fx-set-${index}`,
      from: members[draw.fromIndex] as MemberId,
      to: members[(draw.fromIndex + draw.toOffset) % members.length] as MemberId,
      currency: draw.currency,
      amount: draw.amount,
      status: draw.status,
      at: `2026-10-0${(index % 9) + 1}T10:00:00Z`,
    }));

    return { groupCurrency, members, expenses: built, settlements: builtSettlements };
  });

function netEntries(net: NetBalances): string[] {
  const out: string[] = [];
  for (const [currency, perMember] of net) {
    for (const [member, value] of perMember) {
      if (value !== 0n) out.push(`${currency} ${member} ${value}`);
    }
  }
  return out.sort();
}

describe('a group that settles in its own currency', () => {
  it('converts the total once: Σpayers′ = Σshares′ = convert(amount, fx)', () => {
    fc.assert(
      fc.property(fxLedger, ({ groupCurrency, expenses }) => {
        for (const expense of expenses) {
          const fx = usableFx(expense.fx, expense.currency, groupCurrency);
          const settled = toSettleExpense(expense, groupCurrency);
          if (!fx) continue;
          const expected = convertWithRecord(
            money(expense.amount, expense.currency),
            expense.fx as FxRecordDraw,
          );
          expect(settled.currency).toBe(groupCurrency);
          expect(fx.to).toBe(groupCurrency);
          expect(settled.amount).toBe(expected.minor);
          expect(sumOf(settled.payers)).toBe(expected.minor);
          expect(sumOf(settled.shares)).toBe(expected.minor);
          expect(settled.convertedFrom).toEqual({
            currency: expense.currency,
            amount: expense.amount,
          });
        }
      }),
    );
  });

  it('keeps every member within one minor unit of share × rate', () => {
    fc.assert(
      fc.property(fxLedger, ({ groupCurrency, expenses }) => {
        for (const expense of expenses) {
          if (!usableFx(expense.fx, expense.currency, groupCurrency)) continue;
          const { n, d } = scaledRate(expense.currency, expense.fx as FxRecordDraw);
          const settled = toSettleExpense(expense, groupCurrency);
          for (const side of ['payers', 'shares'] as const) {
            for (const [member, original] of Object.entries(expense[side])) {
              const converted = settled[side][member] ?? 0n;
              // |converted − original·n/d| < 1, in exact integers.
              const gap = converted * d - original * n;
              expect(gap < d && gap > -d).toBe(true);
            }
            expect(Object.keys(settled[side]).sort()).toEqual(Object.keys(expense[side]).sort());
          }
        }
      }),
    );
  });

  it('sums every currency bucket to zero, pending settlements or not', () => {
    fc.assert(
      fc.property(fxLedger, ({ groupCurrency, expenses, settlements }) => {
        const settled = toSettleExpenses(expenses, groupCurrency);
        for (const options of [{}, { includePending: true }]) {
          const net = computeNetBalances(settled, settlements, options);
          for (const total of balanceSums(net).values()) expect(total).toBe(0n);
        }
      }),
    );
  });

  it('does not depend on the order of bills, payers or shares', () => {
    fc.assert(
      fc.property(fxLedger, ({ groupCurrency, expenses, settlements }) => {
        const reversedRecord = (record: Readonly<Record<string, bigint>>) =>
          Object.fromEntries(Object.entries(record).reverse());
        const shuffled = [...expenses].reverse().map((expense) => ({
          ...expense,
          payers: reversedRecord(expense.payers),
          shares: reversedRecord(expense.shares),
        }));
        for (const [index, expense] of expenses.entries()) {
          const twin = shuffled[expenses.length - 1 - index] as ExpenseSnapshot;
          const a = toSettleExpense(expense, groupCurrency);
          const b = toSettleExpense(twin, groupCurrency);
          expect(Object.entries(b.payers).sort()).toEqual(Object.entries(a.payers).sort());
          expect(Object.entries(b.shares).sort()).toEqual(Object.entries(a.shares).sort());
        }
        expect(
          netEntries(computeNetBalances(toSettleExpenses(shuffled, groupCurrency), settlements)),
        ).toEqual(
          netEntries(computeNetBalances(toSettleExpenses(expenses, groupCurrency), settlements)),
        );
      }),
    );
  });

  it('leaves bills without a usable rate exactly as they were', () => {
    fc.assert(
      fc.property(fxLedger, ({ groupCurrency, expenses }) => {
        for (const expense of expenses) {
          if (usableFx(expense.fx, expense.currency, groupCurrency)) continue;
          expect(toSettleExpense(expense, groupCurrency)).toBe(expense);
        }
        // And a group that has not opted in converts nothing at all.
        const untouched = toSettleExpenses(expenses, null);
        untouched.forEach((expense, index) => expect(expense).toBe(expenses[index]));
      }),
    );
  });

  it('never converts on a rate that is not usable', () => {
    fc.assert(
      fc.property(
        fc
          .constantFrom(...FX_FROM)
          .chain((currency) =>
            fc.record({ currency: fc.constant(currency), fx: unusableFx(currency) }),
          ),
        ({ currency, fx }) => {
          for (const groupCurrency of FX_TO) {
            expect(usableFx(fx, currency, groupCurrency)).toBeNull();
          }
        },
      ),
    );
  });

  it('never converts on a rate into a currency other than the group’s', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FX_FROM).chain((currency) =>
          fc.record({
            currency: fc.constant(currency),
            fx: fxRecords(currency),
            groupCurrency: fc.constantFrom<string>(...FX_TO),
            amount: amounts(5_000_000n),
          }),
        ),
        ({ currency, fx, groupCurrency, amount }) => {
          const expense: ExpenseSnapshot = {
            id: 'x',
            currency,
            amount,
            payers: { a: amount },
            shares: { a: amount },
            date: '2026-10-01',
            deletedAt: null,
            fx: fx as ExpenseSnapshot['fx'],
          };
          const settled = toSettleExpense(expense, groupCurrency);
          if (fx.to === groupCurrency && currency !== groupCurrency) {
            expect(settled.currency).toBe(groupCurrency);
          } else {
            // Mismatched `to` (or a bill already in the group currency): untouched,
            // never a bucket in `fx.to`.
            expect(usableFx(fx, currency, groupCurrency)).toBeNull();
            expect(settled).toBe(expense);
          }
        },
      ),
    );
  });

  it('puts every converted bill in the group currency and nowhere else', () => {
    fc.assert(
      fc.property(fxLedger, ({ groupCurrency, expenses }) => {
        const settled = toSettleExpenses(expenses, groupCurrency);
        settled.forEach((bill, index) => {
          const original = expenses[index] as ExpenseSnapshot;
          if (bill.convertedFrom) expect(bill.currency).toBe(groupCurrency);
          else expect(bill.currency).toBe(original.currency);
        });
      }),
    );
  });

  it('reconciles exactly with the pairwise ledger', () => {
    fc.assert(
      fc.property(fxLedger, ({ groupCurrency, expenses, settlements }) => {
        const settled = toSettleExpenses(expenses, groupCurrency);
        const net = computeNetBalances(settled, settlements);
        const implied = netFromPairwise(computePairwiseBalances(settled, settlements));
        expect(netEntries(implied)).toEqual(netEntries(net));
      }),
    );
  });

  it('simplifies without moving anybody’s position', () => {
    fc.assert(
      fc.property(fxLedger, ({ groupCurrency, expenses, settlements }) => {
        const settled = toSettleExpenses(expenses, groupCurrency);
        const net = computeNetBalances(settled, settlements);
        const transfers = simplify(net);
        // Paying every suggested transfer must clear every position exactly.
        expect(netEntries(netFromPairwise(transfers))).toEqual(netEntries(net));
        for (const transfer of transfers) expect(transfer.amount > 0n).toBe(true);
      }),
    );
  });
});
