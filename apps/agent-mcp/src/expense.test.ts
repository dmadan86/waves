import { describe, expect, it } from 'vitest';

import { buildExpenseWriteBody, splitParamsFor } from './expense.js';

describe('MCP expense-write payloads', () => {
  it('defaults omitted currency from the group for rider/traveller splits', () => {
    const body = buildExpenseWriteBody(
      {
        groupId: 'group-1',
        description: 'Airport cab',
        amount: '12000',
        paidBy: 'financer-member',
        participants: ['rider-member', 'traveller-member'],
        split: { kind: 'exact', amounts: { 'rider-member': '7000', 'traveller-member': '5000' } },
      },
      {
        expenseId: 'expense-1',
        clientMutationId: 'mutation-1',
        today: '2026-09-07',
        groupCurrency: 'inr',
      },
    );

    expect(body.currency).toBe('INR');
    expect(body.payers).toEqual({ 'financer-member': '12000' });
    expect(body.participants).toEqual(['rider-member', 'traveller-member']);
    expect(body.splitParams).toEqual({
      kind: 'exact',
      amounts: { 'rider-member': '7000', 'traveller-member': '5000' },
    });
  });

  it('keeps an explicit expense currency over the group default', () => {
    const body = buildExpenseWriteBody(
      {
        groupId: 'group-1',
        description: 'Hotel',
        amount: '5000',
        currency: 'usd',
        paidBy: 'financer-member',
        participants: ['traveller-member'],
      },
      {
        expenseId: 'expense-1',
        clientMutationId: 'mutation-1',
        today: '2026-09-07',
        groupCurrency: 'INR',
      },
    );

    expect(body.currency).toBe('USD');
    expect(body.splitParams).toEqual({ kind: 'equal' });
  });

  it('maps share splits without changing weights', () => {
    expect(
      splitParamsFor({ kind: 'shares', weights: { 'rider-member': 2, 'traveller-member': 1 } }),
    ).toEqual({ kind: 'shares', weights: { 'rider-member': 2, 'traveller-member': 1 } });
  });
});
