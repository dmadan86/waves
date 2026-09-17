/**
 * One pass: read what is true, ask `planCaptureNudge` what to do, do it.
 *
 * The shape is deliberate — the reads are all above the decision and the writes
 * are all below it, so the rules stay in a function with no clock and no
 * storage of its own. Everything this module adds is plumbing.
 *
 * The one piece of reasoning that lives here rather than in the planner is how
 * "the last reminder that actually fired" is recovered, because it is a fact
 * about storage rather than about people. `expo-notifications` reports no
 * deliveries and a fired notification simply leaves the scheduled list, so the
 * only evidence is the fire time we wrote down when we set it: once that moment
 * is in the past, the reminder went off. Which is also why a cancel only clears
 * the marker when it is still in the future — wiping the record of a reminder
 * that already happened would hand back the ceiling it spent.
 */

import { localNotificationsAllowed } from '@/lib/push';

import { NudgeAction, NudgeKind, planCaptureNudge, type NudgePlan } from './plan';
import {
  cancelNudges,
  clearNudgeBadge,
  dismissDeliveredNudges,
  pendingNudge,
  scheduleNudge,
  setNudgeBadge,
  type NudgeText,
} from './schedule';
import {
  loadCaptureNudgeEnabled,
  loadLastSeen,
  loadPlannedNudge,
  savePlannedNudge,
  saveLastSeen,
} from './settings';

export interface NudgeRunInput {
  readonly ownerId: string;
  /** Waiting drafts, folded the way the dashboard badge folds them. */
  readonly waitingCount: number;
  /** When the oldest of them was saved, epoch ms. Null when none is waiting. */
  readonly oldestWaitingAt: number | null;
  readonly locale: string;
  readonly now: number;
  /** Whether this account is in any group — see `whatToSay` in the planner. */
  readonly hasGroup: boolean;
  /** The reminder's words, in the app's current language. */
  readonly text: (kind: NudgeKind, count: number) => NudgeText;
}

/** Runs one pass and reports what it decided, which is what the tests read. */
export async function syncCaptureNudge(input: NudgeRunInput): Promise<NudgePlan> {
  if (!input.ownerId) return { action: NudgeAction.Keep };

  const [enabled, planned, permitted, pending, lastSeenAt] = await Promise.all([
    loadCaptureNudgeEnabled(input.ownerId),
    loadPlannedNudge(input.ownerId),
    localNotificationsAllowed(),
    pendingNudge(),
    loadLastSeen(input.ownerId),
  ]);

  const plan = planCaptureNudge({
    enabled,
    permitted,
    waitingCount: input.waitingCount,
    oldestWaitingAt: input.oldestWaitingAt,
    now: input.now,
    lastFiredAt: planned !== null && planned <= input.now ? planned : null,
    // Read before it is written below, so "has the app been opened today"
    // answers about the days before this pass rather than about this pass.
    lastSeenAt,
    hasGroup: input.hasGroup,
    pending,
    locale: input.locale,
  });

  if (plan.action === NudgeAction.Cancel) {
    await cancelNudges();
    if (planned !== null && planned > input.now) await savePlannedNudge(input.ownerId, null);
  } else if (plan.action === NudgeAction.Schedule) {
    const set = await scheduleNudge({
      fireAt: plan.fireAt,
      count: plan.count,
      locale: input.locale,
      kind: plan.kind,
      text: input.text(plan.kind, plan.count),
    });
    // Only once something really is scheduled. A marker written for a reminder
    // the OS refused would spend the ceiling on silence.
    if (set) await savePlannedNudge(input.ownerId, plan.fireAt);
  }

  // The icon, last — after the OS work rather than before it, because setting a
  // reminder cancels the one we held and cancelling takes the badge down with
  // it. Written from here on every pass, so it carries what is waiting *now*
  // rather than the figure some earlier reminder happened to be scheduled with;
  // see `setNudgeBadge` for why that reminder's own badge was not enough.
  //
  // Never over a cancel, though. A cancel is this feature being switched off —
  // the reminder turned off in settings, or notification permission withdrawn —
  // and putting the count straight back on the icon would leave a notification
  // signal standing for a notification somebody has just refused. The badge
  // belongs to the reminder; when there is no reminder there is no badge.
  if (plan.action === NudgeAction.Cancel) {
    // `cancelNudges` above already cleared it.
  } else if (input.waitingCount > 0 && input.oldestWaitingAt !== null) {
    await setNudgeBadge(input.waitingCount);
  } else {
    await clearNudgeBadge();
  }

  // The app is in front of somebody now. Written after the decision above has
  // read the previous value, and on every pass rather than only on the ones
  // that schedule something — it is a record of use, not of reminders.
  await saveLastSeen(input.ownerId, input.now);

  // And only ever one reminder in the shade. Yesterday's card, left unread, is
  // a stale count on a lock screen — and on the launchers that badge by
  // notification count rather than by the number a notification carries, the
  // pile of them is the number on the icon.
  await dismissDeliveredNudges();

  return plan;
}
