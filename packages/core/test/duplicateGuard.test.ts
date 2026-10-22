import { describe, expect, it } from 'vitest';

import {
  findDuplicate,
  type RecentGroupExpense,
  type SavedExpenseFacts,
} from '../src/voice/followUps';

const NOW = Date.UTC(2026, 9, 21, 12);
const mine: SavedExpenseFacts = {
  scope: 'group',
  expenseId: 'saved',
  groupId: 'g-goa',
  groupName: 'Goa trip',
  amountMinor: 100000n,
  currency: 'INR',
  category: 'food',
  categoryStated: true,
  description: 'Dinner',
  date: '2026-10-21',
  hasPlace: false,
  hasReceipt: false,
  hasNotes: false,
  hasPaymentMethod: true,
  canAttachReceipt: true,
  canSetPayment: true,
  members: [
    { id: 'm-me', name: 'Madan', isMe: true },
    { id: 'm-anu', name: 'Anu', isMe: false },
    { id: 'm-ravi', name: 'Ravi', isMe: false },
  ],
  splitParticipantCount: 3,
  payerIsMe: true,
};
const other = (over: Partial<RecentGroupExpense> = {}): RecentGroupExpense => ({
  groupId: 'g-goa',
  expenseId: 'other',
  byOther: true,
  authorName: 'Ravi',
  amountMinor: 100000n,
  currency: 'INR',
  description: 'Dinner',
  createdMs: NOW - 2 * 3600_000,
  ...over,
});

describe('findDuplicate', () => {
  it('DU-01 matches another author within five percent and two hours', () => {
    const candidate = other();
    expect(findDuplicate({ ...mine, amountMinor: 105000n }, [candidate], NOW)).toEqual(candidate);
  });
  it('DU-02 rejects a difference of 5.1 percent', () => {
    expect(findDuplicate({ ...mine, amountMinor: 105100n }, [other()], NOW)).toBeNull();
  });
  it('DU-03 rejects twenty-five-hour-old and future expenses', () => {
    expect(findDuplicate(mine, [other({ createdMs: NOW - 25 * 3600_000 })], NOW)).toBeNull();
    expect(findDuplicate(mine, [other({ createdMs: NOW + 60_000 })], NOW)).toBeNull();
  });
  it('DU-04 rejects my own expense', () => {
    expect(findDuplicate(mine, [other({ byOther: false })], NOW)).toBeNull();
  });
  it('DU-05 rejects another group', () => {
    expect(findDuplicate(mine, [other({ groupId: 'g-flat' })], NOW)).toBeNull();
  });
  it('DU-06 rejects the same expense id', () => {
    expect(findDuplicate(mine, [other({ expenseId: mine.expenseId })], NOW)).toBeNull();
  });
  it('DU-07 chooses the newest candidate regardless of input order', () => {
    const old = other();
    const newest = other({ expenseId: 'newest', createdMs: NOW - 3600_000 });
    expect(findDuplicate(mine, [old, newest], NOW)).toEqual(newest);
    expect(findDuplicate(mine, [newest, old], NOW)).toEqual(newest);
  });
  it('DU-08 rejects personal scope', () => {
    expect(findDuplicate({ ...mine, scope: 'personal', groupId: null }, [other()], NOW)).toBeNull();
  });
  it('DU-09 compares currency without case and rejects a different currency', () => {
    const candidate = other({ currency: 'inr' });
    expect(findDuplicate(mine, [candidate], NOW)).toEqual(candidate);
    expect(findDuplicate(mine, [other({ currency: 'GBP' })], NOW)).toBeNull();
  });
  it('DU-12 excludes the just-saved id even when wrongly marked byOther', () => {
    const saved = other({ expenseId: mine.expenseId, byOther: true, createdMs: NOW });
    const previous = other();
    expect(findDuplicate(mine, [saved], NOW)).toBeNull();
    expect(findDuplicate(mine, [saved, previous], NOW)).toEqual(previous);
  });
});
