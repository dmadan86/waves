import { describe, expect, it } from 'vitest';

import { pairBalances, simplifyPairwise, type PairwiseEdge } from '../src/index';

const edge = (from: string, to: string, amount: bigint, currency = 'INR'): PairwiseEdge => ({
  from,
  to,
  currency: currency as PairwiseEdge['currency'],
  amount,
});

describe('pairBalances', () => {
  it('sums a 400 trip and a 425 group to 825, rows and total agreeing', () => {
    const result = pairBalances([
      {
        groupId: 'goa',
        simplify: false,
        viewerMemberId: 'me-goa',
        otherMemberIds: ['renny-goa'],
        edges: [edge('renny-goa', 'me-goa', 40000n), edge('x', 'y', 999n)],
        suggested: null,
      },
      {
        groupId: 'pair',
        simplify: false,
        viewerMemberId: 'me-pair',
        otherMemberIds: ['renny-pair'],
        edges: [edge('renny-pair', 'me-pair', 42500n)],
        suggested: null,
      },
    ]);
    expect(result.totals).toEqual([{ currency: 'INR', net: 82500n }]);
    expect(result.groups.map((g) => [g.groupId, g.lines[0]?.net])).toEqual([
      ['pair', 42500n],
      ['goa', 40000n],
    ]);
    const rowSum = result.groups.reduce(
      (sum, g) => sum + g.lines.reduce((s, l) => s + l.net, 0n),
      0n,
    );
    expect(rowSum).toBe(result.totals[0]?.net);
  });

  it('adds every member row of a merged person, and signs what you owe as negative', () => {
    const result = pairBalances([
      {
        groupId: 'goa',
        simplify: false,
        viewerMemberId: 'me',
        otherMemberIds: ['renny', 'renny-hethu'],
        edges: [
          edge('renny', 'me', 15000n),
          edge('renny-hethu', 'me', 15000n),
          edge('me', 'z', 5n),
        ],
        suggested: null,
      },
      {
        groupId: 'home',
        simplify: false,
        viewerMemberId: 'me2',
        otherMemberIds: ['r2'],
        edges: [edge('me2', 'r2', 1000n)],
        suggested: null,
      },
    ]);
    expect(result.totals).toEqual([{ currency: 'INR', net: 29000n }]);
    expect(result.groups.find((g) => g.groupId === 'home')?.lines[0]?.net).toBe(-1000n);
  });

  it('uses the simplified amount for a simplify group when it differs, and labels it', () => {
    // B owes me 100, I owe C 40: simplifying has B pay me 60 and C 40.
    const edges = [edge('b', 'me', 10000n), edge('me', 'c', 4000n)];
    const result = pairBalances([
      {
        groupId: 'g',
        simplify: true,
        viewerMemberId: 'me',
        otherMemberIds: ['b'],
        edges,
        suggested: simplifyPairwise(edges),
      },
      {
        groupId: 'plain',
        simplify: false,
        viewerMemberId: 'me3',
        otherMemberIds: ['b3'],
        edges: [edge('b3', 'me3', 2500n)],
        suggested: null,
      },
    ]);
    const g = result.groups.find((x) => x.groupId === 'g');
    expect(g?.lines[0]).toMatchObject({ net: 6000n, direct: 10000n, basis: 'simplified' });
    expect(g?.simplified).toBe(true);
    expect(result.groups.find((x) => x.groupId === 'plain')?.simplified).toBe(false);
    expect(result.totals).toEqual([{ currency: 'INR', net: 8500n }]);
  });

  it('keeps the direct basis when simplify agrees, and drops a pair the plan routes elsewhere', () => {
    const agree = [edge('b', 'me', 5000n)];
    const chain = [edge('b', 'me', 5000n), edge('me', 'c', 5000n)];
    const result = pairBalances([
      {
        groupId: 'a',
        simplify: true,
        viewerMemberId: 'me',
        otherMemberIds: ['b'],
        edges: agree,
        suggested: simplifyPairwise(agree),
      },
      {
        groupId: 'c',
        simplify: true,
        viewerMemberId: 'me',
        otherMemberIds: ['b'],
        edges: chain,
        suggested: simplifyPairwise(chain),
      },
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.lines[0]).toMatchObject({ net: 5000n, basis: 'direct' });
    expect(result.totals).toEqual([{ currency: 'INR', net: 5000n }]);
  });

  it('never adds across currencies and is empty when square', () => {
    const result = pairBalances([
      {
        groupId: 'g',
        simplify: false,
        viewerMemberId: 'me',
        otherMemberIds: ['b'],
        edges: [edge('b', 'me', 100n, 'USD'), edge('b', 'me', 900n, 'INR')],
        suggested: null,
      },
    ]);
    expect(result.totals.map((t) => t.currency)).toEqual(['INR', 'USD']);
    expect(pairBalances([]).totals).toEqual([]);
  });
});
