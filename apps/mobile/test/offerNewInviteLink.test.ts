import { describe, expect, it } from 'vitest';

import { offerNewInviteLink } from '@/lib/inviteLink';

describe('offerNewInviteLink', () => {
  it('offers a new link to an admin once somebody has left or been removed', () => {
    expect(offerNewInviteLink([{ left_at: '2026-11-26' }], true)).toBe(true);
    expect(offerNewInviteLink([{ left_at: null }], true)).toBe(false);
    expect(offerNewInviteLink([{ left_at: '2026-11-26' }], false)).toBe(false);
  });
});
