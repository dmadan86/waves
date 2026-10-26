import { describe, expect, it } from 'vitest';
import { SettlementStatus } from '@waves/core';
import {
  optionalPotUtr,
  potInput,
  potSettlements,
  upiReference,
  tagPotLedger,
} from '../src/lib/potUi';
import type { PotWithContributions } from '@waves/api-client';
const pot: PotWithContributions = {
  id: 'pot',
  group_id: 'group',
  name: 'Trip',
  currency: 'INR',
  per_head_minor: '9007199254740993',
  treasurer_member_id: 'ravi',
  status: 'open',
  carried_from_pot_id: null,
  created_by: 'ravi',
  created_at: '2026-11-02',
  closed_at: null,
  pay_code: 'abcdefghijk',
  contributions: [
    {
      id: 's',
      pot_id: 'pot',
      from_member_id: 'a',
      to_member_id: 'ravi',
      currency: 'INR',
      amount: '9007199254740993',
      status: 'initiated',
      reference: '123456789012',
      reference_source: 'intent',
      initiated_at: '2026-11-02',
      confirmed_at: null,
    },
  ],
};
describe('pot presentation adapters', () => {
  it('preserves exact minor units and self-report status regardless of reference source', () => {
    expect(potInput(pot, ['a', 'ravi']).perHeadMinor).toBe(9007199254740993n);
    expect(potSettlements(pot)[0]).toMatchObject({
      potId: 'pot',
      amount: 9007199254740993n,
      status: SettlementStatus.Initiated,
    });
  });
  it('accepts omission, normalises UTRs and rejects arbitrary text', () => {
    expect(optionalPotUtr('  ')).toEqual({ valid: true, reference: null });
    expect(optionalPotUtr(' 123456789012 ')).toEqual({ valid: true, reference: '123456789012' });
    expect(optionalPotUtr('paid trust me').valid).toBe(false);
  });
  it('only extracts a reference from callback results', () => {
    expect(upiReference(null)).toBe('');
    expect(upiReference({ utr: ' 123456789012 ', txnRef: 'other' })).toBe('123456789012');
    expect(upiReference({ utr: '', txnRef: ' ref ' })).toBe('ref');
    expect(upiReference({})).toBe('');
  });
});

describe('legacy mirror pot tagging', () => {
  it('restores missing tags before open-pot filtering without tagging ordinary rows', () => {
    const tagged = tagPotLedger(
      [pot],
      { expense: pot.id },
      [{ id: 'expense' }, { id: 'ordinary' }],
      [{ id: 's' }, { id: 'other' }],
    );
    expect(tagged.expenses).toEqual([
      { id: 'expense', potId: 'pot' },
      { id: 'ordinary', potId: undefined },
    ]);
    expect(tagged.settlements).toEqual([
      { id: 's', potId: 'pot' },
      { id: 'other', potId: undefined },
    ]);
  });
  it('keeps tags already supplied by a newer mirror', () => {
    const tagged = tagPotLedger(
      [],
      {},
      [{ id: 'expense', potId: 'known' }],
      [{ id: 's', potId: 'known' }],
    );
    expect(tagged.expenses[0].potId).toBe('known');
    expect(tagged.settlements[0].potId).toBe('known');
  });
});
