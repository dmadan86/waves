import { describe, expect, it } from 'vitest';
import { computeShares, type SplitParams } from '@waves/core';
import type { Expense } from '../src/lib/departedExpenses';
import {
  buildResplitItem,
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
