/**
 * Who may join a shared group (ADR-006 amendment, 2026-10-11).
 *
 * Opening an invite link used to be possible as an anonymous guest. It is not:
 * joining a shared group needs an account, because a guest identity lives on
 * one device and the person joining expects the group to follow them. The
 * server refuses an anonymous caller with `ACCOUNT_REQUIRED`; this is the same
 * rule for the screens, so they never offer a join that would be refused.
 *
 * A guest is not turned away: they are asked to create an account, which
 * upgrades their existing identity in place (same user id), so everything they
 * already have is kept, and then the join goes through.
 *
 * Pure, and shared by the phone and the web join screens.
 */

/** The code the server refuses an anonymous join with. Stable across apps. */
export const ACCOUNT_REQUIRED = 'ACCOUNT_REQUIRED';

export enum JoinGate {
  /** A real account: the join may go ahead. */
  Ready = 'ready',
  /** Nobody signed in: offer "Sign up to join" and "Log in". */
  SignUpOrLogIn = 'sign_up_or_log_in',
  /** A guest session: ask for an account, upgrading in place, then join. */
  UpgradeGuest = 'upgrade_guest',
}

export interface JoinViewer {
  /** There is a session (anonymous or not). */
  signedIn: boolean;
  /** The session is an anonymous guest's. */
  anonymous: boolean;
}

export function joinGate(viewer: JoinViewer): JoinGate {
  if (!viewer.signedIn) return JoinGate.SignUpOrLogIn;
  return viewer.anonymous ? JoinGate.UpgradeGuest : JoinGate.Ready;
}

/**
 * The code the server refuses a removed member with when they present an invite
 * from before their removal. Stable across apps.
 */
export const REMOVED_FROM_GROUP = 'REMOVED_FROM_GROUP';

/** Whether a failure from the join call is the server asking for an account. */
export function isAccountRequired(caught: unknown): boolean {
  const message =
    typeof caught === 'string'
      ? caught
      : caught && typeof (caught as { message?: unknown }).message === 'string'
        ? (caught as { message: string }).message
        : '';
  const code =
    caught && typeof (caught as { code?: unknown }).code === 'string'
      ? (caught as { code: string }).code
      : '';
  return code === ACCOUNT_REQUIRED || message.includes(ACCOUNT_REQUIRED);
}

/** Whether a failure from the join call is "you were removed; ask for a new invite". */
export function isRemovedFromGroup(caught: unknown): boolean {
  const message =
    typeof caught === 'string'
      ? caught
      : caught && typeof (caught as { message?: unknown }).message === 'string'
        ? (caught as { message: string }).message
        : '';
  const code =
    caught && typeof (caught as { code?: unknown }).code === 'string'
      ? (caught as { code: string }).code
      : '';
  return code === REMOVED_FROM_GROUP || message.includes(REMOVED_FROM_GROUP);
}

/**
 * Whether the join screen should complete the join by itself.
 *
 * Only on the way back from signing up or logging in (`resume`), only with a
 * real account, only once, and only when there is no "is this you?" choice to
 * make: an invite that lists unclaimed people must show them first, because
 * joining as someone new would give up the chance to take over a name's history.
 */
export function shouldAutoJoin(input: {
  gate: JoinGate;
  resume: boolean;
  claimableCount: number;
  attempted: boolean;
}): boolean {
  return (
    input.gate === JoinGate.Ready && input.resume && input.claimableCount === 0 && !input.attempted
  );
}
