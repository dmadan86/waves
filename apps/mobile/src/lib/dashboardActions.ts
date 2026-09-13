/**
 * The capture inbox's badge math, kept out of any component so it can be
 * shared and tested without rendering one.
 *
 * This used to decide the dashboard's own inbox circle, back when it disabled
 * and dimmed itself at zero — a visible control that did nothing when tapped.
 * The circle has since moved onto the bar as the "Review" tab (see
 * `AppTabBar`), which is always tappable whether or not anything is waiting,
 * so there is nothing left to disable; what survives here is the one thing
 * both surfaces needed the same answer to — the badge, absent at zero so there
 * is never a red dot standing for nothing.
 */
export interface CaptureInboxActionState {
  /** The badge to show; absent at zero. */
  badge: number | undefined;
}

export function captureInboxActionState(captureCount: number): CaptureInboxActionState {
  return { badge: captureCount > 0 ? captureCount : undefined };
}
