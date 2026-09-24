import { describe, expect, it } from 'vitest';

import {
  emptyMirror,
  enqueue,
  materialiseExpenses,
  MutationKind,
  type ExpenseCreatePayload,
} from '../src/index.js';

const GROUP = 'goa';
const FX = { rate: '92.5', from: 'EUR', to: 'INR', source: 'bill' };

describe('a queued expense keeps its rate and receipt', () => {
  it('carries fx and receipt_id into the pending version an edit is built from', () => {
    // A foreign bill with a saved rate and a receipt, still unsent — the next
    // edit (a pop-up change of date, say) loads from this pending version.
    const payload = {
      expenseId: 'e-museum',
      description: 'Louvre',
      expenseDate: '2026-09-01',
      currency: 'EUR',
      amount: '4000',
      splitParams: { kind: 'equal' },
      participants: ['m-a', 'm-b'],
      payers: { 'm-a': '4000' },
      fx: FX,
      receiptId: 'r-1',
    } as unknown as ExpenseCreatePayload;
    const queue = enqueue([], {
      clientMutationId: 'cm-1',
      kind: MutationKind.ExpenseUpdate,
      groupId: GROUP,
      clientCreatedAt: '2026-09-01T00:00:00.000Z',
      payload,
    });

    const [expense] = materialiseExpenses(emptyMirror(), queue, { groupId: GROUP });
    expect(expense?.currentVersion?.fx).toEqual(FX);
    expect(expense?.currentVersion?.receipt_id).toBe('r-1');
  });
});
