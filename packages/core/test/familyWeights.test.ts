import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  computeShares,
  sumShares,
  unitsSplitParams,
  unitsFromSnapshot,
  validateGroupUnits,
  unitsEqual,
  parseSplitParams,
  serialiseSplitParams,
  splitMemberName,
  type UnitsParams,
} from '../src/index';

const units = { sharma: ['adult', 'other', 'child'], solo: ['single'] };
const participants = Object.values(units).flat();
const base: UnitsParams = { kind: 'units', units, memberWeights: { child: 0.5 } };
const run = (params: UnitsParams, amount = 700n, seed = 'bill') =>
  computeShares({ amount, currency: 'INR', params, participants, seed });

describe('weighted family splits', () => {
  it('keeps equal families as the default and gives a child half an adult share inside', () => {
    expect([...run(base)]).toEqual(
      expect.arrayContaining([
        ['adult', 140n],
        ['other', 140n],
        ['child', 70n],
        ['single', 350n],
      ]),
    );
  });

  it('by size counts two adults and a child as 2.5 shares', () => {
    const snapshot = unitsSplitParams(
      { sharma: { name: 'Sharma', members: units.sharma, weights: { child: 0.5 } } },
      participants,
      true,
    );
    expect(snapshot).toMatchObject({ bySize: true, memberWeights: { child: 0.5 } });
    expect([...run(snapshot)]).toEqual(
      expect.arrayContaining([
        ['adult', 200n],
        ['other', 200n],
        ['child', 100n],
        ['single', 200n],
      ]),
    );
  });

  it.each(['weights', 'exact', 'percent', 'size'] as const)(
    'keeps totals exact and deterministic for %s, including both rounding stages',
    (mode) => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: 0n, max: 10n ** 15n }),
          fc.integer({ min: 1, max: 1000 }),
          fc.integer({ min: 0, max: 10000 }),
          fc.string(),
          (amount, memberWeight, part, seed) => {
            const params: UnitsParams = {
              ...base,
              memberWeights: { child: memberWeight / 100 },
              ...(mode === 'size'
                ? { bySize: true }
                : mode === 'exact'
                  ? {
                      mode,
                      amounts: {
                        sharma: (amount * BigInt(part)) / 10000n,
                        solo: amount - (amount * BigInt(part)) / 10000n,
                      },
                    }
                  : mode === 'percent'
                    ? { mode, basisPoints: { sharma: part, solo: 10000 - part } }
                    : { mode, weights: { sharma: part / 100, solo: (10001 - part) / 100 } }),
            };
            const shares = run(params, amount, seed);
            expect(sumShares(shares)).toBe(amount);
            expect([...shares.values()].every((value) => value >= 0n)).toBe(true);
            const reversed = computeShares({
              amount,
              currency: 'INR',
              seed,
              participants: [...participants].reverse(),
              params: {
                ...params,
                units: Object.fromEntries(
                  Object.entries(units)
                    .reverse()
                    .map(([id, members]) => [id, [...members].reverse()]),
                ),
              },
            });
            expect([...reversed].sort()).toEqual([...shares].sort());
            const wire = JSON.parse(JSON.stringify(serialiseSplitParams(params)));
            expect(parseSplitParams(wire)).toEqual(params);
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  it('supports finite member weights throughout (0, 10], including sub-centi weights', () => {
    expect(
      sumShares(run({ ...base, bySize: true, memberWeights: { child: 0.125, adult: 1e-8 } })),
    ).toBe(700n);
  });

  it('rejects family exact and percentage sum mismatches and negative amounts', () => {
    expect(() => run({ ...base, mode: 'exact', amounts: { sharma: 200n, solo: 200n } })).toThrow(
      /sum/,
    );
    expect(() =>
      run({ ...base, mode: 'percent', basisPoints: { sharma: 5000, solo: 4000 } }),
    ).toThrow(/100%/);
    expect(() => run({ ...base, mode: 'exact', amounts: { sharma: -1n, solo: 701n } })).toThrow(
      /negative/,
    );
  });

  it.each([0, -1, 10.01, NaN, Infinity])(
    'rejects invalid member weight %s in math, wire and group settings',
    (weight) => {
      expect(() => run({ ...base, memberWeights: { child: weight } })).toThrow();
      expect(() => parseSplitParams({ ...base, memberWeights: { child: weight } })).toThrow();
      expect(
        validateGroupUnits(
          { family: { name: 'Family', members: ['child'], weights: { child: weight } } },
          new Set(['child']),
        ).ok,
      ).toBe(false);
    },
  );

  it('rejects foreign member/unit keys and unknown modes', () => {
    for (const params of [
      { ...base, memberWeights: { stranger: 0.5 } },
      { ...base, mode: 'exact' as const, amounts: { stranger: 700n } },
      { ...base, mode: 'percent' as const, basisPoints: { stranger: 10000 } },
      { ...base, weights: { stranger: 1 } },
    ]) {
      expect(() => run(params)).toThrow();
      expect(() => parseSplitParams(serialiseSplitParams(params))).toThrow();
    }
    expect(() => parseSplitParams({ ...base, mode: 'other' })).toThrow();
    expect(() => parseSplitParams({ ...base, mode: 'exact' })).toThrow();
    expect(() => parseSplitParams({ ...base, mode: 'percent' })).toThrow();
  });

  it('keeps legacy payloads unchanged and round-trips bigint exact amounts safely', () => {
    for (const params of [
      { kind: 'units' as const, units },
      { kind: 'units' as const, units, weights: { sharma: 2.5 } },
      { ...base, mode: 'exact' as const, amounts: { sharma: 9007199254740993n, solo: 0n } },
    ]) {
      expect(parseSplitParams(JSON.parse(JSON.stringify(serialiseSplitParams(params))))).toEqual(
        params,
      );
    }
  });

  it('renders saved family membership and child weights while keeping singles as people', () => {
    const split = { ...base, units: { sharma: units.sharma, single: ['single'] } };
    expect(unitsFromSnapshot(split, { sharma: { name: 'Sharma', members: ['adult'] } })).toEqual({
      sharma: { name: 'Sharma', members: units.sharma, weights: { child: 0.5 } },
    });
  });

  it('stores only non-default member weights and includes them in the conflict comparison', () => {
    const family = {
      name: 'Family',
      members: ['adult', 'child'],
      weights: { adult: 1, child: 0.5 },
    };
    expect(validateGroupUnits({ family }, new Set(participants))).toEqual({
      ok: true,
      units: { family: { ...family, weights: { child: 0.5 } } },
    });
    expect(
      validateGroupUnits({ family: { ...family, weights: { single: 0.5 } } }, new Set(participants))
        .ok,
    ).toBe(false);
    expect(unitsEqual({ family }, { family: { ...family, weights: { child: 1 } } })).toBe(false);
    expect(
      unitsEqual(
        { family: { ...family, weights: { child: 1 } } },
        { family: { name: family.name, members: family.members } },
      ),
    ).toBe(true);
    expect(splitMemberName(base, 'child', 'Anu')).toBe('Anu ½');
    expect(splitMemberName(base, 'adult', 'Ravi')).toBe('Ravi');
  });
});
