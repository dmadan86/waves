import { describe, expect, it } from 'vitest';

import type { AgentLocalData } from '@/lib/voiceAgentPlan';
import { editedAction, listFooter, rowEditFrom, type CardStatus } from '@/lib/voiceAgentListPure';
import type { AddExpenseAction, AddPersonalAction } from '@/lib/voiceConfirmPure';

const local: AgentLocalData = {
  groups: [
    {
      id: 'g1',
      name: 'Home',
      currency: 'INR',
      members: [
        { id: 'm1', name: 'Madan', isViewer: true },
        { id: 'm2', name: 'Ravi', isViewer: false },
      ],
    },
  ],
} as AgentLocalData;
const expense: AddExpenseAction = {
  type: 'add_expense',
  groupId: 'g1',
  amountMinor: '800000',
  currency: 'INR',
  description: 'Groceries',
  paidByMemberId: 'm1',
  split: { mode: 'equal', shares: [{ memberId: 'm1' }, { memberId: 'm2' }] },
};
const personal: AddPersonalAction = {
  type: 'add_personal',
  amountMinor: '5000',
  currency: 'INR',
  description: 'Tea',
};

describe('an agent row is its amount and words', () => {
  it('AL-01: the row starts as the proposal states it', () => {
    expect(rowEditFrom(expense, local, 'You')).toEqual({
      amountText: '8000',
      description: 'Groceries',
    });
  });

  it('AL-02: a new amount keeps the group, payer and people; an exact split falls back to equal', () => {
    const edited = editedAction(expense, local, 'You', 'an expense', {
      amountText: '9000',
      description: 'Groceries',
    });
    expect(edited).toMatchObject({
      type: 'add_expense',
      groupId: 'g1',
      amountMinor: '900000',
      paidByMemberId: 'm1',
    });
    const exact: AddExpenseAction = {
      ...expense,
      split: {
        mode: 'exact',
        shares: [
          { memberId: 'm1', value: '300000' },
          { memberId: 'm2', value: '500000' },
        ],
      },
    };
    const changed = editedAction(exact, local, 'You', 'an expense', {
      amountText: '9000',
      description: 'Groceries',
    });
    expect(changed && changed.type === 'add_expense' && changed.split.mode).toBe('equal');
  });

  it('AL-03: new words replace the description; empty words fall back to the note', () => {
    expect(
      editedAction(expense, local, 'You', 'an expense', {
        amountText: '8000',
        description: 'Veg and fruit',
      }),
    ).toMatchObject({ description: 'Veg and fruit' });
    expect(
      editedAction(personal, local, 'You', 'an expense', { amountText: '50', description: '  ' }),
    ).toMatchObject({ type: 'add_personal', description: 'an expense' });
  });

  it('AL-04: an amount that is not a number leaves the row unwritable', () => {
    for (const amountText of ['', 'abc', '0'])
      expect(
        editedAction(expense, local, 'You', 'an expense', { amountText, description: 'x' }),
      ).toBeNull();
  });

  it('AL-05: a group the local data no longer has does not fail the row on its own', () => {
    const orphan = { ...expense, groupId: 'gone' };
    expect(
      editedAction(orphan, local, 'You', 'an expense', { amountText: '9000', description: 'x' }),
    ).toEqual(orphan);
  });
});

describe('the list has one footer button', () => {
  const row = (status: CardStatus, problem = false) => ({ status, problem });

  it('AL-06: no rows, no button', () => {
    expect(listFooter([]).kind).toBe('none');
  });

  it('AL-07: Add counts the rows still to write, skipping problems; failed rows stay in', () => {
    expect(listFooter([row('pending'), row('pending'), row('done')])).toMatchObject({
      kind: 'add',
      count: 2,
      disabled: false,
    });
    expect(listFooter([row('pending'), row('failed'), row('pending', true)])).toMatchObject({
      kind: 'add',
      count: 2,
    });
  });

  it('AL-08: nothing to add, or a write in flight, disables it - never a second write', () => {
    expect(listFooter([row('pending', true), row('done')]).disabled).toBe(true);
    expect(listFooter([row('running'), row('pending')]).disabled).toBe(true);
  });

  it('AL-09: once every row is added or dropped it is Done, with Add another only after an add', () => {
    expect(listFooter([row('done'), row('discarded')])).toMatchObject({
      kind: 'done',
      addAnother: true,
    });
    expect(listFooter([row('discarded')])).toMatchObject({ kind: 'done', addAnother: false });
  });
});
