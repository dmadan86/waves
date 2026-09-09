/**
 * The personal ledger's unlock: one state for the whole section.
 *
 * The bug these started from: the gate timed an unlock from the moment the
 * sensor was touched, so browsing the Me tab for longer than the grace window
 * meant the walk into "add income" and back asked again, and a refused prompt
 * navigated the user backwards. The clock now runs only while the user is
 * away, and "away" is read off the router rather than off focus events — which
 * is what makes the cases below decidable at all rather than races with a
 * timing constant.
 *
 * Every case in the second half is a review probe against PR #742, kept as the
 * spec it was written as.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  afterPersonalAuth,
  afterPersonalLeave,
  afterPersonalReturn,
  beginPersonalCheck,
  DEFAULT_IDLE_GRACE_SECONDS,
  endPersonalCheck,
  getPersonalLockState,
  isPersonalSection,
  isPersonalUnlocked,
  lockAwayTransition,
  lockPersonal,
  markPersonalUnlocked,
  personalAppActive,
  personalAppAway,
  PERSONAL_LOCKED,
  personalPresent,
  personalUnlockedNow,
  resetPersonalLockForTests,
  setPersonalPresence,
  subscribePersonalLock,
  syncPersonalAccount,
} from '@/lib/personalLock';

const GRACE = DEFAULT_IDLE_GRACE_SECONDS;
const T0 = 1_700_000_000_000;

afterEach(() => {
  resetPersonalLockForTests();
  vi.useRealTimers();
});

describe('isPersonalSection', () => {
  it('claims the Me tab and every room under personal/', () => {
    expect(isPersonalSection(['(tabs)', 'me'])).toBe(true);
    expect(isPersonalSection(['me'])).toBe(true);
    expect(isPersonalSection(['personal', 'entry'])).toBe(true);
    expect(isPersonalSection(['personal', 'source', '[id]'])).toBe(true);
  });

  it('claims nothing else', () => {
    expect(isPersonalSection(['(tabs)', 'index'])).toBe(false);
    expect(isPersonalSection(['group', '[id]', 'add-expense'])).toBe(false);
    expect(isPersonalSection(['settings', 'lock'])).toBe(false);
    expect(isPersonalSection([])).toBe(false);
  });
});

describe('isPersonalUnlocked', () => {
  it('is shut until something has been proved', () => {
    expect(isPersonalUnlocked(PERSONAL_LOCKED, T0, GRACE)).toBe(false);
  });

  it('stays open indefinitely while the user is still in the section', () => {
    const state = afterPersonalAuth(T0, true);
    // An hour of reading the ledger is not a reason to ask again.
    expect(isPersonalUnlocked(state, T0 + 3_600_000, GRACE)).toBe(true);
  });

  it('opens on a return inside the idle window', () => {
    const away = afterPersonalLeave(afterPersonalAuth(T0, true), T0 + 5_000);
    expect(isPersonalUnlocked(away, T0 + 5_000 + (GRACE - 1) * 1000, GRACE)).toBe(true);
  });

  it('shuts once the idle window has run out', () => {
    const away = afterPersonalLeave(afterPersonalAuth(T0, true), T0 + 5_000);
    expect(isPersonalUnlocked(away, T0 + 5_000 + GRACE * 1000, GRACE)).toBe(false);
  });

  it('counts only the first departure, so a second leave cannot extend the grace', () => {
    const first = afterPersonalLeave(afterPersonalAuth(T0, true), T0 + 1_000);
    const second = afterPersonalLeave(first, T0 + 9_000);
    expect(second.awaySince).toBe(T0 + 1_000);
  });
});

describe('afterPersonalReturn', () => {
  it('stops the clock when the return is inside the window', () => {
    const away = afterPersonalLeave(afterPersonalAuth(T0, true), T0 + 1_000);
    const back = afterPersonalReturn(away, T0 + 2_000, GRACE);
    expect(back.awaySince).toBe(null);
    expect(back.unlockedAt).toBe(T0);
  });

  it('spends the unlock when the return is past the window', () => {
    const away = afterPersonalLeave(afterPersonalAuth(T0, true), T0 + 1_000);
    expect(afterPersonalReturn(away, T0 + 1_000 + GRACE * 1000, GRACE)).toEqual(PERSONAL_LOCKED);
  });
});

describe('the live store', () => {
  it('keeps one unlock across navigation inside the section', () => {
    setPersonalPresence(true, GRACE, T0);
    markPersonalUnlocked(T0);

    // Push into "add income": one personal route replaces another, so the
    // watcher reports the same answer and presence never moves.
    setPersonalPresence(isPersonalSection(['personal', 'entry']), GRACE, T0 + 60_000);

    // A minute inside the section is well past the grace window, and it makes
    // no difference: nobody left.
    expect(personalUnlockedNow(GRACE, T0 + 60_000)).toBe(true);
    expect(getPersonalLockState().awaySince).toBe(null);
  });

  it('survives a push however long the incoming screen takes, even at "straight away"', () => {
    // The review probe that broke the focus-counter model: with a zero-second
    // window, a departure of any length at all re-locked. There is no departure
    // to time now — the path never left the section.
    setPersonalPresence(true, 0, T0);
    markPersonalUnlocked(T0);
    setPersonalPresence(isPersonalSection(['personal', 'entry']), 0, T0 + 120);
    expect(personalUnlockedNow(0, T0 + 120)).toBe(true);
    expect(personalUnlockedNow(0, T0 + 10_000)).toBe(true);
  });

  it('starts the clock on leaving the section', () => {
    setPersonalPresence(true, GRACE, T0);
    markPersonalUnlocked(T0);
    setPersonalPresence(false, GRACE, T0 + 1_000);

    expect(getPersonalLockState().awaySince).toBe(T0 + 1_000);
    expect(personalUnlockedNow(GRACE, T0 + 1_000 + (GRACE - 1) * 1000)).toBe(true);
    expect(personalUnlockedNow(GRACE, T0 + 1_000 + GRACE * 1000)).toBe(false);
  });

  it('at "straight away", leaving the section really does shut it', () => {
    setPersonalPresence(true, 0, T0);
    markPersonalUnlocked(T0);
    setPersonalPresence(false, 0, T0 + 1_000);
    setPersonalPresence(true, 0, T0 + 2_000);
    expect(personalUnlockedNow(0, T0 + 2_000)).toBe(false);
  });

  it('ignores a repeated presence report, so no departure can be re-stamped', () => {
    setPersonalPresence(true, GRACE, T0);
    markPersonalUnlocked(T0);
    setPersonalPresence(false, GRACE, T0 + 1_000);
    setPersonalPresence(false, GRACE, T0 + 9_000);
    expect(getPersonalLockState().awaySince).toBe(T0 + 1_000);
  });

  it('re-locks after the app has been in the background beyond the window', () => {
    setPersonalPresence(true, GRACE, T0);
    markPersonalUnlocked(T0);
    personalAppAway(T0 + 1_000);
    personalAppActive(GRACE, T0 + 1_000 + GRACE * 1000);
    expect(getPersonalLockState()).toEqual(PERSONAL_LOCKED);
  });

  it('does not re-lock after a glance at a notification', () => {
    setPersonalPresence(true, GRACE, T0);
    markPersonalUnlocked(T0);
    personalAppAway(T0 + 1_000);
    personalAppActive(GRACE, T0 + 6_000);
    expect(personalUnlockedNow(GRACE, T0 + 6_000)).toBe(true);
    expect(getPersonalLockState().awaySince).toBe(null);
  });

  it('leaves the clock running when the app comes back somewhere other than the section', () => {
    setPersonalPresence(true, GRACE, T0);
    markPersonalUnlocked(T0);
    setPersonalPresence(false, GRACE, T0 + 500); // off to the dashboard
    personalAppAway(T0 + 1_000);
    personalAppActive(GRACE, T0 + 2_000);
    // Coming back to the dashboard is still time spent away from the ledger,
    // and the clock started when the section was left, not when the app was.
    expect(getPersonalLockState().awaySince).toBe(T0 + 500);
  });

  it('is shut on a cold start', () => {
    expect(getPersonalLockState()).toEqual(PERSONAL_LOCKED);
    expect(personalUnlockedNow(GRACE, T0)).toBe(false);
  });

  it('is shut by sign-out', () => {
    setPersonalPresence(true, GRACE, T0);
    markPersonalUnlocked(T0);
    lockPersonal();
    expect(personalUnlockedNow(GRACE, T0)).toBe(false);
  });

  it('is not opened by a refused check', () => {
    setPersonalPresence(true, GRACE, T0);
    markPersonalUnlocked(T0);
    // What the gate does when authenticateAsync comes back unsuccessful.
    lockPersonal();
    expect(personalUnlockedNow(GRACE, T0)).toBe(false);
    // And re-entering the section does not resurrect the spent unlock.
    setPersonalPresence(false, GRACE, T0 + 1);
    setPersonalPresence(true, GRACE, T0 + 2);
    expect(personalUnlockedNow(GRACE, T0 + 2)).toBe(false);
  });

  it('tells its subscribers when the state moves, and only then', () => {
    const seen = vi.fn();
    const stop = subscribePersonalLock(seen);
    setPersonalPresence(true, GRACE, T0);
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

describe('an account change shuts the section', () => {
  it('locks when the session goes without passing through sign-out', () => {
    syncPersonalAccount('user-a');
    setPersonalPresence(true, GRACE, T0);
    markPersonalUnlocked(T0);

    // A revoked refresh token, a remote sign-out, an account deleted
    // elsewhere: the listener just sees the session go.
    syncPersonalAccount(null);
    expect(personalUnlockedNow(GRACE, T0)).toBe(false);
  });

  it('locks when a different account signs in during the same launch', () => {
    syncPersonalAccount('user-a');
    setPersonalPresence(true, GRACE, T0);
    markPersonalUnlocked(T0);
    syncPersonalAccount('user-b');
    expect(personalUnlockedNow(GRACE, T0)).toBe(false);
  });

  it('costs nothing on a token refresh, which reports the same account', () => {
    syncPersonalAccount('user-a');
    setPersonalPresence(true, GRACE, T0);
    markPersonalUnlocked(T0);
    syncPersonalAccount('user-a');
    expect(personalUnlockedNow(GRACE, T0 + 3_600_000)).toBe(true);
  });
});

describe('a result that lands after the user has gone', () => {
  it('does not open the section for good', () => {
    // Android's biometric sheet outlives the screen that raised it: back out of
    // the section, then present a fingerprint, and the success arrives for a
    // screen that is no longer there.
    setPersonalPresence(true, GRACE, T0);
    setPersonalPresence(false, GRACE, T0 + 1_000);
    expect(personalPresent()).toBe(false);

    markPersonalUnlocked(T0 + 2_000);
    // Worth the grace window and no more — not for ever.
    expect(personalUnlockedNow(GRACE, T0 + 2_000)).toBe(true);
    expect(personalUnlockedNow(GRACE, T0 + 2_000 + GRACE * 1000)).toBe(false);
    expect(personalUnlockedNow(GRACE, T0 + 10_000_000)).toBe(false);
  });

  it('opens without a clock when the user is still there', () => {
    setPersonalPresence(true, GRACE, T0);
    markPersonalUnlocked(T0);
    expect(getPersonalLockState().awaySince).toBe(null);
  });
});

describe('lockAwayTransition', () => {
  // Both listeners in lib/lock.tsx read transitions through this — the app lock
  // and the personal gate — so the one "Ask again after" window they share
  // cannot come to mean two different things.
  it('counts the app switcher, which iOS reports as inactive and nothing else', () => {
    // `background` only arrives once another app actually takes the foreground,
    // so a switcher swipe and a hand-over would never start the clock without
    // this — the exact case the lock is for.
    expect(lockAwayTransition('inactive')).toBe('away');
    expect(lockAwayTransition('background')).toBe('away');
  });

  it('counts coming back, and nothing else at all', () => {
    expect(lockAwayTransition('active')).toBe('back');
    expect(lockAwayTransition('extension')).toBe('ignore');
    expect(lockAwayTransition('unknown')).toBe('ignore');
  });
});

describe('the app switcher shuts the section', () => {
  it('starts the clock on inactive alone, with no background behind it', () => {
    setPersonalPresence(true, GRACE, T0);
    markPersonalUnlocked(T0);

    // Swipe into the switcher and hand the phone over. No `background` ever
    // arrives, because no other app takes over.
    if (lockAwayTransition('inactive') === 'away') personalAppAway(T0 + 1_000);

    expect(getPersonalLockState().awaySince).toBe(T0 + 1_000);
    expect(personalUnlockedNow(GRACE, T0 + 1_000 + GRACE * 1000)).toBe(false);
  });
});

describe("the app's own biometric prompt is not a departure", () => {
  it('survives the away reported from behind our own sheet', () => {
    // iOS turns inactive behind Face ID and some Android builds pause the
    // activity outright behind BiometricPrompt. Now that `inactive` counts as
    // leaving, this exclusion is what keeps a zero-second window from
    // re-locking the section because we asked it to unlock — and then asking
    // again, and again.
    setPersonalPresence(true, 0, T0);
    markPersonalUnlocked(T0);

    beginPersonalCheck();
    personalAppAway(T0 + 5);
    endPersonalCheck();
    personalAppActive(0, T0 + 10);

    expect(personalUnlockedNow(0, T0 + 10)).toBe(true);
    expect(getPersonalLockState().awaySince).toBe(null);
  });

  it('covers the app lock raising its own prompt, which is also not a departure', () => {
    // `unlock()` and the confirm inside `setEnabled` wrap themselves the same
    // way; without it, answering the app lock at a zero-second window would
    // stamp a personal departure and cost a second prompt straight after.
    setPersonalPresence(true, 0, T0);
    markPersonalUnlocked(T0);

    beginPersonalCheck();
    personalAppAway(T0 + 5); // inactive, behind the app lock's sheet
    personalAppActive(0, T0 + 20);
    endPersonalCheck();

    expect(personalUnlockedNow(0, T0 + 20)).toBe(true);
  });

  it('cannot leak the exclusion past a check that threw', () => {
    // The gate pairs these in a `finally`; this is the property that relies on.
    beginPersonalCheck();
    endPersonalCheck();
    setPersonalPresence(true, 0, T0);
    markPersonalUnlocked(T0);
    personalAppAway(T0 + 5);
    expect(getPersonalLockState().awaySince).toBe(T0 + 5);
  });

  it('still notices a real departure once the check is over', () => {
    setPersonalPresence(true, 0, T0);
    markPersonalUnlocked(T0);
    beginPersonalCheck();
    endPersonalCheck();
    personalAppAway(T0 + 5);
    personalAppActive(0, T0 + 10);
    expect(personalUnlockedNow(0, T0 + 10)).toBe(false);
  });
});
