/**
 * A photo shared into Waves from the system share sheet: where it goes, and
 * whether it is read.
 *
 * Pure decisions only (no React, no native), so they can be tested. The wiring
 * is `SharedReceiptHandler`; the native receiving is the WavesShare module
 * (Android ACTION_SEND intent, iOS Share Extension + App Group).
 */

/** What the add screens do with a shared photo. */
export type ShareDecodeMode = 'wait' | 'decode' | 'attach';

/**
 * Pro (a trial included) reads the bill and fills the amount and items in; Free
 * attaches the photo only and keeps the scan's own locked affordance. Waits
 * while the tier is still loading rather than guessing Free and attaching
 * something that should have been read. `capStatus` is the existing receipt cap
 * gate; where a screen has no cap (the group-less draft) it passes 'allowed'.
 */
export function shareDecodeMode(input: {
  tierLoading: boolean;
  isPro: boolean;
  capStatus: 'loading' | 'allowed' | 'locked';
}): ShareDecodeMode {
  if (input.tierLoading) return 'wait';
  if (!input.isPro) return 'attach';
  if (input.capStatus === 'loading') return 'wait';
  return input.capStatus === 'allowed' ? 'decode' : 'attach';
}

/**
 * Where a shared photo opens: always the quick-add draft form, with the group on
 * "Decide later". A share says nothing about which group the bill belongs to, so
 * none is picked for the person — they choose it on the form (picking one hands
 * the draft, photo included, to that group's add-expense).
 */
export function shareRoute(input: { receiptKey: string }): string {
  return `/capture?receipt=${encodeURIComponent(input.receiptKey)}&shared=1`;
}

/**
 * The OS may hand over a `content://` or `file://` URL as the launch link on a
 * share, and iOS opens `waves://share-receipt` after the extension. Neither is
 * a route: the share itself is read natively.
 */
export function isShareLaunchUrl(path: string): boolean {
  return (
    /^(content|file):\/\//i.test(path) ||
    /^[a-z][a-z0-9+.-]*:\/\/share-receipt(\/|\?|$)/i.test(path)
  );
}
