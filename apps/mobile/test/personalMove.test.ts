import { describe, expect, it } from 'vitest';

import { moveStep } from '@/lib/pendingMoves';
import {
  friendChoices,
  movableGroups,
  partiesFor,
  pendingMoveFor,
  personalMoveWrite,
  type MemberLite,
  type MoveEntry,
} from '@/lib/personalMove';
import { planPersonalPlacement, runPersonalPlacement } from '@/lib/personalPlacement';
import type { CaptureRow } from '@/data/types';

const entry: MoveEntry = {
  id: 'p1',
  amount: 1000n, // 10.00 in minor units
  currency: 'INR',
  date: '2026-11-20',
  note: 'Dinner',
  category: 'food',
  receiptKey: 'receipt-key',
};
const m = (id: string, group: string, profile: string | null, extra: Partial<MemberLite> = {}) =>
  ({ id, group_id: group, profile_id: profile, role: 'member', ...extra }) as MemberLite;

describe('personalMoveWrite: the group expense built from a Personal entry', () => {
  const parties = { payerId: 'me', participantIds: ['me', 'a', 'b'] };
  const write = personalMoveWrite(entry, parties, 'exp-1') as Record<string, any>;

  it('carries amount, currency, date, note and category over', () => {
    expect(write).toMatchObject({
      expenseId: 'exp-1',
      amount: '1000',
      currency: 'INR',
      expenseDate: '2026-11-20',
      description: 'Dinner',
      category: 'food',
      splitParams: { kind: 'equal' },
    });
  });

  it('is paid in full by you and split equally, the odd paisa landing on one person', () => {
    expect(write.payers).toEqual({ me: '1000' });
    const shares = Object.values(write.expectedShares as Record<string, string>)
      .map(BigInt)
      .sort();
    expect(shares).toEqual([333n, 333n, 334n]);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(1000n);
  });
});

describe('who is in the split', () => {
  const members = [
    m('me', 'g', 'u1'),
    m('a', 'g', 'u2'),
    m('gone', 'g', 'u3', { left_at: '2026-01-01' }),
    m('b', 'g', null),
  ];
  it('puts you first and everyone still in, as payer you', () => {
    expect(partiesFor({ id: 'g' }, members, 'u1')).toEqual({
      payerId: 'me',
      participantIds: ['me', 'a', 'b'],
    });
  });
  it('is only you in a pooled household', () => {
    expect(partiesFor({ id: 'g', ledger_mode: 'pool' }, members, 'u1')?.participantIds).toEqual([
      'me',
    ]);
  });
  it('is null when you are not in the group', () => {
    expect(partiesFor({ id: 'g' }, members, 'nobody')).toBeNull();
  });
});

describe('target listing', () => {
  const groups = [
    { id: 'g1', type: 'friends', default_currency: 'INR' },
    { id: 'g2', type: 'friends', default_currency: 'USD', convert_to_group_currency: true },
    { id: 'g3', type: 'friends', default_currency: 'INR', archived_at: '2026-01-01' },
    { id: 'g4', type: 'company', default_currency: 'INR' },
    { id: 'g5', type: 'friends', default_currency: 'INR' },
  ] as any[];
  const members = [
    m('1', 'g1', 'u'),
    m('2', 'g2', 'u'),
    m('3', 'g3', 'u'),
    m('4', 'g4', 'u'),
    m('5', 'g5', 'u', { left_at: '2026-01-01' }),
  ];
  it('offers only open, non-company groups you are in and can add this currency to', () => {
    expect(movableGroups(groups, members, 'u', 'INR').map((g) => g.id)).toEqual(['g1']);
  });
  it('lists the other person of each offered 1:1, even one also in a trip or square with you', () => {
    const sigs = [
      { groupId: 'o2', names: ['Zed'] },
      { groupId: 'o1', names: ['Asha'] },
      { groupId: 'trip', names: ['Trip mate', 'Other'] },
      { groupId: 'o4', names: ['Hidden'] },
      { groupId: 'o5', names: [] },
    ];
    expect(
      friendChoices(sigs, new Set(['o1', 'o2', 'o4', 'o5']), new Set(['o1', 'o2', 'trip'])).map(
        (f) => f.name,
      ),
    ).toEqual(['Asha', 'Zed']);
    expect(friendChoices(sigs, new Set(['o1', 'o2', 'o4'])).map((f) => f.name)).toEqual([
      'Asha',
      'Hidden',
      'Zed',
    ]);
  });
});

describe('the Personal original goes only after the group expense is accepted', () => {
  const move = pendingMoveFor('cmid-1', { ...entry, receiptKey: null }, 'g', 'exp-1');
  it('tracks the original and waits while the group write is queued', () => {
    expect(move).toEqual({ cmid: 'cmid-1', personalId: 'p1' });
    expect(moveStep(move, [{ clientMutationId: 'cmid-1' }], 0)).toBe('idle');
  });
  it('deletes it once accepted, and keeps it when refused', () => {
    expect(moveStep(move, [], 0)).toBe('delete');
    expect(moveStep(move, [{ clientMutationId: 'cmid-1', rejection: {} }], 0)).toBe('drop');
  });
  it('carries the bill photo to the new expense before the delete', () => {
    const withPhoto = pendingMoveFor('cmid-1', entry, 'g', 'exp-1');
    expect(withPhoto).toMatchObject({
      receiptKey: 'receipt-key',
      groupId: 'g',
      expenseId: 'exp-1',
    });
    expect(moveStep(withPhoto, [], 0)).toBe('carry');
  });
});

describe('Review draft assigned to Just me (Personal)', () => {
  const draft = {
    id: 'c1',
    description: 'Chai',
    category: 'food',
    expense_date: '2026-11-20',
    currency: 'INR',
    amount: '4500',
  } as unknown as CaptureRow;
  it('becomes one Personal record, and the draft is closed only after it is queued', async () => {
    const calls: string[] = [];
    const plan = planPersonalPlacement({ captures: [draft], fallbackDescription: 'An expense' });
    const out = await runPersonalPlacement({
      plan,
      upsert: async (w) => void calls.push(`upsert:${w.recordId}`),
      close: async (id) => void calls.push(`close:${id}`),
    });
    expect(out.done).toEqual(['c1']);
    expect(calls).toEqual(['upsert:c1', 'close:c1']);
  });
});
