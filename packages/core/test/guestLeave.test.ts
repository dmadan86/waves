import { describe, expect, it, vi } from 'vitest';

import { leaveUntouchedGuestGroups, type GuestMembership } from '../src/auth/guestLeave';

function deps(memberships: GuestMembership[], history: Record<string, boolean | Error> = {}) {
  return {
    memberships: vi.fn(async () => memberships),
    hasHistory: vi.fn(async (id: string) => {
      const answer = history[id] ?? false;
      if (answer instanceof Error) throw answer;
      return answer;
    }),
    leave: vi.fn(async (_id: string) => {}),
    report: vi.fn(),
  };
}

describe('a guest switching accounts leaves what it only joined', () => {
  it('leaves an untouched group it joined by link', async () => {
    const d = deps([{ memberId: 'm1', joinedVia: 'invite_link' }]);
    await expect(leaveUntouchedGuestGroups(d)).resolves.toBe(1);
    expect(d.leave).toHaveBeenCalledWith('m1');
  });

  it('stays where it added, owes, paid or settled anything', async () => {
    const d = deps([{ memberId: 'm1', joinedVia: 'invite_link' }], { m1: true });
    await expect(leaveUntouchedGuestGroups(d)).resolves.toBe(0);
    expect(d.leave).not.toHaveBeenCalled();
  });

  it('never leaves a group it made, or a place it claimed', async () => {
    const d = deps([
      { memberId: 'made', joinedVia: 'creator' },
      { memberId: 'claimed', joinedVia: 'invite_link_claim' },
      { memberId: 'unknown', joinedVia: null },
    ]);
    await expect(leaveUntouchedGuestGroups(d)).resolves.toBe(0);
    expect(d.hasHistory).not.toHaveBeenCalled();
    expect(d.leave).not.toHaveBeenCalled();
  });

  it('stays when it cannot tell, and carries on with the rest', async () => {
    const d = deps(
      [
        { memberId: 'unsure', joinedVia: 'invite_link' },
        { memberId: 'clean', joinedVia: 'invite_link' },
      ],
      { unsure: new Error('offline') },
    );
    await expect(leaveUntouchedGuestGroups(d)).resolves.toBe(1);
    expect(d.leave).toHaveBeenCalledTimes(1);
    expect(d.leave).toHaveBeenCalledWith('clean');
    expect(d.report).toHaveBeenCalledWith(expect.any(Error));
  });

  it('never throws, even when the memberships cannot be read', async () => {
    const d = deps([]);
    d.memberships.mockRejectedValueOnce(new Error('offline'));
    await expect(leaveUntouchedGuestGroups(d)).resolves.toBe(0);
    expect(d.report).toHaveBeenCalled();
  });

  it('reports a leave the server refused and carries on', async () => {
    const d = deps([
      { memberId: 'a', joinedVia: 'invite_link' },
      { memberId: 'b', joinedVia: 'invite_link' },
    ]);
    d.leave.mockRejectedValueOnce(new Error('refused'));
    await expect(leaveUntouchedGuestGroups(d)).resolves.toBe(1);
    expect(d.report).toHaveBeenCalledTimes(1);
  });
});
