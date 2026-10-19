import { describe, expect, it } from 'vitest';
import { decodeTxn } from '@waves/core';

import {
  applyAnswer,
  chipLabel,
  deviceCurrencyFor,
  factsFor,
  paymentChoices,
  planUpdate,
  savedStateFrom,
  toGroupPayment,
  toGroupWrite,
  toPersonalData,
  type SavedState,
} from '@/lib/followUpApply';
import type { AgentExpenseWrite } from '@/lib/voiceAgentPlan';

const personal = (over: Partial<SavedState> = {}): SavedState => ({
  kind: 'personal',
  id: 'p1',
  groupId: null,
  description: 'shoes',
  amount: 800000n,
  currency: 'INR',
  category: 'shopping',
  categoryStated: false,
  date: '2026-10-19',
  notes: null,
  place: null,
  location: null,
  paymentMethod: null,
  payers: null,
  hasReceipt: false,
  reimbursable: false,
  participants: [],
  ...over,
});
const group = (over: Partial<SavedState> = {}): SavedState =>
  personal({
    kind: 'group',
    id: 'g-e1',
    groupId: 'g1',
    payers: { m1: 800000n },
    participants: ['m1', 'm2'],
    ...over,
  });

const write: AgentExpenseWrite = {
  expenseId: 'g-e1',
  description: 'dinner',
  category: 'food',
  expenseDate: '2026-10-19',
  currency: 'INR',
  amount: 800000n,
  splitParams: { kind: 'equal' },
  participants: ['m1', 'm2'],
  payers: { m1: 800000n },
  expectedShares: { m1: 400000n, m2: 400000n },
};

describe('applyAnswer', () => {
  it('a personal place is a name on the entry', () => {
    const s = applyAnswer(personal(), { kind: 'place', name: ' Phoenix Mall ' });
    expect(s.place).toBe('Phoenix Mall');
    expect(s.location).toBeNull();
  });
  it('a group place with a pin becomes the expense location', () => {
    const s = applyAnswer(group(), { kind: 'place', name: 'Taj', coords: { lat: 1, lng: 2 } });
    expect(s.location).toEqual({ lat: 1, lng: 2, name: 'Taj' });
    expect(s.notes).toBeNull();
  });
  it('a group place without a pin travels in the notes, keeping what was there', () => {
    const s = applyAnswer(group({ notes: 'with team' }), { kind: 'place', name: 'Taj' });
    expect(s.notes).toBe('with team · At Taj');
    expect(s.location).toBeNull();
  });
  it('payment, category, date, currency', () => {
    expect(applyAnswer(personal(), { kind: 'payment', method: 'upi' }).paymentMethod).toBe('upi');
    const c = applyAnswer(personal(), { kind: 'category', category: 'food' });
    expect([c.category, c.categoryStated]).toEqual(['food', true]);
    expect(applyAnswer(personal(), { kind: 'date', date: '2026-10-18' }).date).toBe('2026-10-18');
    expect(applyAnswer(personal(), { kind: 'currency', currency: 'aed' }).currency).toBe('AED');
  });
  it('the payer takes the whole amount, group only', () => {
    expect(applyAnswer(group(), { kind: 'payer', memberId: 'm2' }).payers).toEqual({ m2: 800000n });
    expect(applyAnswer(personal(), { kind: 'payer', memberId: 'm2' })).toEqual(personal());
  });
  it('work sets the real flag, on a personal entry and a group expense alike', () => {
    const p = applyAnswer(applyAnswer(personal(), { kind: 'work' }), { kind: 'work' });
    expect(p.reimbursable).toBe(true);
    expect(p.description).toBe('shoes');
    expect(decodeTxn('p1', toPersonalData(p)).reimbursable).toBe(true);
    const g = applyAnswer(group(), { kind: 'work' });
    expect(g.reimbursable).toBe(true);
    // No more "Work expense" line in the notes.
    expect(g.notes).toBeNull();
    expect(toGroupWrite(write, g).reimbursable).toBe(true);
    expect(toGroupWrite(write, group()).reimbursable).toBe(false);
  });
  it('a blank place changes nothing', () => {
    const s = personal();
    expect(applyAnswer(s, { kind: 'place', name: '  ' })).toBe(s);
  });
});

describe('writes', () => {
  it('personal data round-trips through the ledger codec', () => {
    const s = applyAnswer(applyAnswer(personal(), { kind: 'place', name: 'Mall' }), {
      kind: 'payment',
      method: 'card',
    });
    const txn = decodeTxn('p1', toPersonalData(s));
    expect(txn).toMatchObject({
      amount: 800000n,
      place: 'Mall',
      paymentMethod: 'card',
      note: 'shoes',
    });
  });
  it('a group write carries the answers on top of the original', () => {
    const s = applyAnswer(
      applyAnswer(group({ category: 'food' }), { kind: 'payer', memberId: 'm2' }),
      { kind: 'payment', method: 'card' },
    );
    const w = toGroupWrite(write, s);
    expect(w.payers).toEqual({ m2: 800000n });
    expect(w.paymentMethod).toBe('credit');
    expect(w.expectedShares).toEqual(write.expectedShares);
    expect(w.participants).toEqual(['m1', 'm2']);
  });
  it('payment lists and mapping', () => {
    expect(paymentChoices('personal')).toEqual(['cash', 'upi', 'card']);
    expect(paymentChoices('group')).not.toContain('card');
    expect(toGroupPayment('bank')).toBeNull();
  });
});

describe('savedStateFrom / factsFor', () => {
  it('a personal add with no stated category is a guess', () => {
    const s = savedStateFrom(
      { type: 'add_personal', description: ' misc ', amountMinor: '5000', currency: 'INR' },
      null,
      'p9',
      '2026-10-19',
    );
    expect(s).toMatchObject({
      kind: 'personal',
      description: 'misc',
      categoryStated: false,
      date: '2026-10-19',
    });
  });
  it('facts: receipts only for a group, payer is me', () => {
    expect(factsFor(personal(), null, null, null).canAttachReceipt).toBe(false);
    const facts = factsFor(group(), { name: 'Goa', members: [] }, 'm1', 'm1');
    expect(facts).toMatchObject({
      canAttachReceipt: true,
      payerIsMe: true,
      splitParticipantCount: 2,
      groupName: 'Goa',
    });
    expect(factsFor(personal({ place: 'x' }), null, null, null).hasPlace).toBe(true);
  });
});

describe('deviceCurrencyFor', () => {
  it('maps the country, only when the minor units match', () => {
    expect(deviceCurrencyFor('AE', 'INR')).toBe('AED');
    expect(deviceCurrencyFor('IN', 'INR')).toBe('INR');
    expect(deviceCurrencyFor('JP', 'INR')).toBeNull();
    expect(deviceCurrencyFor(null, 'INR')).toBeNull();
  });
});

describe('planUpdate', () => {
  it('turns a typed answer into answers, a receipt intent, or a share', () => {
    const p = planUpdate(
      { expenseId: 'g-e1', place: 'Taj', paymentMethod: 'card', wantsReceipt: true },
      group(),
    );
    expect(p.answers).toEqual([
      { kind: 'place', name: 'Taj' },
      { kind: 'payment', method: 'credit' },
    ]);
    expect(p.wantsReceipt).toBe(true);
  });
  it('a personal entry has no receipt, a group expense cannot be shared from here', () => {
    expect(planUpdate({ expenseId: 'p1', wantsReceipt: true }, personal()).wantsReceipt).toBe(
      false,
    );
    const split = { groupId: 'g1', memberIds: ['m2'] };
    expect(planUpdate({ expenseId: 'p1', splitWith: split }, personal()).splitWith).toEqual(split);
    expect(planUpdate({ expenseId: 'g-e1', splitWith: split }, group()).splitWith).toBeNull();
  });
});

describe('MC-FU-16..20 (pure helpers)', () => {
  it('MC-FU-16 savedStateFrom: add_personal guesses a category; add_expense uses the write', () => {
    const p = savedStateFrom(
      { type: 'add_personal', description: 'pizza', amountMinor: '45000', currency: 'INR' },
      null,
      'p1',
      '2026-10-21',
    );
    expect(p).toMatchObject({ kind: 'personal', category: 'food', categoryStated: false });
    const g = savedStateFrom(
      {
        type: 'add_expense',
        groupId: 'g1',
        description: 'dinner',
        amountMinor: '800000',
        currency: 'INR',
        paidByMemberId: 'm1',
        split: { mode: 'equal', shares: [{ memberId: 'm1' }, { memberId: 'm2' }] },
      },
      write,
      'g-e1',
      '2026-10-21',
    );
    expect(g).toMatchObject({
      kind: 'group',
      groupId: 'g1',
      category: 'food',
      categoryStated: true,
      payers: { m1: 800000n },
      participants: ['m1', 'm2'],
    });
  });

  it('MC-FU-17 toGroupPayment maps card to credit, keeps forex, drops wallet', () => {
    expect(toGroupPayment('card')).toBe('credit');
    expect(toGroupPayment('forex')).toBe('forex');
    expect(toGroupPayment('wallet')).toBeNull();
    expect(toGroupWrite(write, group({ paymentMethod: 'wallet' })).paymentMethod).toBeNull();
  });

  it('MC-FU-18 a place on a group is a pin with coordinates, a note without, and never twice', () => {
    const pinned = applyAnswer(group(), { kind: 'place', name: 'Taj', coords: { lat: 1, lng: 2 } });
    expect(pinned.location).toEqual({ lat: 1, lng: 2, name: 'Taj' });
    expect(pinned.notes).toBeNull();
    const noted = applyAnswer(group(), { kind: 'place', name: 'Taj' });
    expect(noted.notes).toBe('At Taj');
    expect(applyAnswer(noted, { kind: 'place', name: 'Taj' }).notes).toBe('At Taj');
  });

  it('MC-FU-19 work: a personal entry is flagged, a group expense is noted', () => {
    expect(applyAnswer(personal(), { kind: 'work' }).reimbursable).toBe(true);
    expect(applyAnswer(group(), { kind: 'work' }).notes).toBe('Work expense');
  });

  it('MC-FU-20 planUpdate ignores splitWith for a group and wantsReceipt for personal', () => {
    const split = { groupId: 'g1', memberIds: ['m2'] };
    expect(planUpdate({ expenseId: 'g-e1', splitWith: split }, group()).splitWith).toBeNull();
    expect(planUpdate({ expenseId: 'p1', wantsReceipt: true }, personal()).wantsReceipt).toBe(
      false,
    );
  });
});

describe('chipLabel', () => {
  it('cuts at 24 characters with an ellipsis and leaves short labels alone', () => {
    expect(chipLabel('Blue Tokai')).toBe('Blue Tokai');
    expect(chipLabel('The Very Long Named Cafe And Roastery')).toBe('The Very Long Named Caf…');
    expect([...chipLabel('x'.repeat(40))]).toHaveLength(24);
  });
});
