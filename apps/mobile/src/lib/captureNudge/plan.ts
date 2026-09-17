/**
 * Whether this phone should tap somebody on the shoulder about the expenses
 * they saved for later, and when.
 *
 * ## What this is a reminder about
 *
 * The capture inbox (A34) — "Saved for later" on screen — holds expenses caught
 * before they had a group: an amount, maybe a note and a photo of the bill,
 * waiting for somebody to say where they belong. The dashboard already carries
 * a badge for them, which works perfectly for anybody who opens the app. This
 * is for the drafts of somebody who does not: a receipt snapped on Friday night
 * and never placed is a spend nobody in the group ever sees.
 *
 * ## Why the whole decision is one pure function
 *
 * Everything that could turn this into a nag is a rule, and every rule is a
 * sentence about somebody's attention that must not be got wrong. So they are
 * written here, with no clock of their own, no storage and no notification API
 * — `now` and the stored history come in as arguments, and what comes back is a
 * verb. `restorePrompt.ts` is shaped the same way and for the same reason: the
 * conditions *are* the feature, and a condition buried in a component is a
 * condition nobody can test.
 *
 * ## The four rules, and what each one is protecting against
 *
 * **1. Never for nothing.** Zero waiting drafts is not a reminder; it is an app
 * that lies. This is also the one that must *cancel*: somebody who clears their
 * inbox on Tuesday afternoon must not be told on Tuesday evening about work
 * they have already done. That is the single most important correctness
 * property in this file, and it is why `Cancel` exists as an answer at all
 * rather than the schedule simply being left to expire.
 *
 * **2. Never the moment it is saved.** Saving a draft is not a reason to be
 * told about it — the person is holding the phone, looking at the screen that
 * says so. The honest trigger is that something has been *sitting*, so a draft
 * only counts once it is a day old (`SETTLE_MS`). A person who saves an expense
 * and places it an hour later never hears from this feature at all, which is
 * the correct outcome for the majority of drafts.
 *
 * **3. At a civilised hour.** The reminder lands at `NUDGE_HOUR` local — the
 * evening, when somebody is plausibly sorting out their day and the tap has
 * somewhere to go. The alternative, "fire as soon as a draft turns 24 hours
 * old", puts a notification at whatever hour the photo was taken, which for a
 * restaurant bill is close to midnight.
 *
 * **4. A hard ceiling.** At most one in any `CEILING_MS` window, whatever else
 * changes. The slot is daily, so in ordinary running the ceiling is never the
 * binding constraint — it exists for the days that are not ordinary. A phone
 * carried across time zones, a clock corrected, a person who assigns two of
 * five drafts and leaves three: each of those moves the slot, and without a
 * floor under the gap between fires, moving the slot is how one reminder
 * becomes three.
 *
 * ## What is deliberately not here
 *
 * **No amounts, ever.** A lock screen is readable without unlocking it. The
 * count of waiting drafts is in the text; what they cost is not, and the caller
 * has no parameter with which to put it there.
 *
 * **No second nudge.** If the first is ignored, nothing escalates. The drafts
 * stay in the inbox, the dashboard badge keeps its count, and the next evening
 * is the next chance — the app does not raise its voice.
 */

/**
 * Which of the two things the evening reminder can be about.
 *
 * One slot, one reminder, one switch: a phone that had something to say about
 * unfiled drafts *and* wanted to ask about the day would otherwise raise two
 * notifications in the same evening, which is how a helpful app becomes a noisy
 * one. Drafts win when both apply — a specific thing somebody left unfinished
 * beats a general invitation.
 */
export enum NudgeKind {
  /** Drafts have been sitting unfiled. Names how many. */
  Captures = 'captures',
  /**
   * Nothing is waiting and the app has not been opened today: an invitation to
   * put the day's spending in before it is forgotten. Says nothing factual
   * about what was or was not spent, because the phone does not know.
   */
  CheckIn = 'checkIn',
}

/** What the next pass should do with the reminder this phone holds. */
export enum NudgeAction {
  /** Leave things exactly as they are. The overwhelmingly common answer. */
  Keep = 'keep',
  /** There is one scheduled and it must not fire. */
  Cancel = 'cancel',
  /** Cancel whatever we hold, then schedule this. */
  Schedule = 'schedule',
}

/**
 * How long a draft has to have been sitting before it is worth mentioning.
 *
 * A day. Short enough that a Friday receipt is raised on Saturday evening while
 * the outing is still recent; long enough that nothing anybody saved today can
 * possibly generate a notification.
 */
export const SETTLE_MS = 24 * 60 * 60 * 1000;

/** Local wall-clock hour the reminder lands at. Early evening, not bedtime. */
export const NUDGE_HOUR = 19;

/**
 * The floor under the gap between two reminders. Twenty hours rather than
 * twenty-four so that a slot which drifts by an hour — a daylight-saving
 * change, a clock correction — does not skip a whole day; and well above the
 * "several times an evening" the rules above are written to prevent.
 */
export const CEILING_MS = 20 * 60 * 60 * 1000;

/** A reminder this phone has already handed to the operating system. */
export interface PendingNudge {
  /** Epoch ms it is set to fire at. */
  readonly fireAt: number;
  /** How many waiting drafts its text names. */
  readonly count: number;
  /** The language its text was written in. */
  readonly locale: string;
  /**
   * Which sentence it carries. Part of the comparison below, because a held
   * "3 expenses still need a group" and a held "anything to split today?" are
   * different reminders even when they are due at the same minute.
   */
  readonly kind: NudgeKind;
}

/** Everything that bears on whether to speak, and what to say. */
export interface NudgeInput {
  /** The switch on the notification settings screen. */
  readonly enabled: boolean;
  /** The operating system has actually granted permission. */
  readonly permitted: boolean;
  /**
   * Waiting drafts, counted the way a person counts them — a voice batch is
   * one, not one per spend (`foldedCaptureCount`).
   */
  readonly waitingCount: number;
  /** When the oldest waiting draft was saved. Null when none is waiting. */
  readonly oldestWaitingAt: number | null;
  /** Now, epoch ms. */
  readonly now: number;
  /**
   * The fire time of the last reminder that has actually gone off, or null if
   * none has. Never a reminder still in the future — one that has not fired
   * cannot have spent the ceiling.
   */
  readonly lastFiredAt: number | null;
  /**
   * When this phone last ran a pass — which it does whenever the app comes to
   * the foreground, so it is "when Waves was last opened" with no extra
   * bookkeeping. Null on a phone that has never run one.
   */
  readonly lastSeenAt: number | null;
  /**
   * Whether this account is in any group at all. Somebody with nowhere to put
   * an expense is not being invited to add one; the first thing they need is a
   * group, and a notification is not how that conversation should start.
   */
  readonly hasGroup: boolean;
  /** What the OS is currently holding for us, if anything. */
  readonly pending: PendingNudge | null;
  /** The app's current language, which the text is baked in. */
  readonly locale: string;
}

export type NudgePlan =
  | { readonly action: NudgeAction.Keep }
  | { readonly action: NudgeAction.Cancel }
  | {
      readonly action: NudgeAction.Schedule;
      readonly fireAt: number;
      readonly count: number;
      readonly kind: NudgeKind;
    };

/**
 * The next `NUDGE_HOUR` on the local clock, strictly after `now`.
 *
 * Local wall clock on purpose, and built by moving the *date* rather than by
 * adding 24 hours in milliseconds: across a daylight-saving boundary the two
 * disagree, and the one that keeps the reminder at seven in the evening is
 * this one. The same reason `localIsoDate` exists in the personal ledger —
 * `toISOString` shifts the day for everybody who is not on UTC.
 */
export function nextNudgeSlot(now: number): number {
  const at = new Date(now);
  at.setHours(NUDGE_HOUR, 0, 0, 0);
  if (at.getTime() <= now) at.setDate(at.getDate() + 1);
  return at.getTime();
}

/**
 * What to do with the phone's reminder, given what is waiting and what has
 * already been said.
 *
 * Every early return is a reason *not* to speak, and each one cancels rather
 * than merely declining to schedule: a condition that stops being true has to
 * take any reminder it already caused with it. A `Cancel` is only ever returned
 * when there is something to cancel, so the caller can act on the verb without
 * checking whether it is a no-op.
 */
export function planCaptureNudge(input: NudgeInput): NudgePlan {
  // "Say nothing" and "say nothing, and take back what was already said" are
  // the same decision with different consequences; which one applies depends
  // only on whether a reminder is outstanding.
  const silence = (): NudgePlan =>
    input.pending ? { action: NudgeAction.Cancel } : { action: NudgeAction.Keep };

  // The switch, and the permission behind it. A revoked permission is not just
  // a reason to stop scheduling — anything already scheduled has to go, since
  // on Android a granted-then-revoked permission leaves live alarms behind.
  if (!input.enabled || !input.permitted) return silence();

  // Drafts first, the day's invitation second — and only one of them, ever.
  const kind = whatToSay(input);
  if (kind === null) return silence();

  let fireAt = nextNudgeSlot(input.now);
  if (input.lastFiredAt !== null) {
    // The ceiling, enforced on fire times rather than on scheduling passes:
    // this function runs whenever the app comes forward, and a rule counted in
    // passes would be a rule about how often somebody opens Waves.
    const earliest = input.lastFiredAt + CEILING_MS;
    while (fireAt < earliest) fireAt = nextNudgeSlot(fireAt);
  }

  // Already holding exactly this. Rescheduling an identical reminder would tear
  // down and rebuild an OS alarm on every foreground for no visible change.
  const count = kind === NudgeKind.Captures ? input.waitingCount : 0;
  if (
    input.pending &&
    input.pending.fireAt === fireAt &&
    input.pending.count === count &&
    input.pending.locale === input.locale &&
    input.pending.kind === kind
  ) {
    return { action: NudgeAction.Keep };
  }

  // The count and the language are both baked into the text at schedule time,
  // so either one moving makes the held reminder wrong rather than merely
  // stale. A notification that says three when two are waiting is worse than
  // no notification, and one in a language the person has just switched away
  // from is the app forgetting a setting it was told about.
  return { action: NudgeAction.Schedule, fireAt, count, kind };
}

/**
 * Which sentence this evening deserves, or null for silence.
 *
 * The two conditions are deliberately different in kind. The drafts one is a
 * claim about work somebody left unfinished, and every guard on it exists so
 * the claim is true when it is made. The check-in makes no claim at all: it
 * asks whether anything needs splitting, which is a question this phone is
 * entitled to ask without knowing the answer.
 *
 * What the check-in *does* need is a reason to believe it is not interrupting.
 * "The app has not been opened today" is the honest one, and it is free —
 * `lastSeenAt` is written by the pass itself, which runs when the app comes
 * forward. Somebody who used Waves this afternoon is not asked in the evening
 * whether they remembered to use Waves.
 */
function whatToSay(input: NudgeInput): NudgeKind | null {
  // Drafts, when something has actually been sitting. Zero waiting is not a
  // reminder; it is an app that lies — and this is also the branch somebody
  // lands in the moment they place their last draft, which is what makes the
  // cancel above correct.
  const waiting = input.waitingCount > 0 && input.oldestWaitingAt !== null;
  // Nothing has been *sitting* yet: everything waiting was saved today, and the
  // person who saved it has seen the screen that says so.
  const settled = waiting && input.now - (input.oldestWaitingAt ?? 0) >= SETTLE_MS;
  if (settled) return NudgeKind.Captures;

  // Nowhere to put an expense means no invitation to add one.
  if (!input.hasGroup) return null;
  // Never on a day the app has been opened. A phone that has never run a pass
  // cannot have been opened today either, so null qualifies — but in practice
  // the first pass writes the stamp, so this is the second evening at the
  // earliest.
  if (input.lastSeenAt !== null && isSameLocalDay(input.lastSeenAt, input.now)) return null;
  return NudgeKind.CheckIn;
}

/**
 * Whether two instants fall on the same day by the phone's own clock.
 *
 * Local, and by calendar date rather than by a 24-hour window: "have I opened
 * this today" is a question about the day a person is living in, and a
 * millisecond subtraction answers a different one. The same reasoning as
 * `nextNudgeSlot`, and the same trap `localIsoDate` exists for in the personal
 * ledger.
 */
function isSameLocalDay(a: number, b: number): boolean {
  const first = new Date(a);
  const second = new Date(b);
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}
