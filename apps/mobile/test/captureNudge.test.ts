/**
 * The rules that keep the phone's own reminder from becoming a nag.
 *
 * Every case here is one of the things this feature could do wrong to somebody:
 * speak about nothing, speak about work they have already done, speak the
 * moment they saved something, speak twice in an evening, or speak in a
 * language they have just switched away from. The planner is pure precisely so
 * that each of those is a two-line assertion rather than a device you have to
 * be holding at seven in the evening.
 */

import { describe, expect, it } from 'vitest';

import {
  CEILING_MS,
  NUDGE_HOUR,
  NudgeAction,
  nextNudgeSlot,
  planCaptureNudge,
  SETTLE_MS,
  type NudgeInput,
} from '@/lib/captureNudge/plan';
import {
  clearCaptureNudge,
  loadCaptureNudgeEnabled,
  loadPlannedNudge,
  saveCaptureNudgeEnabled,
  savePlannedNudge,
} from '@/lib/captureNudge/settings';

/** Local wall clock, which is the only clock this feature reasons in. */
function at(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

const NOW = at(2026, 3, 10, 11);

function input(overrides: Partial<NudgeInput> = {}): NudgeInput {
  return {
    enabled: true,
    permitted: true,
    waitingCount: 3,
    // Saved two days ago, so the settling rule is satisfied by default and each
    // test below only has to state the one thing it is about.
    oldestWaitingAt: NOW - 2 * SETTLE_MS,
    now: NOW,
    lastFiredAt: null,
    pending: null,
    locale: 'en',
    ...overrides,
  };
}

describe('nextNudgeSlot', () => {
  it('lands on the evening hour in local time, never UTC', () => {
    const slot = new Date(nextNudgeSlot(at(2026, 3, 10, 11)));
    expect(slot.getHours()).toBe(NUDGE_HOUR);
    expect(slot.getMinutes()).toBe(0);
    expect(slot.getDate()).toBe(10);
  });

  it('moves to tomorrow once the hour has passed', () => {
    const slot = new Date(nextNudgeSlot(at(2026, 3, 10, 19, 1)));
    expect(slot.getDate()).toBe(11);
    expect(slot.getHours()).toBe(NUDGE_HOUR);
  });

  it('treats the hour itself as gone, so a slot is never scheduled for now', () => {
    const slot = new Date(nextNudgeSlot(at(2026, 3, 10, 19, 0)));
    expect(slot.getDate()).toBe(11);
  });
});

describe('planCaptureNudge', () => {
  it('schedules for this evening when drafts have been sitting', () => {
    const plan = planCaptureNudge(input());
    expect(plan.action).toBe(NudgeAction.Schedule);
    if (plan.action !== NudgeAction.Schedule) throw new Error('unreachable');
    expect(plan.count).toBe(3);
    expect(new Date(plan.fireAt).getHours()).toBe(NUDGE_HOUR);
  });

  it('says nothing when nothing is waiting', () => {
    expect(planCaptureNudge(input({ waitingCount: 0, oldestWaitingAt: null }))).toEqual({
      action: NudgeAction.Keep,
    });
  });

  /**
   * The single most important property in the feature: placing the last draft
   * has to take back a reminder that was already set, not merely stop the next
   * one. Being told in the evening about work you finished at lunchtime is how
   * an app's notifications get turned off for good.
   */
  it('cancels a pending reminder once everything has been placed', () => {
    const plan = planCaptureNudge(
      input({
        waitingCount: 0,
        oldestWaitingAt: null,
        pending: { fireAt: at(2026, 3, 10, 19), count: 3, locale: 'en' },
      }),
    );
    expect(plan).toEqual({ action: NudgeAction.Cancel });
  });

  it('says nothing when the switch is off, and cancels what the switch already caused', () => {
    expect(planCaptureNudge(input({ enabled: false }))).toEqual({ action: NudgeAction.Keep });
    expect(
      planCaptureNudge(
        input({
          enabled: false,
          pending: { fireAt: at(2026, 3, 10, 19), count: 3, locale: 'en' },
        }),
      ),
    ).toEqual({ action: NudgeAction.Cancel });
  });

  it('says nothing without permission, however the switch is set', () => {
    expect(planCaptureNudge(input({ permitted: false }))).toEqual({ action: NudgeAction.Keep });
    expect(
      planCaptureNudge(
        input({
          permitted: false,
          pending: { fireAt: at(2026, 3, 10, 19), count: 3, locale: 'en' },
        }),
      ),
    ).toEqual({ action: NudgeAction.Cancel });
  });

  /** Saving a draft is not a reason to be told about it — you are right there. */
  it('waits a day before mentioning anything', () => {
    expect(planCaptureNudge(input({ oldestWaitingAt: NOW - 60 * 1000 }))).toEqual({
      action: NudgeAction.Keep,
    });
    expect(planCaptureNudge(input({ oldestWaitingAt: NOW - SETTLE_MS + 1000 }))).toEqual({
      action: NudgeAction.Keep,
    });
    expect(planCaptureNudge(input({ oldestWaitingAt: NOW - SETTLE_MS })).action).toBe(
      NudgeAction.Schedule,
    );
  });

  it('measures the wait from the oldest draft, not the newest', () => {
    // Two drafts: one from last week, one from a minute ago. The old one is
    // what the reminder is for, and the fresh one must not suppress it.
    const plan = planCaptureNudge(input({ waitingCount: 2, oldestWaitingAt: NOW - 7 * SETTLE_MS }));
    expect(plan.action).toBe(NudgeAction.Schedule);
  });

  describe('the ceiling', () => {
    it('never puts two reminders closer together than the floor allows', () => {
      // One fired an hour ago. This evening's slot is inside the window, so the
      // next one is pushed a day rather than landing the same night.
      const now = at(2026, 3, 10, 10);
      const plan = planCaptureNudge(
        input({ now, oldestWaitingAt: now - 2 * SETTLE_MS, lastFiredAt: now - 60 * 60 * 1000 }),
      );
      expect(plan.action).toBe(NudgeAction.Schedule);
      if (plan.action !== NudgeAction.Schedule) throw new Error('unreachable');
      expect(new Date(plan.fireAt).getDate()).toBe(11);
      expect(plan.fireAt - (now - 60 * 60 * 1000)).toBeGreaterThanOrEqual(CEILING_MS);
    });

    it('still allows one a day in ordinary running', () => {
      // Fired at seven last night; the app is opened five minutes later.
      const fired = at(2026, 3, 9, 19);
      const now = at(2026, 3, 9, 19, 5);
      const plan = planCaptureNudge(
        input({ now, oldestWaitingAt: now - 2 * SETTLE_MS, lastFiredAt: fired }),
      );
      expect(plan.action).toBe(NudgeAction.Schedule);
      if (plan.action !== NudgeAction.Schedule) throw new Error('unreachable');
      expect(plan.fireAt).toBe(at(2026, 3, 10, 19));
    });
  });

  describe('churn', () => {
    it('leaves an identical reminder alone', () => {
      const plan = planCaptureNudge(
        input({ pending: { fireAt: at(2026, 3, 10, 19), count: 3, locale: 'en' } }),
      );
      expect(plan).toEqual({ action: NudgeAction.Keep });
    });

    it('rewrites one whose count has gone stale', () => {
      // Two of five placed. A reminder that still says five is worse than none.
      const plan = planCaptureNudge(
        input({
          waitingCount: 3,
          pending: { fireAt: at(2026, 3, 10, 19), count: 5, locale: 'en' },
        }),
      );
      expect(plan.action).toBe(NudgeAction.Schedule);
      if (plan.action !== NudgeAction.Schedule) throw new Error('unreachable');
      expect(plan.count).toBe(3);
    });

    it('rewrites one after a language change', () => {
      // The words are baked into the OS alarm at schedule time, so a switch to
      // Tamil cannot reach a notification that is already set.
      const plan = planCaptureNudge(
        input({
          locale: 'ta',
          pending: { fireAt: at(2026, 3, 10, 19), count: 3, locale: 'en' },
        }),
      );
      expect(plan.action).toBe(NudgeAction.Schedule);
    });

    it('replaces a reminder whose payload could not be read', () => {
      // `pendingNudge` reports an unreadable one as fireAt 0 / count -1, which
      // can never match a real plan, so it is always swept away.
      const plan = planCaptureNudge(input({ pending: { fireAt: 0, count: -1, locale: '' } }));
      expect(plan.action).toBe(NudgeAction.Schedule);
    });
  });
});

describe('the stored switch', () => {
  it('is on for an account that has never touched it', async () => {
    expect(await loadCaptureNudgeEnabled('owner-never-asked')).toBe(true);
  });

  it('remembers a no, and does not read it back as an absent key', async () => {
    await saveCaptureNudgeEnabled('owner-a', false);
    expect(await loadCaptureNudgeEnabled('owner-a')).toBe(false);
    await saveCaptureNudgeEnabled('owner-a', true);
    expect(await loadCaptureNudgeEnabled('owner-a')).toBe(true);
  });

  /** A device is not always one person's. B must not inherit A's answer. */
  it('keeps one account out of another account', async () => {
    await saveCaptureNudgeEnabled('owner-shared', false);
    expect(await loadCaptureNudgeEnabled('owner-next-in')).toBe(true);
  });

  it('forgets everything on the way out', async () => {
    await saveCaptureNudgeEnabled('owner-leaving', false);
    await savePlannedNudge('owner-leaving', 1_700_000_000_000);
    await clearCaptureNudge('owner-leaving');
    expect(await loadCaptureNudgeEnabled('owner-leaving')).toBe(true);
    expect(await loadPlannedNudge('owner-leaving')).toBeNull();
  });

  it('round-trips the fire marker, and clears it on request', async () => {
    await savePlannedNudge('owner-marked', 1_700_000_000_000);
    expect(await loadPlannedNudge('owner-marked')).toBe(1_700_000_000_000);
    await savePlannedNudge('owner-marked', null);
    expect(await loadPlannedNudge('owner-marked')).toBeNull();
  });
});
