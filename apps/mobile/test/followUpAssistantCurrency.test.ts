import { describe, expect, it } from 'vitest';
import { currencyForCountry } from '@waves/core';

import { applyAnswer, deviceCurrencyFor, toGroupWrite, type SavedState } from '@/lib/followUpApply';
import { parseVoiceExpenses } from '@/lib/voiceExpense';
import type { AgentExpenseWrite } from '@/lib/voiceAgentPlan';

const personal = (over: Partial<SavedState> = {}): SavedState => ({
  kind: 'personal',
  id: 'p1',
  groupId: null,
  description: 'Shoes',
  amount: 800000n,
  currency: 'INR',
  category: 'shopping',
  categoryStated: true,
  date: '2026-10-21',
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

describe('assistant currency application', () => {
  it('CU-01 suggests AED for an INR expense in AE because both use two decimals', () => {
    expect(deviceCurrencyFor('AE', 'INR')).toBe('AED');
  });
  it('CU-02 rejects JPY for INR because their exponents differ', () => {
    expect(deviceCurrencyFor('JP', 'INR')).toBeNull();
  });
  it('CU-03 returns INR when device and expense currencies already match', () => {
    expect(deviceCurrencyFor('IN', 'INR')).toBe('INR');
  });
  it('CU-04 returns null for an unknown or absent country', () => {
    expect(deviceCurrencyFor('ZZ', 'INR')).toBeNull();
    expect(deviceCurrencyFor(null, 'INR')).toBeNull();
  });
  it('CU-05 maps lowercase country codes through currencyForCountry', () => {
    expect(currencyForCountry('ae')).toBe('AED');
    expect(deviceCurrencyFor('ae', 'INR')).toBe('AED');
  });
  it('CU-06 uppercases the currency answer and preserves every other field including amount', () => {
    const before = personal();
    // Relabel ₹8,000 as AED 8,000; this answer deliberately performs no FX conversion.
    expect(applyAnswer(before, { kind: 'currency', currency: 'aed' })).toEqual({
      ...before,
      currency: 'AED',
    });
    expect(before.currency).toBe('INR');
    expect(before.amount).toBe(800000n);
  });
  it('CU-09 leaves a foreign-currency group write without a rate for the hook to resolve', () => {
    // Goa trip and the original expense are INR; the answer changes the expense to AED.
    const base: AgentExpenseWrite & { fx: null } = {
      expenseId: 'g-e1',
      description: 'Dinner',
      category: 'food',
      expenseDate: '2026-10-21',
      currency: 'INR',
      amount: 800000n,
      splitParams: { kind: 'equal' },
      participants: ['m-me', 'm-anu', 'm-ravi'],
      payers: { 'm-me': 800000n },
      expectedShares: { 'm-me': 266667n, 'm-anu': 266667n, 'm-ravi': 266666n },
      fx: null,
    };
    const state = applyAnswer(
      personal({
        kind: 'group',
        id: 'g-e1',
        groupId: 'g-goa',
        payers: base.payers,
        participants: base.participants,
      }),
      { kind: 'currency', currency: 'aed' },
    );
    // toGroupWrite carries the base FX state; the persistence hook supplies pending FX.
    const write = toGroupWrite(base, state);
    expect(write).toHaveProperty('fx', null);
    // The currency question is only asked for personal entries (SC-CUR-03), so a group write keeps
    // the group's own currency and amount; any FX for a foreign currency is the hook's job.
    expect(write).toMatchObject({ currency: 'INR', amount: 800000n });
    expect(write.expectedShares).toEqual(base.expectedShares);
    expect(write.payers).toEqual(base.payers);
  });
  it('CU-10 reads Hinglish and lakh amounts into exact INR minor units', () => {
    // The shipping parser is the mobile one; core parseVoiceIntent does not fold "1 lakh".
    const groups: never[] = [];
    for (const [text, minor] of [
      ['dedh hazaar rupaye lunch', 150000n],
      ['sava sau rupaye lunch', 12500n],
      ['paune do sau rupaye lunch', 17500n],
      ['2.5k rupees lunch', 250000n],
      ['1 lakh rupees lunch', 10000000n],
      ['do lakh rupaye lunch', 20000000n],
    ] as const) {
      const items = parseVoiceExpenses(text, groups).items;
      expect(items, text).toHaveLength(1);
      expect(items[0]!.amountMinor, text).toBe(minor);
    }
  });
});
