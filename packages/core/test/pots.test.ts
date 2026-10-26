import { describe, expect, it } from 'vitest';
import {
  potBalances,
  potClosePlan,
  potPaymentLabel,
  normalisePotUtr,
  type PotInput,
} from '../src/pots';
import {
  SettlementStatus,
  type ExpenseSnapshot,
  type SettlementSnapshot,
} from '../src/balances/types';
import { buildPaymentUri, buildPaymentQrPayload } from '../src/settlement/rails';

const pot: PotInput = {
  id: 'p',
  currency: 'INR',
  treasurerMemberId: 't',
  memberIds: ['a', 'b', 't'],
  perHeadMinor: 100n,
};
const expense = {
  id: 'e',
  potId: 'p',
  currency: 'INR',
  amount: 180n,
  payers: { t: 180n },
  shares: { a: 60n, b: 120n },
  date: '2026-11-02',
} satisfies ExpenseSnapshot & { potId: string };
const contribution = (from = 'a', amount = 100n, status = SettlementStatus.Confirmed) =>
  ({
    id: from,
    potId: 'p',
    currency: 'INR',
    from,
    to: 't',
    amount,
    status,
    at: '2026-11-02',
  }) satisfies SettlementSnapshot & { potId: string };

describe('pots', () => {
  it('reuses statement reference patterns without accepting surrounding text', () => {
    expect(normalisePotUtr(' 123456789012 ')).toBe('123456789012');
    expect(normalisePotUtr('hdfcn52026101234567')).toBe('HDFCN52026101234567');
    expect(normalisePotUtr('12345678901')).toBeNull();
    expect(normalisePotUtr('UPI/123456789012')).toBeNull();
  });
  it('counts confirmed money, spending, refunds and top-ups exactly', () => {
    const transfers = [
      contribution(),
      contribution('b'),
      contribution('b', 20n),
      { ...contribution('t', 40n), to: 'a' },
      contribution('a', 999n, SettlementStatus.Initiated),
    ];
    const result = potBalances(pot, [expense], transfers);
    expect(result.balance).toBe(0n);
    expect(result.members.find((m) => m.memberId === 'a')).toMatchObject({
      paidIn: 100n,
      used: 60n,
      refunded: 40n,
      balance: 0n,
    });
    expect(potClosePlan(pot, [expense], transfers)).toEqual([]);
  });
  it('routes refunds and top-ups through the treasurer in pending status', () => {
    const balances = potBalances(pot, [expense], [contribution(), contribution('b')]);
    expect(balances.members.reduce((sum, member) => sum + member.balance, 0n)).toBe(0n);
    expect(balances.members.find((member) => member.memberId === 't')?.owes).toBe(20n);
    expect(potClosePlan(pot, [expense], [contribution(), contribution('b')])).toEqual([
      { from: 't', to: 'a', amount: 40n, currency: 'INR', status: 'initiated' },
      { from: 'b', to: 't', amount: 20n, currency: 'INR', status: 'initiated' },
    ]);
  });
  it('ignores unrelated pots, deleted expenses, and disputed payments', () => {
    const result = potBalances(
      pot,
      [
        { ...expense, deletedAt: 'today' },
        { ...expense, potId: 'other' },
      ],
      [{ ...contribution(), potId: 'other' }, contribution('b', 100n, SettlementStatus.Disputed)],
    );
    expect(result.balance).toBe(0n);
    expect(result.progress).toBe('0 of 2 paid in');
  });
  it('counts members reaching per-head amount, including multiple partial payments', () => {
    const p = { ...pot, memberIds: ['t', ...Array.from({ length: 8 }, (_, i) => `m${i}`)] };
    const paid = Array.from({ length: 6 }, (_, i) => contribution(`m${i}`));
    expect(potBalances(p, [], paid).progress).toBe('6 of 8 paid in');
    expect(potBalances(pot, [], [contribution('a', 50n), contribution('a', 50n)]).progress).toBe(
      '1 of 2 paid in',
    );
  });
  it('refuses non-treasurer spend and transfers bypassing the treasurer', () => {
    expect(() => potBalances(pot, [{ ...expense, payers: { a: 180n } }], [])).toThrow('POT_PAYER');
    expect(() => potBalances(pot, [], [{ ...contribution(), to: 'b' }])).toThrow(
      'INVALID_POT_SETTLEMENT',
    );
  });
  it('uses social confirmation copy', () => {
    expect(potPaymentLabel(false, 'Tara')).toBe('says paid · waiting for Tara');
    expect(potPaymentLabel(true, 'Tara')).toBe('Confirmed by Tara');
  });
  it('puts the reference in both tr and tn, with the same payload for QR', () => {
    const input = {
      railId: 'upi',
      handle: 'tara@bank',
      payeeName: 'Tara',
      currency: 'INR',
      amount: 10000n,
      referenceCode: 'abc123',
      note: 'Kitty & lunch',
    };
    const format = () => '100.00';
    const uri = buildPaymentUri(input, format)?.uri;
    expect(uri).toContain('tr=WV-abc123');
    expect(uri).toContain('tn=WV-abc123+Kitty+%26+lunch');
    expect(buildPaymentQrPayload(input, format)).toBe(uri);
    expect(buildPaymentUri({ ...input, referenceCode: undefined }, format)?.uri).not.toContain(
      'tr=',
    );
    expect(buildPaymentQrPayload({ ...input, currency: 'USD' }, format)).toBeNull();
  });
});
