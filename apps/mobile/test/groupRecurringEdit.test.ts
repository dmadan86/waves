import { describe, expect, it } from 'vitest';
import { editFromRule, Frequency, recurringFullPatch, type GroupRecurringRule } from '@waves/core';

import { SplitKind } from '@/lib/split';
import { editStateFromRule, splitIsEditable, templateFromState } from '@/lib/groupRecurringEdit';

const rule = (over: Partial<GroupRecurringRule> = {}): GroupRecurringRule => ({
  id: 'r1',
  groupId: 'g1',
  createdBy: 'a',
  description: 'Rent',
  category: 'home',
  currency: 'INR',
  amount: 90_000n,
  splitParams: { kind: 'equal' },
  participants: ['a', 'b', 'c'],
  payers: { a: 90_000n },
  notes: null,
  cadence: 'monthly',
  interval: 1,
  secondDay: null,
  anchorDate: '2026-11-01',
  nextDate: '2026-11-01',
  endDate: null,
  status: 'active',
  lastGeneratedOn: null,
  ...over,
});

describe('the repeating-expense edit form', () => {
  it('opens in the expense form state and an untouched save is no patch', () => {
    const r = rule();
    const state = editStateFromRule(r);
    expect(state).toMatchObject({
      description: 'Rent',
      amount: 90_000n,
      category: 'home',
      splitKind: SplitKind.Equal,
      participants: ['a', 'b', 'c'],
    });
    expect([...state.payers]).toEqual([['a', 90_000n]]);
    const edit = editFromRule(r);
    expect(
      recurringFullPatch(r, { ...edit, template: templateFromState(state, r, '') }),
    ).toBeNull();
  });

  it('a percent split reopens as typed and saves back as the same integers', () => {
    const r = rule({
      splitParams: { kind: 'percent', basisPoints: { a: 7000, b: 3000 } },
      participants: ['a', 'b'],
    });
    const state = editStateFromRule(r);
    expect(state.splitKind).toBe(SplitKind.Percent);
    const edit = editFromRule(r);
    expect(
      recurringFullPatch(r, { ...edit, template: templateFromState(state, r, '') }),
    ).toBeNull();
  });

  it('changing the amount with several payers keeps their proportions', () => {
    const r = rule({ payers: { a: 60_000n, b: 30_000n } });
    const state = { ...editStateFromRule(r), amount: 120_000n };
    const template = templateFromState(state, r, '');
    expect(template.payers).toEqual({ a: 80_000n, b: 40_000n });
    const patch = recurringFullPatch(r, { ...editFromRule(r), template })!;
    expect(patch.amount).toBe('120000');
  });

  it('keeps an adjusted split as saved instead of turning it into an equal one', () => {
    const adjusted = rule({
      splitParams: { kind: 'adjustment', adjustments: { a: 100n } } as never,
    });
    expect(splitIsEditable(adjusted)).toBe(false);
    const state = editStateFromRule(adjusted);
    expect(templateFromState(state, adjusted, '').splitParams).toEqual(adjusted.splitParams);
    expect(splitIsEditable(rule())).toBe(true);
  });

  it('the schedule rides along: monthly becomes twice a month on the 20th', () => {
    const r = rule();
    const state = editStateFromRule(r);
    const edit = editFromRule(r);
    const patch = recurringFullPatch(r, {
      template: templateFromState(state, r, ''),
      when: { ...edit.when, frequency: Frequency.TwiceAMonth, secondDay: 20 },
    });
    expect(patch).toMatchObject({ cadence: 'semimonthly', second_day: 20 });
  });
});
