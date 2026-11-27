import { describe, expect, it } from 'vitest';

describe('my member id in a couple space', () => {
  it('matches the member row by profile id, not the sign-in account id', async () => {
    const { myMemberIdFrom } = await import('../src/lib/rentalScope');
    const rows = [
      { id: 'm-partner', profile_id: 'p-partner' },
      { id: 'm-me', profile_id: 'p-me' },
    ];
    expect(myMemberIdFrom(rows, 'p-me')).toBe('m-me');
    expect(myMemberIdFrom(rows, 'auth-user-uuid')).toBeNull();
    expect(myMemberIdFrom(undefined, 'p-me')).toBeNull();
    expect(myMemberIdFrom(rows, null)).toBeNull();
  });
});
