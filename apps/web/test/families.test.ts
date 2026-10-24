import { describe, expect, it } from 'vitest';

import { computeShares, familyTransfers, unitsSplitParams, type GroupUnits } from '@waves/core';

import { familyParamsFor, equalFamilyParams, groupSharesByFamily } from '../src/lib/families';
import { pendingPairKey } from '../src/lib/settlementActions';

const units: GroupUnits = {
  sharma: { name: 'Sharma family', members: ['ravi', 'priya', 'anu'], head: 'priya' },
  patel: { name: 'Patel family', members: ['sam', 'nita'] },
};

describe('a by-family bill on the web', () => {
  const shares = [
    { member_id: 'ravi', amount: '200' },
    { member_id: 'priya', amount: '200' },
    { member_id: 'sam', amount: '300' },
    { member_id: 'zed', amount: '100' },
  ];

  it('groups shares by the snapshot the bill was written with', () => {
    const split = { units: { sharma: ['ravi', 'priya'], patel: ['sam'], zed: ['zed'] } };
    const groups = groupSharesByFamily(shares, split, units);
    expect(groups.map((group) => [group.name, group.total])).toEqual([
      ['Sharma family', 400n],
      ['Patel family', 300n],
      [null, 100n],
    ]);
  });

  it('reads a family the group no longer has as plain rows', () => {
    const groups = groupSharesByFamily(shares, { units: { gone: ['ravi', 'priya'] } }, units);
    expect(groups.every((group) => group.name === null)).toBe(true);
    expect(groups.flatMap((group) => group.rows.map((row) => row.member_id))).toEqual([
      'ravi',
      'priya',
      'sam',
      'zed',
    ]);
  });
});

describe('the editor and settle-up share core', () => {
  it('splits a bill equally per family, then inside the family', () => {
    const everyone = ['ravi', 'priya', 'anu', 'sam', 'nita'];
    const params = unitsSplitParams(units, everyone);
    const result = computeShares({
      amount: 1000n,
      currency: 'INR',
      params,
      participants: everyone,
      seed: 'bill',
    });
    const sum = (ids: string[]) => ids.reduce((acc, id) => acc + (result.get(id) ?? 0n), 0n);
    expect(sum(everyone)).toBe(1000n);
    expect(sum(['ravi', 'priya', 'anu'])).toBe(500n);
  });

  it('names the heads on a family settle-up line', () => {
    const net = new Map([
      [
        'INR' as const,
        new Map([
          ['ravi', -600n],
          ['priya', 100n],
          ['anu', 0n],
          ['sam', 500n],
          ['nita', 0n],
        ]),
      ],
    ]);
    expect(familyTransfers(net, units)).toEqual([
      expect.objectContaining({ from: 'priya', to: 'sam', amount: 500n }),
    ]);
  });
});

describe('a pending family payment', () => {
  it('counts against the family line for every member', () => {
    const partyOf = (id: string) =>
      Object.entries(units).find(([, unit]) => unit.members.includes(id))?.[0] ?? id;
    expect(pendingPairKey('anu', 'sam', 'INR', partyOf)).toBe(
      pendingPairKey('priya', 'nita', 'INR', partyOf),
    );
    expect(pendingPairKey('anu', 'sam', 'INR')).not.toBe(pendingPairKey('priya', 'sam', 'INR'));
  });
});

describe('editing a saved by-family bill', () => {
  const saved = { kind: 'units' as const, units: { a: ['A', 'B'], c: ['C'] } };
  const moved: GroupUnits = {
    a: { name: 'A', members: ['A'] },
    c: { name: 'C', members: ['C', 'B'] },
  };
  const people = ['A', 'B', 'C'];
  const sharesOf = (params: ReturnType<typeof equalFamilyParams>) =>
    computeShares({ amount: 12000n, currency: 'INR', params, participants: people, seed: 'x' });

  it('keeps the saved composition until the split is changed', () => {
    const kept = sharesOf(equalFamilyParams(saved, false, moved, people));
    expect([kept.get('A'), kept.get('B'), kept.get('C')]).toEqual([3000n, 3000n, 6000n]);
    const changed = sharesOf(equalFamilyParams(saved, true, moved, people));
    expect([changed.get('A'), changed.get('B'), changed.get('C')]).toEqual([6000n, 3000n, 3000n]);
  });
});

describe('family split fields on the web', () => {
  const weighted: GroupUnits = {
    sharma: { ...units.sharma!, weights: { anu: 0.5 } },
    patel: units.patel!,
  };
  const input = {
    units: weighted,
    participants: ['ravi', 'priya', 'anu', 'sam', 'nita'],
    bySize: false,
    currency: 'INR',
    exact: {},
    percent: {},
    weights: {},
  };
  const result = (params: ReturnType<typeof familyParamsFor>) =>
    computeShares({
      amount: 900n,
      currency: 'INR',
      params,
      participants: input.participants,
      seed: 'bill',
    });

  it('offers same or by-size family weights and snapshots the child', () => {
    const same = familyParamsFor({ ...input, kind: 'equal' });
    expect(same.memberWeights).toEqual({ anu: 0.5 });
    expect(result(same).get('anu')).toBe(90n);
    const size = familyParamsFor({ ...input, kind: 'equal', bySize: true });
    expect(result(size).get('anu')).toBe(100n);
  });

  it.each(['shares', 'exact', 'percent'] as const)(
    'parses %s fields per family, and uses member weights inside',
    (kind) => {
      const params = familyParamsFor({
        ...input,
        kind,
        bySize: true,
        weights: { sharma: '2', patel: '1' },
        exact: { sharma: '6.00', patel: '3.00' },
        percent: { sharma: '66.67', patel: '33.33' },
      });
      const shares = result(params);
      expect([...shares.values()].reduce((sum, amount) => sum + amount, 0n)).toBe(900n);
      expect(shares.get('anu')).toBe(120n);
      expect(params.bySize).toBeUndefined();
    },
  );

  it('rejects malformed fields and does not round away percentage precision', () => {
    expect(() =>
      familyParamsFor({
        ...input,
        kind: 'percent',
        percent: { sharma: '33.333', patel: '66.667' },
      }),
    ).toThrow();
    expect(() =>
      result(familyParamsFor({ ...input, kind: 'exact', exact: { sharma: '1', patel: '1' } })),
    ).toThrow();
  });
});
