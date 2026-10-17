import { describe, expect, it } from 'vitest';

import { canRemindFromBalanceRow } from '../src/lib/balanceRowActions';

describe('balance row accessibility actions', () => {
  it('offers remind when a saved non-ghost financer owes the group', () => {
    expect(
      canRemindFromBalanceRow({
        balance: -50000n,
        memberId: 'financer-member',
        myMemberId: 'user-member',
      }),
    ).toBe(true);
  });

  it('does not offer remind for a rider or traveller the user owes', () => {
    expect(
      canRemindFromBalanceRow({
        balance: 50000n,
        memberId: 'rider-member',
        myMemberId: 'user-member',
      }),
    ).toBe(false);
  });

  it('does not offer remind for the current user row while members are loading or loaded', () => {
    expect(
      canRemindFromBalanceRow({
        balance: -50000n,
        memberId: 'user-member',
        myMemberId: 'user-member',
      }),
    ).toBe(false);
  });

  it('offers remind for ghost rows too: the sheet picks a channel that reaches them', () => {
    expect(
      canRemindFromBalanceRow({
        balance: -50000n,
        memberId: 'ghost-member',
        myMemberId: 'user-member',
      }),
    ).toBe(true);
  });
});
