/**
 * "Complete this expense": rebuilding the assistant's picture of a saved bill.
 */

import { describe, expect, it } from 'vitest';

import type { ExpenseVersionRow } from '../src/data/types';
import {
  completeGaps,
  groupWriteFromRow,
  rowHasReceipt,
  savedStateFromRow,
} from '../src/lib/assistantComplete';

const version = (over: Partial<ExpenseVersionRow> = {}): ExpenseVersionRow =>
  ({
    id: 'v2',
    version_no: 2,
    description: 'Beach shack dinner',
    category: 'food',
    category_meta: null,
    expense_date: '2026-10-18',
    currency: 'INR',
    amount: '120000',
    split_type: 'equal',
    split_params: { kind: 'equal' },
    author_member_id: 'm1',
    notes: null,
    payment_method: null,
    receipt_share_url: null,
    receipt_id: null,
    location: null,
    fx: null,
    created_at: '2026-10-18T12:00:00Z',
    payers: [{ member_id: 'm1', amount: '120000' }],
    shares: [
      { member_id: 'm1', amount: '40000' },
      { member_id: 'm2', amount: '40000' },
      { member_id: 'm3', amount: '40000' },
    ],
    payee: 'Shack owner',
    ...over,
  }) as ExpenseVersionRow;

describe('completeGaps', () => {
  it('lists place, payment and receipt when none is there, in the order they are asked', () => {
    expect(completeGaps(version(), false)).toEqual(['place', 'payment', 'receipt']);
  });

  it('drops each as it is filled', () => {
    expect(completeGaps(version({ location: { lat: 1, lng: 2, name: 'Shack' } }), false)).toEqual([
      'payment',
      'receipt',
    ]);
    expect(completeGaps(version({ payment_method: 'upi' }), false)).toEqual(['place', 'receipt']);
    expect(completeGaps(version({ receipt_id: 'r1' }), false)).toEqual(['place', 'payment']);
    expect(completeGaps(version({ receipt_share_url: 'https://x' }), false)).toEqual([
      'place',
      'payment',
    ]);
    expect(completeGaps(version(), true)).toEqual(['place', 'payment']);
  });

  it('is empty for a complete bill, so the row is not drawn', () => {
    const full = version({
      location: { lat: 1, lng: 2, name: 'Shack' },
      payment_method: 'cash',
      receipt_id: 'r1',
    });
    expect(completeGaps(full, false)).toEqual([]);
  });

  it('counts a legacy bill as a receipt', () => {
    expect(rowHasReceipt(version(), true)).toBe(true);
    expect(rowHasReceipt(version(), false)).toBe(false);
  });
});

describe('savedStateFromRow', () => {
  it('carries the bill’s own facts as a group expense', () => {
    const state = savedStateFromRow({
      groupId: 'g1',
      expenseId: 'e1',
      version: version({ notes: 'with sea view', location: { lat: 1, lng: 2, name: 'Shack' } }),
      hasLegacyReceipt: false,
    });
    expect(state).toMatchObject({
      kind: 'group',
      id: 'e1',
      groupId: 'g1',
      description: 'Beach shack dinner',
      amount: 120000n,
      currency: 'INR',
      category: 'food',
      categoryStated: true,
      date: '2026-10-18',
      notes: 'with sea view',
      place: 'Shack',
      paymentMethod: null,
      hasReceipt: false,
      reimbursable: false,
      participants: ['m1', 'm2', 'm3'],
    });
    expect(state.payers).toEqual({ m1: 120000n });
  });

  it('leaves out a member whose share is nothing', () => {
    const state = savedStateFromRow({
      groupId: 'g1',
      expenseId: 'e1',
      version: version({
        shares: [
          { member_id: 'm1', amount: '120000' },
          { member_id: 'm2', amount: '0' },
        ],
      }),
      hasLegacyReceipt: false,
    });
    expect(state.participants).toEqual(['m1']);
  });

  it('is not "stated" when there is no category, and reads the legacy receipt', () => {
    const state = savedStateFromRow({
      groupId: 'g1',
      expenseId: 'e1',
      version: version({ category: null }),
      hasLegacyReceipt: true,
    });
    expect(state.categoryStated).toBe(false);
    expect(state.hasReceipt).toBe(true);
  });
});

describe('groupWriteFromRow', () => {
  it('re-saves the bill as it is: same split, same payers, same shares', () => {
    const write = groupWriteFromRow({ expenseId: 'e1', version: version() });
    expect(write).toMatchObject({
      expenseId: 'e1',
      amount: 120000n,
      currency: 'INR',
      expenseDate: '2026-10-18',
      participants: ['m1', 'm2', 'm3'],
      splitParams: { kind: 'equal' },
    });
    expect(write.payers).toEqual({ m1: 120000n });
    expect(write.expectedShares).toEqual({ m1: 40000n, m2: 40000n, m3: 40000n });
  });

  it('carries everything an update would otherwise clear', () => {
    const fx = { rate: '83.2', source: 'manual' } as never;
    const write = groupWriteFromRow({
      expenseId: 'e1',
      version: version({
        receipt_id: 'r1',
        receipt_share_url: 'https://share',
        category_meta: { label: 'Shack', icon: 'x', tint: 'y' } as never,
        fx,
      }),
    });
    expect(write.payee).toBe('Shack owner');
    expect(write.receiptId).toBe('r1');
    expect(write.receiptShareUrl).toBe('https://share');
    expect(write.categoryMeta).toMatchObject({ label: 'Shack' });
    expect(write.fx).toBe(fx);
  });

  it('does not pin a base version, so repeated answers are not a conflict with themselves', () => {
    expect(groupWriteFromRow({ expenseId: 'e1', version: version() })).not.toHaveProperty(
      'baseVersionNo',
    );
  });
});
