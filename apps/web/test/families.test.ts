import { describe, expect, it } from 'vitest';

import { computeShares, familyTransfers, unitsSplitParams, type GroupUnits } from '@waves/core';

import { groupSharesByFamily } from '../src/lib/families';
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
