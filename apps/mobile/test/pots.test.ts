import { describe, expect, it } from 'vitest';
import {
  balanceSums,
  computeNetBalances,
  SettlementStatus,
  type PotExpense,
  type PotSettlement,
} from '@waves/core';
import {
  partitionPotLedger,
  potContributionStatusLabel,
  potExpensePayers,
  potMoney,
  potPersonLabel,
  potSummaryLabel,
} from '../src/lib/pots';

const pot = {
  id: 'pot',
  currency: 'INR',
  treasurerMemberId: 'ravi',
  memberIds: ['ravi', 'a', 'b'],
  perHeadMinor: 10000n,
  status: 'open' as const,
  treasurerName: 'Ravi',
};
const expense: PotExpense = {
  id: 'lunch',
  potId: 'pot',
  currency: 'INR',
  amount: 12000n,
  date: '2026-11-02',
  payers: { ravi: 12000n },
  shares: { a: 6000n, b: 6000n },
};
const contribution: PotSettlement = {
  id: 'paid',
  potId: 'pot',
  from: 'a',
  to: 'ravi',
  currency: 'INR',
  amount: 10000n,
  status: SettlementStatus.Confirmed,
  at: '2026-11-02',
};

describe('pot copy', () => {
  it('formats compact summaries, fractional money and negative balances', () => {
    expect(potSummaryLabel(640000n, '6 of 8 paid in', 'Ravi', 'INR')).toBe(
      '₹6,400 in the pot · 6 of 8 paid in · Ravi holds the money',
    );
    expect(potMoney(12345n, 'INR')).toBe('₹123.45');
    expect(potMoney(-100n, 'INR')).toBe('-₹1');
    expect(potMoney(100n, 'JPY')).toContain('100');
  });
  it('shows refunds and top-ups per person including zero', () => {
    expect(potPersonLabel({ paidIn: 10000n, used: 6000n, getsBack: 4000n, owes: 0n }, 'INR')).toBe(
      'paid ₹100 · used ₹60 · gets back ₹40',
    );
    expect(potPersonLabel({ paidIn: 0n, used: 6000n, getsBack: 0n, owes: 6000n }, 'INR')).toBe(
      'paid ₹0 · used ₹60 · owes ₹60',
    );
  });
  it('requires social confirmation regardless of reference capture', () => {
    expect(potContributionStatusLabel('initiated', 'Tara')).toBe('says paid · waiting for Tara');
    expect(potContributionStatusLabel('confirmed', 'Tara')).toBe('Confirmed by Tara');
    expect(potContributionStatusLabel('auto_confirmed', 'Tara')).toBe('Confirmed by Tara');
    expect(potContributionStatusLabel('cancelled', 'Tara')).toBe('Cancelled');
    expect(potContributionStatusLabel('disputed', 'Tara')).toBe('Disputed by Tara');
  });
});

describe('pot ledger partition for balances and settle-up', () => {
  it('removes open-pot items before netting, keeping one separate summary', () => {
    const ordinary = { ...expense, id: 'ordinary', potId: null };
    const pending = {
      ...contribution,
      id: 'pending',
      from: 'b',
      status: SettlementStatus.Initiated,
    };
    const result = partitionPotLedger([pot], [expense, ordinary], [contribution, pending]);
    expect(result.expenses).toEqual([ordinary]);
    expect(result.settlements).toEqual([]);
    expect(result.potLines).toHaveLength(1);
    expect(result.potLines[0]).toMatchObject({
      label: 'In the pot, held by Ravi',
      balance: -2000n,
      progress: '1 of 2 paid in',
    });
    expect([
      ...balanceSums(computeNetBalances(result.expenses, result.settlements)).values(),
    ]).toEqual([0n]);
    expect(result.potLines[0]!.members.reduce((n, m) => n + m.balance, 0n)).toBe(0n);
  });
  it.each(['closed', 'carried'] as const)(
    'restores %s pot items to ordinary settling',
    (status) => {
      const result = partitionPotLedger([{ ...pot, status }], [expense], [contribution]);
      expect(result.expenses).toEqual([expense]);
      expect(result.settlements).toEqual([contribution]);
      expect(result.potLines).toEqual([]);
    },
  );
  it('keeps unknown pot links and handles deleted expenses and empty pots', () => {
    const unknown = { ...expense, potId: 'unknown' };
    const result = partitionPotLedger([pot], [unknown, { ...expense, deletedAt: 'today' }], []);
    expect(result.expenses).toEqual([unknown]);
    expect(result.potLines[0]!.balance).toBe(0n);
    expect(partitionPotLedger([], [], []).potLines).toEqual([]);
  });
  it('creates a line per open pot without pooling currencies or treasurers', () => {
    const second = { ...pot, id: 'second', currency: 'USD', treasurerName: 'Tara' };
    const result = partitionPotLedger([pot, second], [], []);
    expect(result.potLines.map((line) => line.label)).toEqual([
      'In the pot, held by Ravi',
      'In the pot, held by Tara',
    ]);
  });
});

describe('spend from pot payer lock', () => {
  const row = { id: 'pot', status: 'open' as const, currency: 'INR', treasurer_member_id: 'ravi' };
  it('locks the whole payment to the treasurer', () => {
    expect(potExpensePayers(row, 123n, 'INR')).toEqual({ potId: 'pot', payers: { ravi: 123n } });
  });
  it('rejects closed pots, other currencies and invalid amounts', () => {
    expect(() => potExpensePayers({ ...row, status: 'closed' }, 100n, 'INR')).toThrow(
      'POT_NOT_OPEN',
    );
    expect(() => potExpensePayers(row, 100n, 'USD')).toThrow('POT_INVALID_EXPENSE');
    expect(() => potExpensePayers(row, 0n, 'INR')).toThrow('POT_INVALID_EXPENSE');
  });
});
