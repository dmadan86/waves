import { describe, expect, it } from 'vitest';
import { buildGroupRecurringCreate, Frequency } from '@waves/core';

import { groupRecurringFor, type SavedState } from '@/lib/followUpApply';

const saved = (over: Partial<SavedState> = {}): SavedState => ({
  kind: 'group',
  id: 'e1',
  groupId: 'g1',
  description: 'Rent',
  amount: 90000n,
  currency: 'INR',
  category: 'home',
  categoryStated: true,
  date: '2026-11-01',
  notes: null,
  place: null,
  location: null,
  paymentMethod: null,
  payers: { m1: 90000n },
  hasReceipt: false,
  reimbursable: false,
  participants: ['m1', 'm2', 'm3'],
  ...over,
});

describe('voice follow-up: "does this repeat?" for a group expense', () => {
  it('makes a monthly group rule that starts after the saved one', () => {
    const plan = groupRecurringFor(saved(), null)!;
    expect(plan.when).toMatchObject({
      frequency: Frequency.Monthly,
      anchorDate: '2026-11-01',
      skipFirst: true,
    });
    const payload = buildGroupRecurringCreate('r1', plan.template, plan.when);
    expect(payload).toMatchObject({
      cadence: 'monthly',
      interval: 1,
      skipFirst: true,
      splitType: 'equal',
    });
    expect(payload.shares).toHaveLength(3);
  });

  it('repeats the split the expense was saved with, not an equal one', () => {
    const plan = groupRecurringFor(saved(), {
      split_params: { kind: 'percent', basisPoints: { m1: 6000, m2: 4000 } },
      payers: [{ member_id: 'm1', amount: '90000' }],
      shares: [{ member_id: 'm1' }, { member_id: 'm2' }],
    })!;
    expect(plan.template.splitParams.kind).toBe('percent');
    const payload = buildGroupRecurringCreate('r1', plan.template, plan.when);
    expect(payload.shares).toEqual([
      { memberId: 'm1', amount: '54000' },
      { memberId: 'm2', amount: '36000' },
    ]);
  });

  it('falls back to an equal split when the saved split cannot be read', () => {
    const plan = groupRecurringFor(saved(), { split_params: { kind: 'nonsense' } })!;
    expect(plan.template.splitParams).toEqual({ kind: 'equal' });
  });

  it('writes nothing for a personal entry or an expense with nobody to repeat it for', () => {
    expect(groupRecurringFor(saved({ kind: 'personal', groupId: null }), null)).toBeNull();
    expect(groupRecurringFor(saved({ participants: [] }), null)).toBeNull();
    expect(groupRecurringFor(saved({ payers: null }), null)).toBeNull();
  });
});
