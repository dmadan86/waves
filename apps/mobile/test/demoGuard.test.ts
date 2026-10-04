/**
 * The one promise the demo makes — nothing in it ever reaches the server —
 * tested at the level that actually enforces it: `touchesDemo`, the
 * predicate `useSync().mutate` (and the handful of direct-RPC hooks) run on
 * every write before it is allowed anywhere near the queue or the network.
 */
import { describe, expect, it } from 'vitest';

import {
  DEMO_EXPENSE_FLIGHTS_ID,
  DEMO_GROUP_ID,
  DEMO_MEMBER_ME_ID,
  DEMO_MEMBER_PRIYA_ID,
  DEMO_SETTLEMENT_ID,
  isDemoGroupId,
  isDemoMemberId,
} from '@/demo/ids';
import { DemoWriteBlockedError, touchesDemo } from '@/demo/guard';

describe('touchesDemo', () => {
  it('catches the demo group as the scope id itself', () => {
    expect(touchesDemo(DEMO_GROUP_ID)).toBe(true);
  });

  it('leaves a real group id alone', () => {
    expect(touchesDemo('a-real-group-id')).toBe(false);
    expect(touchesDemo('a-real-group-id', { description: 'Dinner' })).toBe(false);
  });

  it('catches a demo id buried anywhere in the payload', () => {
    expect(
      touchesDemo('real-group', { groupId: DEMO_GROUP_ID, pinId: 'pin-1' }),
    ).toBe(true);
    expect(
      touchesDemo('real-group', { memberId: DEMO_MEMBER_PRIYA_ID }),
    ).toBe(true);
    expect(
      touchesDemo('real-group', { expenseId: DEMO_EXPENSE_FLIGHTS_ID }),
    ).toBe(true);
    expect(touchesDemo('real-group', { settlementId: DEMO_SETTLEMENT_ID })).toBe(true);
  });

  it('catches a demo id nested inside arrays and objects', () => {
    expect(
      touchesDemo('real-group', {
        allocations: [{ expenseId: 'real-expense' }, { expenseId: DEMO_EXPENSE_FLIGHTS_ID }],
      }),
    ).toBe(true);
  });

  it('never flags an ordinary payload with no ids in it at all', () => {
    expect(
      touchesDemo('real-group', {
        description: 'Groceries',
        amount: '1200',
        notes: null,
        payers: [{ member_id: 'm1', amount: '1200' }],
      }),
    ).toBe(false);
  });

  it('is unmoved by a payload that is undefined, null or a primitive', () => {
    expect(touchesDemo('real-group', undefined)).toBe(false);
    expect(touchesDemo('real-group')).toBe(false);
  });
});

describe('id recognisers', () => {
  it('recognises the demo group and its members, and nothing else', () => {
    expect(isDemoGroupId(DEMO_GROUP_ID)).toBe(true);
    expect(isDemoGroupId('some-other-group')).toBe(false);
    expect(isDemoGroupId(null)).toBe(false);
    expect(isDemoGroupId(undefined)).toBe(false);

    expect(isDemoMemberId(DEMO_MEMBER_ME_ID)).toBe(true);
    expect(isDemoMemberId(DEMO_MEMBER_PRIYA_ID)).toBe(true);
    expect(isDemoMemberId('some-real-member')).toBe(false);
  });
});

describe('DemoWriteBlockedError', () => {
  it('is a real Error a caller can catch and recognise by name', () => {
    const error = new DemoWriteBlockedError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('DemoWriteBlockedError');
  });
});
