/**
 * Small dashboard action decisions kept out of the component so interaction
 * affordances can be pinned without rendering the whole home screen.
 */

export interface CaptureInboxActionState {
  /** The badge shown on the inbox glyph; absent at zero so there is no red dot. */
  badge: number | undefined;
  /** A visible inbox glyph should never be a dead target; empty inbox still opens. */
  disabled: false;
}

/**
 * The dashboard's capture inbox button.
 *
 * It used to dim and disable itself at zero, leaving a visible control that did
 * nothing when tapped. Opening the empty inbox is the more honest empty state:
 * a user, rider, traveller or financer can still learn where drafts would land,
 * and the button no longer behaves like the dead gap reported beside the mic.
 */
export function captureInboxActionState(captureCount: number): CaptureInboxActionState {
  return {
    badge: captureCount > 0 ? captureCount : undefined,
    disabled: false,
  };
}
