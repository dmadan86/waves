import { describe, expect, it } from 'vitest';

import { CategoryId, SmsKind, SmsOtherReason } from '@waves/core';

import { quickCategoryPicks, transactionBadge } from '@/lib/smsMessageDetail';

describe('quickCategoryPicks', () => {
  it('puts the guessed category first, then fills with the defaults', () => {
    expect(quickCategoryPicks(CategoryId.Health)).toEqual([
      CategoryId.Health,
      CategoryId.Food,
      CategoryId.Shopping,
    ]);
  });

  it('never repeats a category that is already a default', () => {
    expect(quickCategoryPicks(CategoryId.Shopping)).toEqual([
      CategoryId.Shopping,
      CategoryId.Food,
      CategoryId.Travel,
    ]);
  });

  it('falls back to the plain defaults when nothing was guessed', () => {
    expect(quickCategoryPicks(null)).toEqual([
      CategoryId.Food,
      CategoryId.Shopping,
      CategoryId.Travel,
    ]);
  });

  it('is always three or fewer, never the fourth "More" slot', () => {
    expect(quickCategoryPicks(CategoryId.Gifts)).toHaveLength(3);
  });
});

describe('transactionBadge', () => {
  it('reads a plain expense as a debit', () => {
    expect(transactionBadge({ kind: SmsKind.Expense, reason: null })).toBe('debit');
  });

  it('reads a plain income as a credit', () => {
    expect(transactionBadge({ kind: SmsKind.Income, reason: null })).toBe('credit');
  });

  it('prefers refund over the kind it was classified as', () => {
    expect(transactionBadge({ kind: SmsKind.Other, reason: SmsOtherReason.Refund })).toBe('refund');
  });

  it('names a credit card bill', () => {
    expect(transactionBadge({ kind: SmsKind.Other, reason: SmsOtherReason.CardBill })).toBe(
      'card-bill',
    );
  });

  it('names an ATM withdrawal', () => {
    expect(transactionBadge({ kind: SmsKind.Other, reason: SmsOtherReason.CashWithdrawal })).toBe(
      'atm',
    );
  });

  it('says nothing new for a wallet top-up — the reason chip already covers it', () => {
    expect(
      transactionBadge({ kind: SmsKind.Other, reason: SmsOtherReason.WalletTopUp }),
    ).toBeNull();
  });

  it('says nothing new for an investment buy', () => {
    expect(transactionBadge({ kind: SmsKind.Other, reason: SmsOtherReason.Investment })).toBeNull();
  });

  it('says nothing new for a self-transfer', () => {
    expect(
      transactionBadge({ kind: SmsKind.Other, reason: SmsOtherReason.SelfTransfer }),
    ).toBeNull();
  });
});
