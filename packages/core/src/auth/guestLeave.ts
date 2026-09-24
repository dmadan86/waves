/**
 * A guest switching to the account they already have leaves the groups it
 * only joined.
 *
 * The switch joins the real account to the guest's groups again, so a guest
 * membership left behind is the same person twice: the member list says four
 * people where there are two. So before the guest is signed out, each group it
 * joined through a link is left, as long as the guest left no trace there. A
 * guest that added an expense, owes a share, paid, or settled has history that
 * must stay attributable, so that membership stays, and the screen has already
 * said that anything the guest added stays with the guest.
 *
 * Plain orchestration with the reads and the write injected, so each client
 * supplies its own backend calls and the rule is tested once.
 */

export interface GuestMembership {
  readonly memberId: string;
  /** How they came in: only a link join is left; a group the guest made is not. */
  readonly joinedVia: string | null;
}

export interface GuestLeaveDeps {
  /** The guest's current (not yet left) memberships. */
  memberships(): Promise<readonly GuestMembership[]>;
  /** Whether this membership has any expense, share, payment or settlement. */
  hasHistory(memberId: string): Promise<boolean>;
  leave(memberId: string): Promise<void>;
  report?(error: unknown): void;
}

/** Leaves every untouched link-joined group. Resolves how many were left; never throws. */
export async function leaveUntouchedGuestGroups(deps: GuestLeaveDeps): Promise<number> {
  let memberships: readonly GuestMembership[];
  try {
    memberships = await deps.memberships();
  } catch (error) {
    deps.report?.(error);
    return 0;
  }
  let left = 0;
  for (const membership of memberships) {
    if (membership.joinedVia !== 'invite_link') continue;
    try {
      // Unknown counts as history: leaving is the one thing not to do by mistake.
      if (await deps.hasHistory(membership.memberId)) continue;
      await deps.leave(membership.memberId);
      left += 1;
    } catch (error) {
      deps.report?.(error);
    }
  }
  return left;
}
