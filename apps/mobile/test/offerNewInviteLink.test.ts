import { describe, expect, it } from 'vitest';

import { offerNewInviteLink } from '@/lib/inviteLink';

describe('offerNewInviteLink', () => {
  it('offers a new link to an admin once somebody has left or been removed', () => {
    expect(offerNewInviteLink([{ left_at: '2026-11-26' }], true)).toBe(true);
    expect(offerNewInviteLink([{ left_at: null }], true)).toBe(false);
    expect(offerNewInviteLink([{ left_at: '2026-11-26' }], false)).toBe(false);
  });
});

describe('invite screen wiring', () => {
  it('asks the list that keeps people who left; `members` drops them, so the button never showed', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/app/group/[id]/invite.tsx', 'utf8');
    expect(source).toContain('offerNewInviteLink(everyone.data');
    expect(source).not.toContain('offerNewInviteLink(members.data');
  });
});
