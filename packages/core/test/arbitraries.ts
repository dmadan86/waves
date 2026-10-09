import fc from 'fast-check';

import type { MemberId } from '../src/split/types.js';

/** Stable-looking member ids, always unique within a draw. */
export const memberIds = (min = 1, max = 8): fc.Arbitrary<MemberId[]> =>
  fc.uniqueArray(
    fc.integer({ min: 1, max: 9999 }).map((n) => `m${n.toString().padStart(4, '0')}`),
    { minLength: min, maxLength: max },
  );

/** Realistic expense totals: ₹0 to ₹1,00,000 in paise. */
export const amounts = (max = 10_000_000n): fc.Arbitrary<bigint> => fc.bigInt({ min: 0n, max });

export const positiveAmounts = (max = 10_000_000n): fc.Arbitrary<bigint> =>
  fc.bigInt({ min: 1n, max });

export const seeds = (): fc.Arbitrary<string> =>
  fc.string({ minLength: 1, maxLength: 24 }).filter((s) => s.trim().length > 0);

/** Basis points for every member, guaranteed to sum to exactly 10000. */
export const basisPointSplit = (
  members: readonly MemberId[],
): fc.Arbitrary<Record<MemberId, number>> =>
  fc
    .array(fc.integer({ min: 0, max: 100 }), {
      minLength: members.length,
      maxLength: members.length,
    })
    .map((rawWeights) => {
      const total = rawWeights.reduce((sum, weight) => sum + weight, 0);
      const weights = total === 0 ? rawWeights.map(() => 1) : rawWeights;
      const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);

      const result: Record<MemberId, number> = {};
      let allocated = 0;
      members.forEach((member, index) => {
        const share = Math.floor((10000 * (weights[index] ?? 0)) / weightTotal);
        result[member] = share;
        allocated += share;
      });
      const first = members[0] as MemberId;
      result[first] = (result[first] ?? 0) + (10000 - allocated);
      return result;
    });

export const weightSplit = (members: readonly MemberId[]): fc.Arbitrary<Record<MemberId, number>> =>
  fc
    .array(fc.integer({ min: 0, max: 20 }), {
      minLength: members.length,
      maxLength: members.length,
    })
    .map((weights) => {
      const result: Record<MemberId, number> = {};
      members.forEach((member, index) => {
        result[member] = weights[index] ?? 0;
      });
      if (members.every((member) => (result[member] ?? 0) === 0)) {
        result[members[0] as MemberId] = 1;
      }
      return result;
    });

/** Exact per-member amounts plus the total they add up to. */
export const exactSplit = (
  members: readonly MemberId[],
): fc.Arbitrary<{ amounts: Record<MemberId, bigint>; total: bigint }> =>
  fc
    .array(fc.bigInt({ min: 0n, max: 500_000n }), {
      minLength: members.length,
      maxLength: members.length,
    })
    .map((values) => {
      const amounts: Record<MemberId, bigint> = {};
      let total = 0n;
      members.forEach((member, index) => {
        const value = values[index] ?? 0n;
        amounts[member] = value;
        total += value;
      });
      return { amounts, total };
    });

/**
 * A stored rate (`expense_versions.fx`) converting `from` into one of the group
 * currencies Waves settles in. Rationals span many orders of magnitude on both
 * sides, so the conversion is exercised from ₫ (exponent 0) through ₹/$ (2) to
 * the three-decimal dinars, in both directions.
 */
export const FX_FROM = ['VND', 'USD', 'JPY', 'KWD', 'EUR', 'INR'] as const;
export const FX_TO = ['INR', 'USD', 'JPY', 'BHD'] as const;

export interface FxRecordDraw {
  num: string;
  den: string;
  from: string;
  to: string;
  ts: string;
  source: string;
}

/**
 * A stored rate out of `from`. With `into`, always into that currency (the
 * group's); without, into any other one — which a converting group whose
 * currency differs must ignore.
 */
export const fxRecords = (from: string, into?: string): fc.Arbitrary<FxRecordDraw> =>
  fc
    .record({
      to: into ? fc.constant(into) : fc.constantFrom(...FX_TO.filter((code) => code !== from)),
      num: fc.bigInt({ min: 1n, max: 10_000_000n }),
      den: fc.bigInt({ min: 1n, max: 10_000_000n }),
    })
    .map(({ to, num, den }) => ({
      num: num.toString(),
      den: den.toString(),
      from,
      to,
      ts: '2026-10-01T00:00:00.000Z',
      source: 'manual',
    }));

/**
 * Stored `fx` values that are NOT a usable rate for a bill in `currency`: the
 * bill must stay in its own currency on every one of them.
 */
export const unusableFx = (currency: string): fc.Arbitrary<unknown> =>
  fc.constantFrom<unknown>(
    null,
    undefined,
    'not an object',
    [],
    {
      num: '1',
      den: '2',
      from: currency === 'EUR' ? 'USD' : 'EUR',
      to: 'INR',
      ts: 't',
      source: 's',
    },
    { num: '1', den: '2', from: currency, to: currency, ts: 't', source: 's' },
    { num: 3, den: '2', from: currency, to: 'XTS', ts: 't', source: 's' },
    { num: '0', den: '2', from: currency, to: 'XTS', ts: 't', source: 's' },
    { num: '1', den: '-2', from: currency, to: 'XTS', ts: 't', source: 's' },
    { num: '1.5', den: '2', from: currency, to: 'XTS', ts: 't', source: 's' },
    { num: '1', den: '2', from: currency, to: 'inr', ts: 't', source: 's' },
    { num: '1', den: '2', from: currency, ts: 't', source: 's' },
  );
