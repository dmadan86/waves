/**
 * Families inside a group: the `units` split kind and the family lens helpers.
 *
 * The money property is the one that matters: a two-stage split (across
 * families, then inside each) still sums exactly to the bill, every family's
 * subtotal is within one minor unit of its ideal share, and the people inside
 * a family are within one minor unit of each other. The lens helpers only add
 * balances up, and the rollup's Σ must be what it was.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  headOf,
  headsFor,
  unassignedMembers,
  unitBalances,
  unitMembers,
  unitNetBalances,
  unitOf,
  unitsSplitParams,
  validateGroupUnits,
  type GroupUnits,
} from '../src/group/units.js';
import { simplify } from '../src/simplify/simplify.js';
import { computeShares, sumShares } from '../src/split/computeShares.js';
import { SplitError, SplitErrorCode, type MemberId, type UnitsParams } from '../src/split/types.js';
import { parseSplitParams, serialiseSplitParams, SplitWireError } from '../src/split/wire.js';
import type { NetBalances } from '../src/balances/types.js';

import { memberIds, seeds } from './arbitraries.js';

const INR = 'INR';

/** A random partition of `members` into 1..n units, each with a weight (two decimals). */
const partitions = (members: readonly MemberId[]) =>
  fc
    .tuple(
      fc.array(fc.integer({ min: 0, max: Math.max(0, members.length - 1) }), {
        minLength: members.length,
        maxLength: members.length,
      }),
      fc.array(fc.integer({ min: 0, max: 100_000 }), {
        minLength: members.length,
        maxLength: members.length,
      }),
    )
    .map(([slots, rawWeights]) => {
      const units: Record<string, MemberId[]> = {};
      members.forEach((member, index) => {
        const key = `u${slots[index] ?? 0}`;
        (units[key] ??= []).push(member);
      });
      const unitIds = Object.keys(units);
      const weights: Record<string, number> = {};
      unitIds.forEach((unitId, index) => {
        weights[unitId] = (rawWeights[index] ?? 0) / 100;
      });
      if (unitIds.every((unitId) => weights[unitId] === 0)) weights[unitIds[0] as string] = 1;
      return { units, weights };
    });

function expectSplitError(run: () => unknown, code: SplitErrorCode): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SplitError);
    expect((error as SplitError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe('units split', () => {
  it('sums exactly, keeps each family within a minor unit of ideal, and members within one of each other', () => {
    fc.assert(
      fc.property(
        memberIds(1, 20).chain((members) =>
          fc.tuple(
            fc.constant(members),
            partitions(members),
            fc.bigInt({ min: 0n, max: 10n ** 12n }),
            seeds(),
          ),
        ),
        ([members, { units, weights }, amount, seed]) => {
          const params: UnitsParams = { kind: 'units', units, weights };
          const shares = computeShares({
            amount,
            currency: INR,
            params,
            participants: members,
            seed,
          });
          expect(sumShares(shares)).toBe(amount);
          expect(shares.size).toBe(members.length);

          const centi = (w: number): bigint => BigInt(Math.round(w * 100));
          const totalWeight = Object.values(weights).reduce((sum, w) => sum + centi(w), 0n);
          for (const [unitId, unitMembers] of Object.entries(units)) {
            const subtotal = unitMembers.reduce((sum, m) => sum + (shares.get(m) ?? 0n), 0n);
            const ideal = (amount * centi(weights[unitId] ?? 1)) / totalWeight;
            const spread = subtotal - ideal;
            expect(spread >= -1n && spread <= 1n).toBe(true);
            if (centi(weights[unitId] ?? 1) === 0n) expect(subtotal).toBe(0n);
            const inside = unitMembers.map((m) => shares.get(m) ?? 0n);
            const max = inside.reduce((a, b) => (a > b ? a : b));
            const min = inside.reduce((a, b) => (a < b ? a : b));
            expect(max - min <= 1n).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('is deterministic whatever the order of participants or unit keys', () => {
    fc.assert(
      fc.property(
        memberIds(2, 10).chain((members) =>
          fc.tuple(
            fc.constant(members),
            partitions(members),
            fc.bigInt({ min: 0n, max: 10n ** 9n }),
          ),
        ),
        ([members, { units, weights }, amount]) => {
          const params: UnitsParams = { kind: 'units', units, weights };
          const reversedUnits = Object.fromEntries(Object.entries(units).reverse());
          const a = computeShares({
            amount,
            currency: INR,
            params,
            participants: members,
            seed: 'x',
          });
          const b = computeShares({
            amount,
            currency: INR,
            params: { kind: 'units', units: reversedUnits, weights },
            participants: [...members].reverse(),
            seed: 'x',
          });
          expect([...a].sort()).toEqual([...b].sort());
        },
      ),
    );
  });

  it('gives a family of three one share, not three', () => {
    const shares = computeShares({
      amount: 3000n,
      currency: INR,
      params: { kind: 'units', units: { sharma: ['a', 'b', 'c'], patel: ['d', 'e'], f: ['f'] } },
      participants: ['a', 'b', 'c', 'd', 'e', 'f'],
      seed: 'dinner',
    });
    expect(shares.get('a')! + shares.get('b')! + shares.get('c')!).toBe(1000n);
    expect(shares.get('d')! + shares.get('e')!).toBe(1000n);
    expect(shares.get('f')).toBe(1000n);
  });

  it('refuses a stranger, a person in two families, a person in none, an empty family and no weight', () => {
    const base = { amount: 100n, currency: INR, seed: 's', participants: ['a', 'b'] };
    expectSplitError(
      () => computeShares({ ...base, params: { kind: 'units', units: { u: ['a', 'b', 'z'] } } }),
      SplitErrorCode.UnknownMember,
    );
    expectSplitError(
      () =>
        computeShares({ ...base, params: { kind: 'units', units: { u: ['a'], v: ['a', 'b'] } } }),
      SplitErrorCode.DuplicateParticipant,
    );
    expectSplitError(
      () => computeShares({ ...base, params: { kind: 'units', units: { u: ['a'] } } }),
      SplitErrorCode.UnknownMember,
    );
    expectSplitError(
      () => computeShares({ ...base, params: { kind: 'units', units: { u: ['a', 'b'], v: [] } } }),
      SplitErrorCode.EmptyParticipants,
    );
    expectSplitError(
      () =>
        computeShares({
          ...base,
          params: { kind: 'units', units: { u: ['a', 'b'] }, weights: { u: 0 } },
        }),
      SplitErrorCode.NoPositiveWeight,
    );
    expectSplitError(
      () =>
        computeShares({
          ...base,
          params: { kind: 'units', units: { u: ['a', 'b'] }, weights: { u: 1.234 } },
        }),
      SplitErrorCode.InvalidWeight,
    );
  });

  it('round-trips over the wire and refuses a bad shape', () => {
    const params: UnitsParams = {
      kind: 'units',
      units: { sharma: ['a', 'b'], c: ['c'] },
      weights: { sharma: 2.5, c: 1 },
    };
    const wire = JSON.parse(JSON.stringify(serialiseSplitParams(params)));
    expect(parseSplitParams(wire)).toEqual(params);
    expect(parseSplitParams({ kind: 'units', units: { u: ['a'] } })).toEqual({
      kind: 'units',
      units: { u: ['a'] },
    });
    const bad = (raw: unknown): void => expect(() => parseSplitParams(raw)).toThrow(SplitWireError);
    bad({ kind: 'units' });
    bad({ kind: 'units', units: { u: 'a' } });
    bad({ kind: 'units', units: { u: ['a'], v: ['a'] } });
    bad({ kind: 'units', units: { u: ['a'] }, weights: { v: 1 } });
    bad({ kind: 'units', units: { u: ['a'] }, weights: { u: 1.333 } });
  });
});

const FAMILIES: GroupUnits = {
  sharma: { name: 'Sharma family', members: ['ravi', 'priya', 'anu'], head: 'priya' },
  patel: { name: 'Patel family', members: ['sam', 'meera'] },
};

describe('family lens', () => {
  it('finds a member’s family, its head and who is on their own', () => {
    expect(unitOf(FAMILIES, 'anu')).toBe('sharma');
    expect(unitOf(FAMILIES, 'zara')).toBeNull();
    expect(headOf(FAMILIES.sharma!)).toBe('priya');
    expect(headOf(FAMILIES.patel!)).toBe('sam');
    expect(headOf({ name: 'x', members: ['a'], head: 'gone' })).toBe('a');
    expect(unassignedMembers(FAMILIES, ['ravi', 'zara', 'sam', 'bo'])).toEqual(['zara', 'bo']);
    expect(headsFor(FAMILIES, 'sharma')).toBe('priya');
    expect(headsFor(FAMILIES, 'zara')).toBe('zara');
  });

  it('snapshots only the participants, families first, singles keyed by themselves', () => {
    expect(unitsSplitParams(FAMILIES, ['anu', 'zara', 'ravi'])).toEqual({
      kind: 'units',
      units: { sharma: ['ravi', 'anu'], zara: ['zara'] },
    });
    expect(unitsSplitParams(null, ['a', 'b'])).toEqual({
      kind: 'units',
      units: { a: ['a'], b: ['b'] },
    });
  });

  it('rolls balances up by family without changing the total, and simplify still nets to zero', () => {
    fc.assert(
      fc.property(
        memberIds(2, 12).chain((members) =>
          fc.tuple(
            fc.constant(members),
            partitions(members),
            fc.array(fc.bigInt({ min: -1_000_000n, max: 1_000_000n }), {
              minLength: members.length,
              maxLength: members.length,
            }),
          ),
        ),
        ([members, { units }, deltas]) => {
          const balances = new Map<MemberId, bigint>();
          let drift = 0n;
          members.forEach((member, index) => {
            balances.set(member, deltas[index] ?? 0n);
            drift += deltas[index] ?? 0n;
          });
          // Balances always net to zero across a group.
          balances.set(
            members[0] as MemberId,
            (balances.get(members[0] as MemberId) ?? 0n) - drift,
          );
          const families: GroupUnits = Object.fromEntries(
            Object.entries(units)
              .filter(([, people]) => people.length > 1)
              .map(([id, people]) => [id, { name: id, members: people }]),
          );
          const rolled = unitBalances(balances, families);
          let total = 0n;
          for (const value of rolled.values()) total += value;
          expect(total).toBe(0n);
          for (const [id, unit] of Object.entries(families)) {
            expect(rolled.get(id)).toBe(
              unit.members.reduce((s, m) => s + (balances.get(m) ?? 0n), 0n),
            );
          }
          const net: NetBalances = new Map([[INR, balances]]);
          const transfers = simplify(unitNetBalances(net, families));
          expect(transfers.length).toBeLessThanOrEqual(Math.max(0, rolled.size - 1));
          const after = new Map(rolled);
          for (const transfer of transfers) {
            after.set(transfer.from, (after.get(transfer.from) ?? 0n) + transfer.amount);
            after.set(transfer.to, (after.get(transfer.to) ?? 0n) - transfer.amount);
          }
          for (const value of after.values()) expect(value).toBe(0n);
        },
      ),
    );
  });
});

describe('a malformed families map', () => {
  it('is read as families with nobody in them, never a crash', () => {
    const bad = {
      u: {},
      v: null,
      w: { name: 'Odd', members: 'ravi' },
      ok: { name: 'Patel', members: ['sam', 3, 'meera'], head: 'meera' },
    } as unknown as GroupUnits;
    expect(unitMembers(bad.u)).toEqual([]);
    expect(unitMembers(bad.ok)).toEqual(['sam', 'meera']);
    expect(unitOf(bad, 'ravi')).toBeNull();
    expect(unitOf(bad, 'meera')).toBe('ok');
    expect(headOf(bad.u!)).toBeUndefined();
    expect(headOf(bad.ok!)).toBe('meera');
    expect(unitsSplitParams(bad, ['ravi', 'sam'])).toEqual({
      kind: 'units',
      units: { ok: ['sam'], ravi: ['ravi'] },
    });
    expect(
      unitBalances(
        new Map([
          ['ravi', 1n],
          ['sam', 2n],
        ]),
        bad,
      ),
    ).toEqual(
      new Map([
        ['ravi', 1n],
        ['ok', 2n],
      ]),
    );
    expect(validateGroupUnits(bad, new Set(['sam', 'meera', 'ravi'])).ok).toBe(false);
  });
});

describe('validateGroupUnits', () => {
  const members = new Set(['a', 'b', 'c', 'd']);

  it('normalises a good map and clears on null or empty', () => {
    expect(validateGroupUnits(null, members)).toEqual({ ok: true, units: null });
    expect(validateGroupUnits({}, members)).toEqual({ ok: true, units: null });
    expect(
      validateGroupUnits(
        { u1: { name: '  Sharma  ', members: ['a', 'b'], head: 'b', junk: 1 } },
        members,
      ),
    ).toEqual({ ok: true, units: { u1: { name: 'Sharma', members: ['a', 'b'], head: 'b' } } });
  });

  it('refuses the shapes the boundary must not store', () => {
    const bad = (raw: unknown): void => expect(validateGroupUnits(raw, members).ok).toBe(false);
    bad([]);
    bad({ u: { name: '', members: ['a'] } });
    bad({ u: { name: 'x'.repeat(25), members: ['a'] } });
    bad({ u: { name: 'Sharma', members: [] } });
    bad({ u: { name: 'Sharma', members: ['zz'] } });
    bad({ u: { name: 'Sharma', members: ['a'] }, v: { name: 'Patel', members: ['a'] } });
    bad({ u: { name: 'Sharma', members: ['a'], head: 'b' } });
    bad({ 'bad id!': { name: 'Sharma', members: ['a'] } });
    bad(
      Object.fromEntries(
        Array.from({ length: 51 }, (_, i) => [`u${i}`, { name: 'x', members: ['a'] }]),
      ),
    );
  });
});
