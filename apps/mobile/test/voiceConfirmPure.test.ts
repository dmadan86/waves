import { describe, expect, it } from 'vitest';

import type { AgentLocalData } from '@/lib/voiceAgentPlan';
import {
  initialFields,
  matchMember,
  orderGroupTiles,
  resolveConfirm,
  type AddExpenseAction,
  type AddPersonalAction,
} from '@/lib/voiceConfirmPure';

const local: AgentLocalData = {
  groups: [
    {
      id: 'g1',
      name: 'Vietnam',
      currency: 'INR',
      members: [
        { id: 'm1', name: 'Madan', isViewer: true },
        { id: 'm2', name: 'Renny Joseph', isViewer: false },
        { id: 'm3', name: 'Anu', isViewer: false },
      ],
    },
    {
      id: 'g2',
      name: 'Goa',
      currency: 'INR',
      members: [
        { id: 'n1', name: 'Madan', isViewer: true },
        { id: 'n2', name: 'Renny', isViewer: false },
      ],
    },
    {
      id: 'g3',
      name: 'Office',
      currency: 'INR',
      members: [{ id: 'o1', name: 'Madan', isViewer: true }],
    },
  ],
};

const action: AddExpenseAction = {
  type: 'add_expense',
  groupId: 'g1',
  amountMinor: '100000',
  currency: 'INR',
  description: 'Dinner',
  category: 'food',
  paidByMemberId: 'm1',
  split: { mode: 'equal', shares: [{ memberId: 'm1' }, { memberId: 'm2' }] },
};

const resolve = (fields: Partial<ReturnType<typeof initialFields>>, groups = local) => {
  const initial = initialFields(action, groups, 'You');
  const result = resolveConfirm(
    action,
    initial,
    { ...initial, ...fields },
    groups,
    'You',
    'an expense',
  );
  // Narrowed for the group-expense assertions; a personal result reads as itself.
  return result as { ok: true; action: AddExpenseAction } | Exclude<typeof result, { ok: true }>;
};

describe('voice confirmation fields', () => {
  it('reads the proposal as amount, person, group, description and category', () => {
    expect(initialFields(action, local, 'You')).toEqual({
      personal: false,
      groupId: 'g1',
      amountText: '1000',
      personText: 'Renny Joseph',
      description: 'Dinner',
      note: '',
      category: 'food',
      date: null,
    });
  });

  it('an untouched form resolves to the proposal itself', () => {
    const result = resolve({});
    expect(result).toEqual({ ok: true, action });
  });

  it('a new amount keeps the payer and split', () => {
    const result = resolve({ amountText: '1500' });
    expect(result.ok && result.action.amountMinor).toBe('150000');
    expect(result.ok && result.action.split).toEqual(action.split);
  });

  it('a zero or empty amount cannot be added', () => {
    expect(resolve({ amountText: '' })).toEqual({ ok: false, reason: 'amount' });
  });

  it('a different group rebuilds the split from the same names', () => {
    const result = resolve({ groupId: 'g2' });
    expect(result.ok && result.action.groupId).toBe('g2');
    expect(result.ok && result.action.paidByMemberId).toBe('n1');
    expect(result.ok && result.action.split.shares.map((s) => s.memberId)).toEqual(['n1', 'n2']);
  });

  it('names someone who is not in the chosen group', () => {
    expect(resolve({ groupId: 'g3' })).toEqual({
      ok: false,
      reason: 'person',
      name: 'Renny Joseph',
    });
    expect(resolve({ groupId: null })).toEqual({ ok: false, reason: 'group' });
  });

  it('clearing the person leaves the expense unshared', () => {
    const result = resolve({ personText: '' });
    expect(result.ok && result.action.split.shares).toEqual([{ memberId: 'm1' }]);
  });

  it('an empty description falls back to the generic one', () => {
    const result = resolve({ description: '  ' });
    expect(result.ok && result.action.description).toBe('an expense');
  });

  it('writes a note after the description, and a picked date', () => {
    const result = resolve({ note: 'with the team', date: '2026-10-07' });
    expect(result.ok && result.action.description).toBe('Dinner — with the team');
    expect(result.ok && result.action.date).toBe('2026-10-07');
  });

  it('"Just for you" turns a group expense into a personal one', () => {
    expect(resolve({ personal: true, amountText: '250' })).toEqual({
      ok: true,
      action: {
        type: 'add_personal',
        amountMinor: '25000',
        currency: 'INR',
        description: 'Dinner',
        category: 'food',
      },
    });
  });

  it('matches a first name uniquely and understands "me"', () => {
    const group = local.groups[0]!;
    expect(matchMember(group, 'renny', 'You')?.id).toBe('m2');
    expect(matchMember(group, 'You', 'You')?.id).toBe('m1');
    expect(matchMember(group, 'zed', 'You')).toBeNull();
  });
});

describe('a personal proposal', () => {
  const personal: AddPersonalAction = {
    type: 'add_personal',
    amountMinor: '832266',
    currency: 'INR',
    description: 'spicy',
    category: 'food',
  };
  const initial = initialFields(personal, local, 'You');
  const resolveP = (fields: Partial<typeof initial>) =>
    resolveConfirm(personal, initial, { ...initial, ...fields }, local, 'You', 'an expense');

  it('opens as just for you', () => {
    expect(initial).toMatchObject({ personal: true, groupId: null, amountText: '8322.66' });
    expect(resolveP({})).toEqual({ ok: true, action: personal });
  });

  it('moved into a group, is paid by you and shared with the names given', () => {
    const result = resolveP({ personal: false, groupId: 'g2', personText: 'Renny' });
    expect(result).toEqual({
      ok: true,
      action: {
        type: 'add_expense',
        groupId: 'g2',
        amountMinor: '832266',
        currency: 'INR',
        description: 'spicy',
        category: 'food',
        paidByMemberId: 'n1',
        split: { mode: 'equal', shares: [{ memberId: 'n1' }, { memberId: 'n2' }] },
      },
    });
  });

  it('needs a group once it is no longer just for you', () => {
    expect(resolveP({ personal: false })).toEqual({ ok: false, reason: 'group' });
  });
});

describe('group tiles', () => {
  const activity = (id: string): number => ({ g1: 1, g2: 3, g3: 2 })[id] ?? 0;

  it('puts the chosen group first, then the rest by recency', () => {
    expect(orderGroupTiles(local.groups, 'g1', 'g1', activity).map((g) => g.id)).toEqual([
      'g1',
      'g2',
      'g3',
    ]);
  });

  it('does not reorder when another tile is selected', () => {
    expect(orderGroupTiles(local.groups, 'g1', 'g3', activity).map((g) => g.id)).toEqual([
      'g1',
      'g2',
      'g3',
    ]);
  });

  it('keeps a group picked from "Other group" visible', () => {
    const tiles = orderGroupTiles(local.groups, 'g1', 'g3', activity, 2);
    expect(tiles.map((g) => g.id)).toEqual(['g1', 'g3']);
  });
});
