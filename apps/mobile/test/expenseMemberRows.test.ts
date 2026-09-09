import { describe, expect, it } from 'vitest';

import { expenseMemberHref } from '@/lib/expenseMemberRows';

describe('expenseMemberHref', () => {
  it('opens a current member from either paid-by or who-owes rows', () => {
    expect(expenseMemberHref('g1', 'm-financer', true)).toBe('/group/g1/member/m-financer');
    expect(expenseMemberHref('trip', 'm-rider', true)).toBe('/group/trip/member/m-rider');
  });

  it('leaves historical rows inert when the member no longer exists locally', () => {
    expect(expenseMemberHref('g1', 'm-gone', false)).toBeNull();
  });
});
