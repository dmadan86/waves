/**
 * One pass over the reminder, from wherever the app happens to be.
 *
 * Two callers need exactly the same thing and must not each assemble it: the
 * headless `CaptureNudge`, which runs a pass when the inbox or the app's state
 * moves, and the switch on the notifications screen, which has to make its own
 * answer true the moment it is touched rather than at the next foreground. A
 * switch that takes effect later is a switch people press twice.
 *
 * The returned callback is fire-and-forget and never rejects: a reminder that
 * could not be set or cleared is reported to observability and otherwise
 * silent, because there is no screen this belongs on.
 */

import { useCallback } from 'react';

import { useCaptures, useGroups } from '@/data/hooks';
import { plural, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { foldedCaptureCount } from '@/lib/captureBatch';
import { reportHandled } from '@/lib/observability';

import { NudgeKind } from './plan';
import { syncCaptureNudge } from './run';

/** What the pass is about to be told, so a caller can key an effect on it. */
export interface NudgePassInputs {
  readonly ownerId: string;
  /** Waiting drafts, folded the way the dashboard badge folds them. */
  readonly waitingCount: number;
  /** When the oldest of them was saved, epoch ms. Null when none is waiting. */
  readonly oldestWaitingAt: number | null;
  readonly locale: string;
  /**
   * Whether this account is in any group. Somebody with nowhere to put an
   * expense is never asked in the evening whether they have one to add.
   */
  readonly hasGroup: boolean;
  /**
   * The mirror is off disk. Until it is, the count is "we have not looked", not
   * "nothing is waiting" — and acting on it would cancel this evening's
   * reminder on every single launch. The same trap `restorePrompt` is built
   * around.
   */
  readonly ready: boolean;
}

export function useNudgePassInputs(): NudgePassInputs {
  const { session } = useAuth();
  const ownerId = session?.user?.id ?? '';
  const captures = useCaptures();
  const groups = useGroups();
  const { locale } = useStrings();

  const rows = captures.data;
  // A voice batch counts as one draft, exactly as the dashboard badge counts it
  // — one utterance must not read as four things waiting.
  const waitingCount = foldedCaptureCount(rows);
  // The oldest of them decides whether anything has been *sitting*. An
  // unparseable stamp is skipped rather than treated as the beginning of time,
  // which would turn one malformed row into a permanent reminder.
  let oldestWaitingAt: number | null = null;
  for (const row of rows) {
    const at = Date.parse(row.created_at);
    if (!Number.isFinite(at)) continue;
    if (oldestWaitingAt === null || at < oldestWaitingAt) oldestWaitingAt = at;
  }

  return {
    ownerId,
    waitingCount,
    oldestWaitingAt,
    locale,
    // Live groups only. `useGroups` materialises what the group picker shows,
    // which is the right list for this: archived groups are filtered out of it,
    // and somebody whose only group is last year's trip — archived, finished,
    // settled — is not somebody to ask in the evening whether they have a bill
    // to split. It is a coarse gate on purpose; the cost of it being briefly
    // wrong (a membership the mirror has not caught up on) is one gentle
    // question, which is why it is not worth a second membership query here.
    hasGroup: (groups.data ?? []).length > 0,
    ready: ownerId !== '' && !captures.isLoading && !groups.isLoading,
  };
}

/** Runs a pass with whatever is true right now. Safe to call from an event handler. */
export function useCaptureNudgePass(inputs: NudgePassInputs): () => void {
  const { t } = useStrings();
  const { ownerId, waitingCount, oldestWaitingAt, locale, ready, hasGroup } = inputs;

  return useCallback(() => {
    if (!ready) return;
    void syncCaptureNudge({
      ownerId,
      waitingCount,
      oldestWaitingAt,
      locale,
      now: Date.now(),
      // Rendered here, in the app's current language, because the words are
      // baked into the OS alarm at schedule time. `planCaptureNudge` reschedules
      // on a language change for exactly that reason.
      hasGroup,
      text: (kind, count) =>
        kind === NudgeKind.CheckIn
          ? // A question, not a claim: this phone does not know whether anything
            // was spent today, so the words never say that anything was.
            { title: t.captures.checkInTitle, body: t.captures.checkInBody }
          : {
              // The title never counts — the badge does, and the body says what
              // the badge is counting. See `captures.nudgeTitle` for why.
              title: t.captures.nudgeTitle,
              body: plural(locale, count, t.captures.nudgeBody),
            },
    }).catch((error: unknown) => reportHandled(error, 'captureNudge.sync'));
  }, [ready, ownerId, waitingCount, oldestWaitingAt, locale, hasGroup, t]);
}
