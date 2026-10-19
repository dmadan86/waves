/**
 * The Free-user teaser: at most one line every seven days.
 *
 * After a Free person's voice-added expense is saved, the Pro follow-up
 * question is shown as a single static line ("Pro would ask: Where was this?")
 * with a link to the plans screen. It never blocks, can be dismissed, and is
 * remembered per account on this phone (`waves.assistant_teaser_at:<id>`) so
 * the same person is not nagged. Showing it records the time at once, so
 * closing the app mid-line still counts as a view.
 */

import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  trackAssistant,
  trackAssistantPremiumViewed,
  type FollowUpKind,
} from '@/lib/assistantTelemetry';
import { router } from '@/lib/navigation';

export const TEASER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export const teaserKey = (viewerId: string): string => `waves.assistant_teaser_at:${viewerId}`;

/** The kinds a teaser can name: the questions Pro asks most. */
export type TeaserKind = Extract<FollowUpKind, 'place' | 'receipt' | 'payment'>;

/**
 * True when a teaser may be shown: never shown, a stamp that is not a date, a
 * stamp in the future (a clock that was wrong), or one a full interval old.
 */
export function teaserDue(
  shownAt: string | null | undefined,
  nowMs: number,
  intervalMs: number = TEASER_INTERVAL_MS,
): boolean {
  if (!shownAt) return true;
  const then = Date.parse(shownAt);
  if (!Number.isFinite(then)) return true;
  if (then > nowMs) return true;
  return nowMs - then >= intervalMs;
}

/** Whether the teaser applies at all: Free only, and only to a signed-in account. */
export function teaserApplies(input: {
  isPro: boolean;
  viewerId: string | null | undefined;
}): boolean {
  return !input.isPro && Boolean(input.viewerId);
}

export interface AssistantTeaserHandle {
  /** True once storage has said it is time, until it is dismissed. */
  readonly visible: boolean;
  readonly dismiss: () => void;
  /** "See Pro": counts the plans view and opens the paywall. */
  readonly openPlans: () => void;
}

export function useAssistantTeaser(
  viewerId: string | null | undefined,
  options: { enabled: boolean; kind: TeaserKind; now?: () => number },
): AssistantTeaserHandle {
  const { enabled, kind } = options;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled || !viewerId) return undefined;
    let live = true;
    void (async () => {
      let stamp: string | null = null;
      try {
        stamp = await AsyncStorage.getItem(teaserKey(viewerId));
      } catch {
        // Unreadable storage reads as never shown.
      }
      const nowMs = (options.now ?? Date.now)();
      if (!live || !teaserDue(stamp, nowMs)) return;
      setVisible(true);
      trackAssistant('assistant_teaser_viewed', { kind });
      try {
        await AsyncStorage.setItem(teaserKey(viewerId), new Date(nowMs).toISOString());
      } catch {
        // Worst case it is shown again next time.
      }
    })();
    return () => {
      live = false;
    };
    // `now` is a test seam, not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, viewerId, kind]);

  const dismiss = useCallback((): void => setVisible(false), []);
  const openPlans = useCallback((): void => {
    trackAssistantPremiumViewed();
    router.push('/paywall');
  }, []);

  return { visible, dismiss, openPlans };
}
