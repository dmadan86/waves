/**
 * Placing a whole "saved for later" cluster in one group.
 *
 * The point of these is the promise the inbox makes when somebody taps "Add
 * these to a group": every draft in the cluster goes, in the group they picked,
 * with the same figures the add-expense form would have shown — and nothing
 * outside the cluster is touched by it.
 */

import { describe, expect, it } from 'vitest';

import { CaptureStatus, type CaptureRow } from '../src/data/types';
import { planCaptureAssign, stillWaiting } from '../src/lib/captureBulkAssign';

function capture(overrides: Partial<CaptureRow> = {}): CaptureRow {
  const base: CaptureRow = {
    id: 'capture-1',
    owner_user_id: 'user-1',
    description: 'chai',
    amount: '9000',
    currency: 'INR',
    expense_date: '2026-09-08',
    category: 'food',
    category_meta: null,
    payment_method: null,
    target_group_id: null,
    location: null,
    status: CaptureStatus.Open,
    assigned_expense_id: null,
    assigned_group_id: null,
    created_at: '2026-09-08T08:00:00Z',
    pending: false,
    notes: null,
    photo_path: null,
    raw_text: null,
    parsed: null,
  };
  return { ...base, ...overrides };
}

const MEMBERS = [{ id: 'member-me' }, { id: 'member-ravi' }];
const ME = 'member-me';

describe('planCaptureAssign', () => {
  it('turns every draft in the cluster into an expense for the chosen group', () => {
    const plan = planCaptureAssign({
      captures: [
        capture({ id: 'a', amount: '9000' }),
        capture({ id: 'b', amount: '15000', description: 'samosas' }),
        capture({ id: 'c', amount: '4000' }),
      ],
      members: MEMBERS,
      myMemberId: ME,
      currency: 'INR',
    });

    expect(plan.problem).toBeNull();
    expect(plan.unusable).toEqual([]);
    expect(plan.writes.map((write) => write.captureId)).toEqual(['a', 'b', 'c']);
    // The draft's own id becomes the expense id, so a retry after a half-run
    // rewrites the same row rather than filing the dinner twice.
    expect(plan.writes.map((write) => write.expenseId)).toEqual(['a', 'b', 'c']);
  });

  it('writes the form defaults: everyone in, split equally, the assigner paid', () => {
    const plan = planCaptureAssign({
      captures: [capture({ id: 'a', amount: '9000' })],
      members: MEMBERS,
      myMemberId: ME,
      currency: 'INR',
    });

    expect(plan.writes[0]!.payload).toMatchObject({
      expenseId: 'a',
      description: 'chai',
      category: 'food',
      expenseDate: '2026-09-08',
      currency: 'INR',
      amount: '9000',
      splitParams: { kind: 'equal' },
      participants: ['member-me', 'member-ravi'],
      payers: { 'member-me': '9000' },
      paymentMethod: 'cash',
      baseVersionNo: null,
    });
    // Our own division, sent so the server can contradict it rather than
    // silently disagree.
    expect(plan.writes[0]!.payload.expectedShares).toEqual({
      'member-me': '4500',
      'member-ravi': '4500',
    });
  });

  it('keeps what the draft recorded: its tag, its place and how it was paid', () => {
    const meta = { label: 'Chai runs', icon: 'cafe', tint: 'peach' } as const;
    const plan = planCaptureAssign({
      captures: [
        capture({
          id: 'a',
          category_meta: meta,
          location: { name: 'Marine Drive', lat: 18.94, lng: 72.82 },
          payment_method: 'credit',
        }),
      ],
      members: MEMBERS,
      myMemberId: ME,
      currency: 'INR',
    });

    expect(plan.writes[0]!.payload).toMatchObject({
      categoryMeta: meta,
      location: { name: 'Marine Drive', lat: 18.94, lng: 72.82 },
      paymentMethod: 'credit',
    });
  });

  it('files a draft nobody else can pay under whoever is in the group', () => {
    const plan = planCaptureAssign({
      captures: [capture({ id: 'a' })],
      members: [{ id: 'member-ravi' }],
      myMemberId: ME,
      currency: 'INR',
    });

    expect(plan.writes[0]!.payload).toMatchObject({ payers: { 'member-ravi': '9000' } });
  });

  it('never makes a ghost the payer when the viewer is unknown', () => {
    // A ghost has no profile of their own. When identity resolution lived in
    // here it compared profile ids, and an unloaded profile (null) matched the
    // first ghost — making them sole payer of every expense in the cluster.
    // The plan is handed the answer now, so there is nothing to mismatch: with
    // no viewer it falls to the group's first member, never to whoever happens
    // to carry a null profile.
    const plan = planCaptureAssign({
      captures: [capture({ id: 'a' })],
      members: [{ id: 'member-me' }, { id: 'ghost-ravi' }],
      myMemberId: null,
      currency: 'INR',
    });

    expect(plan.writes[0]!.payload).toMatchObject({ payers: { 'member-me': '9000' } });
  });

  it('ignores a viewer who is not in the chosen group', () => {
    const plan = planCaptureAssign({
      captures: [capture({ id: 'a' })],
      members: [{ id: 'member-ravi' }, { id: 'member-asha' }],
      myMemberId: 'member-from-another-group',
      currency: 'INR',
    });

    expect(plan.writes[0]!.payload).toMatchObject({ payers: { 'member-ravi': '9000' } });
  });

  it('loses none of the others when one draft cannot be written', () => {
    const plan = planCaptureAssign({
      captures: [
        capture({ id: 'a' }),
        capture({ id: 'broken', amount: 'not-a-number' }),
        capture({ id: 'zero', amount: '0' }),
        capture({ id: 'c' }),
      ],
      members: MEMBERS,
      myMemberId: ME,
      currency: 'INR',
    });

    expect(plan.writes.map((write) => write.captureId)).toEqual(['a', 'c']);
    // Named, not dropped: the screen counts it as a failure and it stays in the
    // inbox rather than disappearing into a success message. Zero matches the
    // single add-expense form, whose Save is blocked until there is an amount.
    expect(plan.unusable.map((row) => row.id)).toEqual(['broken', 'zero']);
  });

  it('writes nothing into a group with nobody left in it', () => {
    const plan = planCaptureAssign({
      captures: [capture({ id: 'a' }), capture({ id: 'b' })],
      members: [],
      myMemberId: ME,
      currency: 'INR',
    });

    expect(plan.problem).toBe('no-members');
    expect(plan.writes).toEqual([]);
    expect(plan.unusable.map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('places a cluster of one, the same as a cluster of five', () => {
    const plan = planCaptureAssign({
      captures: [capture({ id: 'only' })],
      members: MEMBERS,
      myMemberId: ME,
      currency: 'INR',
    });

    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]!.captureId).toBe('only');
  });
});

describe('stillWaiting', () => {
  it('drops a draft another device assigned while the sheet was open', () => {
    const a = capture({ id: 'a' });
    const b = capture({ id: 'b' });
    const c = capture({ id: 'c' });

    expect(stillWaiting([a, b, c], [a, c]).map((row) => row.id)).toEqual(['a', 'c']);
  });

  it('never reaches past the cluster into the rest of the inbox', () => {
    const a = capture({ id: 'a' });
    const other = capture({ id: 'elsewhere' });

    expect(stillWaiting([a], [a, other]).map((row) => row.id)).toEqual(['a']);
  });

  it('has nothing to place when the whole cluster went in the meantime', () => {
    expect(stillWaiting([capture({ id: 'a' })], [])).toEqual([]);
  });
});
