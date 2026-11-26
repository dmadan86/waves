import { describe, expect, it } from 'vitest';
import { computeShares, type SplitParams } from '@waves/core';
import {
  buildResplitItem,
  classifyDepartedExpenses,
  RESPLIT_MODES,
  type Expense,
} from '../src/lib/departedExpenses';

function bill(id: string, amount: bigint, params: SplitParams, participants: string[]): Expense {
  const shares = computeShares({ amount, currency: 'INR', params, participants, seed: id });
  return {
    id,
    group_id: 'g',
    deleted_at: null,
    created_at: '',
    currentVersion: {
      id: 'v',
      version_no: 3,
      description: '',
      category: null,
      expense_date: '',
      currency: 'INR',
      amount: String(amount),
      split_type: params.kind,
      split_params: params,
      payers: [{ member_id: 'payer', amount: String(amount) }],
      shares: [...shares].map(([member_id, a]) => ({ member_id, amount: String(a) })),
    },
  };
}

const first = (e: Expense, gone: string[] = []) => {
  const r = classifyDepartedExpenses([e], 'a', undefined, new Set(gone));
  return [...r.equal, ...r.custom][0]!;
};
const total = (i: { shares: { amount_minor: string }[] }) =>
  i.shares.reduce((s, x) => s + BigInt(x.amount_minor), 0n);

describe('two departures', () => {
  it('never counts an already departed member as a recipient', () => {
    const c = first(bill('b1', 10000n, { kind: 'equal' }, ['a', 'u2', 'c', 'd']), ['u2']);
    expect(c.remainingParticipants).toEqual(['c', 'd']);
    const item = buildResplitItem(c, 'a')!;
    expect(item.shares.map((s) => s.member_id).sort()).toEqual(['c', 'd']);
    expect(total(item)).toBe(10000n);
  });

  it('leaves nobody to receive when everyone else has gone', () => {
    expect(first(bill('b2', 100n, { kind: 'equal' }, ['a', 'u2']), ['u2']).noneRemaining).toBe(
      true,
    );
  });
});

describe('re-split modes', () => {
  const pct = bill('p', 10000n, { kind: 'percent', basisPoints: { a: 2000, b: 5000, c: 3000 } }, [
    'a',
    'b',
    'c',
  ]);

  it('proportional keeps the percentages: 50/30/20 with 20 gone is 62.5/37.5', () => {
    const item = buildResplitItem(first(pct), 'a', 'proportional')!;
    expect(item.split_type).toBe('percent');
    expect(item.split_params).toEqual({ kind: 'percent', basisPoints: { b: 6250, c: 3750 } });
    expect(item.shares).toEqual([
      { member_id: 'b', amount_minor: '6250' },
      { member_id: 'c', amount_minor: '3750' },
    ]);
  });

  it('proportional keeps shares as shares', () => {
    const item = buildResplitItem(
      first(bill('s', 101n, { kind: 'shares', weights: { a: 1, b: 2, c: 2 } }, ['a', 'b', 'c'])),
      'a',
      'proportional',
    )!;
    expect(item.split_type).toBe('shares');
    expect(item.split_params).toEqual({ kind: 'shares', weights: { b: 2, c: 2 } });
    expect(total(item)).toBe(101n);
  });

  it('proportional on exact amounts stays exact and follows the ratio', () => {
    const item = buildResplitItem(
      first(
        bill('x', 101n, { kind: 'exact', amounts: { a: 21n, b: 30n, c: 50n } }, ['a', 'b', 'c']),
      ),
      'a',
      'proportional',
    )!;
    expect(item.split_type).toBe('exact');
    expect(total(item)).toBe(101n);
    expect(BigInt(item.shares[1]!.amount_minor)).toBeGreaterThan(
      BigInt(item.shares[0]!.amount_minor),
    );
  });

  it('equal splits the whole bill among the rest, as an equal bill', () => {
    const item = buildResplitItem(
      first(
        bill('y', 101n, { kind: 'exact', amounts: { a: 21n, b: 30n, c: 50n } }, ['a', 'b', 'c']),
      ),
      'a',
      'equal',
    )!;
    expect(item.split_type).toBe('equal');
    expect(item.shares.map((s) => s.amount_minor).sort()).toEqual(['50', '51']);
  });

  it('every mode but keep adds up to the bill, to the paisa', () => {
    for (const amount of [1n, 7n, 101n, 99999n]) {
      for (const params of [
        { kind: 'percent', basisPoints: { a: 3333, b: 3334, c: 3333 } },
        { kind: 'shares', weights: { a: 1, b: 1.5, c: 3 } },
        { kind: 'exact', amounts: { a: amount, b: 0n, c: 0n } },
      ] as SplitParams[]) {
        const e = bill('r', amount, params, ['a', 'b', 'c']);
        const c = first(e);
        if (!c) continue;
        for (const mode of RESPLIT_MODES) {
          const item = buildResplitItem(c, 'a', mode);
          if (mode === 'keep') expect(item).toBeNull();
          else if (item) expect(total(item)).toBe(amount);
        }
      }
    }
  });
});
