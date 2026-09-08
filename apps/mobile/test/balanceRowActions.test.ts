import { describe, expect, it } from 'vitest';

import { canRemindFromBalanceRow } from '../src/lib/balanceRowActions';

describe('balance row accessibility actions', () => {
  it('offers remind when a saved non-ghost financer owes the group', () => {
    expect(
      canRemindFromBalanceRow({
        balance: -50000n,
        isGhost: false,
        memberId: 'financer-member',
        myMemberId: 'user-member',
      }),
    ).toBe(true);
  });

  it('does not offer remind for a rider or traveller the user owes', () => {
    expect(
      canRemindFromBalanceRow({
        balance: 50000n,
        isGhost: false,
        memberId: 'rider-member',
        myMemberId: 'user-member',
      }),
    ).toBe(false);
  });

  it('does not offer remind for the current user row while members are loading or loaded', () => {
    expect(
      canRemindFromBalanceRow({
        balance: -50000n,
        isGhost: false,
        memberId: 'user-member',
        myMemberId: 'user-member',
      }),
    ).toBe(false);
  });

  it('does not offer remind for ghost rows that have no delivery target', () => {
    expect(
      canRemindFromBalanceRow({
        balance: -50000n,
        isGhost: true,
        memberId: 'ghost-member',
        myMemberId: 'user-member',
      }),
    ).toBe(false);
  });
});
