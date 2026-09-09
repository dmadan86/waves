/**
 * The personal ledger's unlock: one state for the whole section.
 *
 * The bug these cover: the gate used to time an unlock from the moment the
 * sensor was touched, so browsing the Me tab for longer than the grace window
 * meant the walk into "add income" and back asked again — and a refused prompt
 * navigated the user backwards. Here the clock only runs while the user is
 * away, so staying inside the section costs nothing however long it takes.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  afterPersonalAuth,
  afterPersonalLeave,
  afterPersonalReturn,
  DEFAULT_IDLE_GRACE_SECONDS,
  enterPersonalSection,
  getPersonalLockState,
  isPersonalUnlocked,
  leavePersonalSection,
  lockPersonal,
  markPersonalUnlocked,
  markPersonalUnlockedFromPrompt,
  personalAppActive,
  personalAppAway,
  PERSONAL_LEAVE_SETTLE_MS,
  PERSONAL_LOCKED,
  personalUnlockedNow,
  resetPersonalLockForTests,
  subscribePersonalLock,
} from '@/lib/personalLock';

const GRACE = DEFAULT_IDLE_GRACE_SECONDS;
const T0 = 1_700_000_000_000;

afterEach(() => {
  resetPersonalLockForTests();
  vi.useRealTimers();
});

describe('isPersonalUnlocked', () => {
  it('is shut until something has been proved', () => {
    expect(isPersonalUnlocked(PERSONAL_LOCKED, T0, GRACE)).toBe(false);
  });

  it('stays open indefinitely while the user is still in the section', () => {
    const state = afterPersonalAuth(T0);
    // An hour of reading the ledger is not a reason to ask again.
    expect(isPersonalUnlocked(state, T0 + 3_600_000, GRACE)).toBe(true);
  });

  it('opens on a return inside the idle window', () => {
    const away = afterPersonalLeave(afterPersonalAuth(T0), T0 + 5_000);
    expect(isPersonalUnlocked(away, T0 + 5_000 + (GRACE - 1) * 1000, GRACE)).toBe(true);
  });

  it('shuts once the idle window has run out', () => {
    const away = afterPersonalLeave(afterPersonalAuth(T0), T0 + 5_000);
    expect(isPersonalUnlocked(away, T0 + 5_000 + GRACE * 1000, GRACE)).toBe(false);
  });

  it('counts only the first departure, so iOS inactive-then-background does not restart the clock', () => {
    const inactive = afterPersonalLeave(afterPersonalAuth(T0), T0 + 1_000);
    const background = afterPersonalLeave(inactive, T0 + 1_200);
    expect(background.awaySince).toBe(T0 + 1_000);
  });
});

describe('afterPersonalReturn', () => {
  it('stops the clock when the return is inside the window', () => {
    const away = afterPersonalLeave(afterPersonalAuth(T0), T0 + 1_000);
    const back = afterPersonalReturn(away, T0 + 2_000, GRACE);
    expect(back.awaySince).toBe(null);
    expect(back.unlockedAt).toBe(T0);
  });

  it('spends the unlock when the return is past the window', () => {
    const away = afterPersonalLeave(afterPersonalAuth(T0), T0 + 1_000);
    expect(afterPersonalReturn(away, T0 + 1_000 + GRACE * 1000, GRACE)).toEqual(PERSONAL_LOCKED);
  });
});

describe('the live store', () => {
  it('keeps one unlock across navigation inside the section', () => {
    vi.useFakeTimers();
    markPersonalUnlocked(T0);
    enterPersonalSection(GRACE, T0); // the Me tab takes focus

    // Push into "add income": the tab blurs, then the new screen focuses.
    leavePersonalSection(T0 + 60_000);
    enterPersonalSection(GRACE, T0 + 60_000);
    vi.advanceTimersByTime(PERSONAL_LEAVE_SETTLE_MS * 4);

    // A minute inside the section is well past the grace window, and it makes
    // no difference: nobody left.
    expect(personalUnlockedNow(GRACE, T0 + 60_000)).toBe(true);
    expect(getPersonalLockState().awaySince).toBe(null);
  });

  it('does not re-lock on an intra-section push even with the window set to "straight away"', () => {
    vi.useFakeTimers();
    markPersonalUnlocked(T0);
    enterPersonalSection(0, T0);
    leavePersonalSection(T0 + 10);
    enterPersonalSection(0, T0 + 10);
    vi.advanceTimersByTime(PERSONAL_LEAVE_SETTLE_MS * 4);
    expect(personalUnlockedNow(0, T0 + 20)).toBe(true);
  });

  it('starts the clock once the last personal screen is gone', () => {
    vi.useFakeTimers();
    markPersonalUnlocked(T0);
    enterPersonalSection(GRACE, T0);
    leavePersonalSection(T0 + 1_000);
    vi.advanceTimersByTime(PERSONAL_LEAVE_SETTLE_MS * 4);

    expect(getPersonalLockState().awaySince).toBe(T0 + 1_000);
    expect(personalUnlockedNow(GRACE, T0 + 1_000 + (GRACE - 1) * 1000)).toBe(true);
    expect(personalUnlockedNow(GRACE, T0 + 1_000 + GRACE * 1000)).toBe(false);
  });

  it('re-locks after the app has been in the background beyond the window', () => {
    markPersonalUnlocked(T0);
    enterPersonalSection(GRACE, T0);
    personalAppAway(T0 + 1_000);
    personalAppActive(GRACE, T0 + 1_000 + GRACE * 1000);
    expect(getPersonalLockState()).toEqual(PERSONAL_LOCKED);
  });

  it('does not re-lock after a glance at a notification', () => {
    markPersonalUnlocked(T0);
    enterPersonalSection(GRACE, T0);
    personalAppAway(T0 + 1_000);
    personalAppActive(GRACE, T0 + 6_000);
    expect(personalUnlockedNow(GRACE, T0 + 6_000)).toBe(true);
    expect(getPersonalLockState().awaySince).toBe(null);
  });

  it('leaves the clock running when the app comes back somewhere other than the section', () => {
    markPersonalUnlocked(T0);
    personalAppAway(T0 + 1_000);
    personalAppActive(GRACE, T0 + 2_000);
    // Nothing personal is on screen, so the time away keeps counting.
    expect(getPersonalLockState().awaySince).toBe(T0 + 1_000);
  });

  it('is shut on a cold start', () => {
    expect(getPersonalLockState()).toEqual(PERSONAL_LOCKED);
    expect(personalUnlockedNow(GRACE, T0)).toBe(false);
  });

  it('is shut by sign-out', () => {
    markPersonalUnlocked(T0);
    enterPersonalSection(GRACE, T0);
    lockPersonal();
    expect(personalUnlockedNow(GRACE, T0)).toBe(false);
  });

  it('starts the away clock if a prompt success resolves after the section was left', () => {
    markPersonalUnlockedFromPrompt(T0);

    expect(getPersonalLockState()).toEqual({ unlockedAt: T0, awaySince: T0 });
    expect(personalUnlockedNow(GRACE, T0 + (GRACE - 1) * 1000)).toBe(true);
    expect(personalUnlockedNow(GRACE, T0 + GRACE * 1000)).toBe(false);
  });

  it('does not start the away clock when a prompt success resolves while the section is focused', () => {
    enterPersonalSection(GRACE, T0);
    markPersonalUnlockedFromPrompt(T0);

    expect(getPersonalLockState()).toEqual({ unlockedAt: T0, awaySince: null });
  });

  it('is not opened by a refused check', () => {
    markPersonalUnlocked(T0);
    // What the gate does when authenticateAsync comes back unsuccessful.
    lockPersonal();
    expect(personalUnlockedNow(GRACE, T0)).toBe(false);
    // And entering the section again does not resurrect the spent unlock.
    enterPersonalSection(GRACE, T0);
    expect(personalUnlockedNow(GRACE, T0)).toBe(false);
  });

  it('tells its subscribers when the state moves, and only then', () => {
    const seen = vi.fn();
    const stop = subscribePersonalLock(seen);
    markPersonalUnlocked(T0);
    expect(seen).toHaveBeenCalledTimes(1);
    // Same state again: nothing to say.
    markPersonalUnlocked(T0);
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
    lockPersonal();
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
