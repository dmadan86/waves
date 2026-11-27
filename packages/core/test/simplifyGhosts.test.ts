import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { NetBalances, PairwiseEdge } from '../src/balances/types.js';
import { simplify, simplifyKeepingGhostsDirect } from '../src/simplify/simplify.js';

const INR = 'INR';
const edge = (from: string, to: string, amount: bigint): PairwiseEdge => ({
  from,
  to,
  currency: INR,
  amount,
});
const netOf = (edges: PairwiseEdge[]): NetBalances => {
  const m = new Map<string, bigint>();
  for (const e of edges) {
    m.set(e.from, (m.get(e.from) ?? 0n) - e.amount);
    m.set(e.to, (m.get(e.to) ?? 0n) + e.amount);
  }
  return new Map([[INR, m]]);
};

describe('simplifyKeepingGhostsDirect', () => {
  it('does not route A -> P -> B through a placeholder', () => {
    const edges = [edge('A', 'P', 100n), edge('P', 'B', 100n)];
    expect(simplify(netOf(edges)).map((t) => [t.from, t.to])).toEqual([['A', 'B']]);
    const out = simplifyKeepingGhostsDirect(netOf(edges), edges, new Set(['P']));
    expect(out.map((t) => [t.from, t.to, t.amount])).toEqual([
      ['A', 'P', 100n],
      ['P', 'B', 100n],
    ]);
  });

  it('still nets real members and is unchanged without placeholders', () => {
    const edges = [edge('A', 'B', 50n), edge('B', 'C', 50n), edge('A', 'P', 10n)];
    const out = simplifyKeepingGhostsDirect(netOf(edges), edges, new Set(['P']));
    expect(out.filter((t) => t.from !== 'P' && t.to !== 'P')).toEqual([
      { from: 'A', to: 'C', currency: INR, amount: 50n },
    ]);
    expect(simplifyKeepingGhostsDirect(netOf(edges), edges, new Set())).toEqual(
      simplify(netOf(edges)),
    );
  });

  it('property: placeholder transfers are direct debts and everyone settles to zero', () => {
    const ids = ['A', 'B', 'C', 'P', 'Q'];
    const arb = fc.array(
      fc.record({
        a: fc.constantFrom(...ids),
        b: fc.constantFrom(...ids),
        n: fc.bigInt({ min: 1n, max: 100_000n }),
      }),
      { maxLength: 12 },
    );
    fc.assert(
      fc.property(arb, (raw) => {
        // Collapse to one net edge per pair, as computePairwiseBalances does.
        const pair = new Map<string, bigint>();
        for (const { a, b, n } of raw) {
          if (a === b) continue;
          const [x, y, sign] = a < b ? [a, b, 1n] : [b, a, -1n];
          pair.set(`${x}|${y}`, (pair.get(`${x}|${y}`) ?? 0n) + sign * n);
        }
        const edges: PairwiseEdge[] = [];
        for (const [k, v] of pair) {
          const [x, y] = k.split('|') as [string, string];
          if (v > 0n) edges.push(edge(x, y, v));
          else if (v < 0n) edges.push(edge(y, x, -v));
        }
        const ghosts = new Set(['P', 'Q']);
        const out = simplifyKeepingGhostsDirect(netOf(edges), edges, ghosts);
        const settled = new Map<string, bigint>();
        for (const t of out) {
          settled.set(t.from, (settled.get(t.from) ?? 0n) - t.amount);
          settled.set(t.to, (settled.get(t.to) ?? 0n) + t.amount);
          if (ghosts.has(t.from) || ghosts.has(t.to)) {
            const direct = edges.find((e) => e.from === t.from && e.to === t.to);
            expect(direct).toBeDefined();
            expect(t.amount).toBeLessThanOrEqual(direct?.amount ?? 0n);
          }
        }
        for (const [m, v] of netOf(edges).get(INR) ?? []) expect(settled.get(m) ?? 0n).toBe(v);
      }),
    );
  });
});
