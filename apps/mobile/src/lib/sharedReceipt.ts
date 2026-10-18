/**
 * A photo shared into Waves from the system share sheet: where it goes, and
 * whether it is read.
 *
 * Pure decisions only (no React, no native), so they can be tested. The wiring
 * is `SharedReceiptHandler`; the native receiving is the WavesShare module
 * (Android ACTION_SEND intent, iOS Share Extension + App Group).
 */

import type { DestinationKey } from '@/lib/recentDestinations';

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
 * Where a shared photo opens: add-expense in the group used last (the quick-add
 * sheet's own default), else the quick-add draft form, whose group stays on
 * "Decide later" until the person picks one. `groupIds` is what still resolves
 * (a deleted or archived group must not catch a share).
 */
export function shareRoute(input: {
  receiptKey: string;
  recents: readonly DestinationKey[];
  groupIds: ReadonlySet<string>;
}): string {
  const key = encodeURIComponent(input.receiptKey);
  for (const destination of input.recents) {
    const groupId = destination.startsWith('group:') ? destination.slice('group:'.length) : null;
    if (groupId && input.groupIds.has(groupId)) {
      return `/group/${groupId}/add-expense?receipt=${key}&shared=1`;
    }
    // The newest destination is the private ledger: no group to default to.
    if (destination === 'personal') break;
  }
  return `/capture?receipt=${key}&shared=1`;
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
