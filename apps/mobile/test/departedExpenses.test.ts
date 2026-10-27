import { describe, expect, it } from 'vitest';
import { computeShares, type SplitParams } from '@waves/core';
import type { Expense } from '../src/lib/departedExpenses';
import {
  buildResplitItem,
  departedCategoryCounts,
  departedExpenseTotals,
  departedPairSummary,
  selectedDepartedCandidates,
  sortDepartedExpenses,
  classifyDepartedExpenses,
  summarizeDepartedExpenses,
} from '../src/lib/departedExpenses';

function expense(
  id = 'bill',
  params: SplitParams = { kind: 'equal' },
  participants = ['a', 'b', 'c'],
  payer = 'payer',
  currency = 'INR',
): Expense {
  const shares = computeShares({ amount: 101n, currency: 'INR', params, participants, seed: id });
  return {
    id,
    group_id: 'g',
    deleted_at: null,
    created_at: '',
    currentVersion: {
      id: 'v',
      version_no: 2,
      description: '',
      category: null,
      expense_date: '',
      currency,
      amount: '101',
      split_type: params.kind,
      split_params: params,
      payers: [{ member_id: payer, amount: '101' }],
      shares: [...shares].map(([member_id, amount]) => ({ member_id, amount: String(amount) })),
    },
  };
}

describe('departed expenses', () => {
  it('groups equal, custom and sole/co-paid bills, ignoring deleted and zero-share bills', () => {
    const custom = expense('custom', { kind: 'exact', amounts: { a: 21n, b: 40n, c: 40n } });
    const paid = expense('paid', { kind: 'equal' }, ['a', 'b'], 'a');
    const coPaid = expense('co');
    coPaid.currentVersion!.payers.push({ member_id: 'a', amount: '1' });
    const deleted = { ...expense('deleted'), deleted_at: 'today' };
    const zero = expense('zero', { kind: 'exact', amounts: { a: 0n, b: 101n } }, ['a', 'b']);
    const result = classifyDepartedExpenses([expense(), custom, paid, coPaid, deleted, zero], 'a');
    expect(result.equal).toHaveLength(1);
    expect(result.custom.map((c) => c.expense.id)).toEqual(['custom']);
    expect(result.paid).toEqual([paid, coPaid]);
  });

  it('preserves custom shares and spreads exactly using the existing rotation', () => {
    for (const id of ['one', 'two', 'three', 'four']) {
      const bill = expense(id, { kind: 'exact', amounts: { a: 21n, b: 30n, c: 50n } });
      const candidate = classifyDepartedExpenses([bill], 'a').custom[0]!;
      const item = buildResplitItem(candidate, 'a', 'share_equally')!;
      const extra = computeShares({
        amount: 21n,
        currency: 'INR',
        params: { kind: 'equal' },
        participants: ['b', 'c'],
        seed: id,
      });
      expect(item.split_type).toBe('exact');
      expect(item.shares).toEqual(
        ['b', 'c'].map((member_id) => ({
          member_id,
          amount_minor: String((member_id === 'b' ? 30n : 50n) + extra.get(member_id)!),
        })),
      );
      expect(item.shares.reduce((sum, s) => sum + BigInt(s.amount_minor), 0n)).toBe(101n);
      expect(item.base_version_no).toBe(2);
      expect(() => JSON.stringify(item)).not.toThrow();
    }
  });

  it('keeps equal splits equal and flags the sole remaining viewer', () => {
    const c = classifyDepartedExpenses([expense('single', { kind: 'equal' }, ['a', 'b'])], 'a', 'b')
      .equal[0]!;
    expect(c.onlyViewerRemains).toBe(true);
    expect(buildResplitItem(c, 'a')!.shares).toEqual([{ member_id: 'b', amount_minor: '101' }]);
    expect(buildResplitItem(c, 'a')!.split_type).toBe('equal');
  });

  it('offers only Keep when no positive-share participant remains', () => {
    const c = classifyDepartedExpenses([expense('alone', { kind: 'equal' }, ['a'])], 'a')
      .custom[0]!;
    expect(c.noneRemaining).toBe(true);
    expect(buildResplitItem(c, 'a')).toBeNull();
    expect(buildResplitItem(c, 'a', 'keep')).toBeNull();
  });

  it('summarizes each currency separately and selects the group currency', () => {
    const result = summarizeDepartedExpenses(
      [
        expense('inr', { kind: 'equal' }, ['a']),
        expense('usd', { kind: 'equal' }, ['a'], 'payer', 'USD'),
      ],
      'a',
      { default_currency: 'USD' },
    );
    expect(result.count).toBe(2);
    expect(result.totals).toEqual(
      new Map([
        ['INR', 101n],
        ['USD', 101n],
      ]),
    );
    expect(result.amount).toBe(101n);
  });
});

describe('departed screen calculations', () => {
  it('starts empty and selects only live candidates that have remaining participants', () => {
    const equal = expense('equal');
    const custom = expense('custom', { kind: 'exact', amounts: { a: 21n, b: 40n, c: 40n } });
    const alone = expense('alone', { kind: 'equal' }, ['a']);
    const paid = expense('paid', { kind: 'equal' }, ['a', 'b'], 'a');
    const classified = classifyDepartedExpenses([equal, custom, alone, paid], 'a');
    const candidates = [...classified.equal, ...classified.custom];
    expect(selectedDepartedCandidates(candidates, new Set())).toEqual([]);
    const selected = selectedDepartedCandidates(
      candidates,
      new Set(['custom', 'alone', 'paid', 'stale']),
    );
    expect(selected.map((candidate) => candidate.expense.id)).toEqual(['custom']);
    expect(
      summarizeDepartedExpenses(
        selected.map((candidate) => candidate.expense),
        'a',
      ).totals.get('INR'),
    ).toBe(21n);
    expect(selected.map((candidate) => buildResplitItem(candidate, 'a')!.expense_id)).toEqual([
      'custom',
    ]);
    expect(
      selectedDepartedCandidates(
        candidates,
        new Set(candidates.map((candidate) => candidate.expense.id)),
      ),
    ).toHaveLength(2);
  });

  it('counts present categories including paid bills, ignoring missing and deleted versions', () => {
    const food = expense('food');
    food.currentVersion!.category = 'food';
    const paid = expense('paid', { kind: 'equal' }, ['a', 'b'], 'a');
    paid.currentVersion!.category = 'food';
    expect(
      departedCategoryCounts([
        food,
        paid,
        expense(),
        { ...expense(), deleted_at: 'today' },
        { ...expense(), currentVersion: null },
      ]),
    ).toEqual(
      new Map([
        ['food', 2],
        ['other', 1],
      ]),
    );
  });

  it('sorts dates in both directions and bigint amounts without mutating input', () => {
    const early = expense('early');
    const late = expense('late');
    const large = expense('large');
    early.currentVersion!.expense_date = '2026-10-14';
    late.currentVersion!.expense_date = '2026-10-26';
    large.currentVersion!.expense_date = '2026-10-25';
    large.currentVersion!.amount = '900719925474099300';
    const input = [early, late, large];
    expect(sortDepartedExpenses(input, 'newest').map((row) => row.id)).toEqual([
      'late',
      'large',
      'early',
    ]);
    expect(sortDepartedExpenses(input, 'oldest').map((row) => row.id)).toEqual([
      'early',
      'large',
      'late',
    ]);
    expect(sortDepartedExpenses(input, 'amount').map((row) => row.id)).toEqual([
      'large',
      'late',
      'early',
    ]);
    expect(input.map((row) => row.id)).toEqual(['early', 'late', 'large']);
    expect(
      sortDepartedExpenses(
        [
          { ...early, deleted_at: 'today' },
          { ...late, currentVersion: null },
        ],
        'amount',
      ),
    ).toEqual([]);
  });

  it('summarizes only the viewer pair, keeping both directions and currencies separate', () => {
    const lent = expense('lent', { kind: 'exact', amounts: { a: 21n, b: 80n } }, ['a', 'b'], 'b');
    const owe = expense('owe', { kind: 'exact', amounts: { a: 61n, b: 40n } }, ['a', 'b'], 'a');
    const unrelated = expense('unrelated', { kind: 'equal' }, ['a'], 'c');
    const usd = expense('usd', { kind: 'equal' }, ['a'], 'b', 'USD');
    const result = departedPairSummary(
      [lent, owe, unrelated, usd, { ...lent, deleted_at: 'today' }],
      'a',
      'b',
    );
    expect(result.lent).toEqual({
      totals: new Map([
        ['INR', 21n],
        ['USD', 101n],
      ]),
      count: 2,
    });
    expect(result.owe).toEqual({ totals: new Map([['INR', 40n]]), count: 1 });
    expect(result.net).toEqual(
      new Map([
        ['INR', 82n],
        ['USD', 101n],
      ]),
    );
    expect(departedPairSummary([owe], 'a', 'b').net.get('INR')).toBe(-40n);
    expect(departedPairSummary([unrelated], 'a', 'b').lent.count).toBe(0);
  });

  it('uses stored FX for summary, selected shares, and section totals', () => {
    const bill = expense('usd', { kind: 'equal' }, ['a'], 'b', 'USD');
    bill.currentVersion!.fx = {
      from: 'USD',
      to: 'INR',
      num: '80',
      den: '1',
      ts: '2026-10-26T00:00:00Z',
      source: 'manual',
    };
    const group = { default_currency: 'INR', convert_to_group_currency: true };
    expect(departedPairSummary([bill], 'a', 'b', group).lent.totals).toEqual(
      new Map([['INR', 8080n]]),
    );
    expect(summarizeDepartedExpenses([bill], 'a', group).totals).toEqual(new Map([['INR', 8080n]]));
    expect(departedExpenseTotals([bill], group)).toEqual(new Map([['INR', 8080n]]));
    expect(departedExpenseTotals([bill], { ...group, convert_to_group_currency: false })).toEqual(
      new Map([['USD', 101n]]),
    );
  });

  it('uses real net edges for co-payers rather than attributing their entire share to the viewer', () => {
    const bill = expense('co', { kind: 'exact', amounts: { a: 61n, b: 40n } }, ['a', 'b'], 'b');
    bill.currentVersion!.payers = [
      { member_id: 'a', amount: '21' },
      { member_id: 'b', amount: '80' },
    ];
    const result = departedPairSummary([bill], 'a', 'b');
    expect(result.lent.totals.get('INR')).toBe(40n);
    expect(result.lent.count).toBe(1);
    expect(result.owe.count).toBe(0);
    expect(result.net.get('INR')).toBe(40n);
  });

  it('totals complete bills separately from selected shares and excludes deleted bills', () => {
    const bill = expense();
    expect(
      departedExpenseTotals([
        bill,
        { ...bill, deleted_at: 'today' },
        { ...bill, currentVersion: null },
      ]),
    ).toEqual(new Map([['INR', 101n]]));
    expect(summarizeDepartedExpenses([bill], 'a').amount).toBeLessThan(101n);
  });
});
