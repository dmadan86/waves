/**
 * The unlock state of the private personal ("Me") ledger — one state for the
 * whole section, held above every screen in it.
 *
 * The section is not one screen. Its home is the Me tab and its rooms are
 * `app/personal/*` — add an entry, the recurring rules, the loans, the budgets,
 * a source timeline. Walking between those rooms is not leaving the section, so
 * it must never cost another fingerprint: a gate that re-authenticates on every
 * push is a gate people route around, and the one before this did exactly that
 * (the freshness stamp was "when you last touched the sensor", so a browse
 * longer than the grace window meant the way back asked again).
 *
 * So the clock only runs while you are *away*: outside the section, or with the
 * app in the background. Inside it, an unlock lasts as long as you stay.
 *
 * Deliberately free of React and of react-native: this is where the decision
 * lives, and it is unit-tested as a plain reducer (see test/personalLock.test.ts).
 * The wiring — biometrics, AppState, focus — is in `lib/lock.tsx`.
 */

/**
 * How long the section may be left before it asks again, when the user has no
 * "Ask again after" preference stored. The lock setting (`lock.askAgainAfter`)
 * is the user's own auto-lock window and overrides this everywhere; this is
 * only the value in force until it has been read back off the device.
 *
 * Thirty seconds: long enough to be sent to a UPI app and come back, short
 * enough that a phone left on a table is not an open ledger.
 */
export const DEFAULT_IDLE_GRACE_SECONDS = 30;

/**
 * How long "no personal screen is focused" must hold before it counts as
 * having left the section.
 *
 * A push inside the section blurs one screen and focuses the next, and for the
 * instant between them nothing personal is focused. Without this settle that
 * gap would read as a departure, and with the window set to "Straight away" it
 * would re-lock on every single navigation — the very complaint this module
 * exists to answer. The departure is timestamped when the blur happened, not
 * when the timer fires, so the delay never lengthens anybody's grace.
 */
export const PERSONAL_LEAVE_SETTLE_MS = 50;

export interface PersonalLockState {
  /** When the device last proved who is holding it. `null` means locked. */
  readonly unlockedAt: number | null;
  /**
   * When the section (or the whole app) was last left, or `null` while the
   * user is still in it. Only this clock ages an unlock.
   */
  readonly awaySince: number | null;
}

/** Locked: nothing has been proved, so nothing is open. */
export const PERSONAL_LOCKED: PersonalLockState = { unlockedAt: null, awaySince: null };

/**
 * The wall clock, behind a call. The gate has to read it while rendering to
 * decide between ledger and shield, and the React Compiler forbids `Date.now()`
 * inline in a component body — the same reason `todayIso()` is hoisted.
 */
export function lockClockNow(): number {
  return Date.now();
}

/**
 * Whether the section is open right now.
 *
 * Unlocked and still here — open, for as long as that lasts. Unlocked but away
 * — open only until the idle window runs out. Never unlocked — shut.
 */
export function isPersonalUnlocked(
  state: PersonalLockState,
  now: number,
  idleSeconds: number,
): boolean {
  if (state.unlockedAt === null) return false;
  if (state.awaySince === null) return true;
  return now - state.awaySince < idleSeconds * 1000;
}

/** A successful check: open, and the idle clock stops. */
export function afterPersonalAuth(now: number): PersonalLockState {
  return { unlockedAt: now, awaySince: null };
}

/**
 * Leaving — the section blurred, or the app went to the background. The first
 * departure is the one that counts: iOS reports `inactive` on the way to
 * `background`, and treating the second as fresh would restart the clock at the
 * moment the phone was put down.
 */
export function afterPersonalLeave(state: PersonalLockState, now: number): PersonalLockState {
  if (state.awaySince !== null) return state;
  return { ...state, awaySince: now };
}

/**
 * Coming back. Within the window the clock simply stops again; past it the
 * unlock is spent and the section closes.
 */
export function afterPersonalReturn(
  state: PersonalLockState,
  now: number,
  idleSeconds: number,
): PersonalLockState {
  if (!isPersonalUnlocked(state, now, idleSeconds)) return PERSONAL_LOCKED;
  if (state.awaySince === null) return state;
  return { ...state, awaySince: null };
}

// --- The live store -------------------------------------------------------
//
// Module-scoped rather than React state on purpose: it has to outlive every
// screen in the section, because the whole point is that unmounting one and
// mounting the next changes nothing.

let current: PersonalLockState = PERSONAL_LOCKED;
const listeners = new Set<() => void>();

/**
 * How many personal screens are focused. In practice zero or one — a
 * navigator focuses one screen at a time — but counting rather than flagging
 * keeps the blur/focus pair of a push from ever losing track of itself.
 */
let present = 0;
let settling: ReturnType<typeof setTimeout> | null = null;

function commit(next: PersonalLockState): void {
  if (next.unlockedAt === current.unlockedAt && next.awaySince === current.awaySince) return;
  current = next;
  for (const listener of listeners) listener();
}

export function getPersonalLockState(): PersonalLockState {
  return current;
}

export function subscribePersonalLock(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether the section is open, read off the current state. A function call so
 * the clock is read inside it — the React Compiler forbids `Date.now()` inline
 * in a component, the same reason `todayIso()` is hoisted.
 */
export function personalUnlockedNow(idleSeconds: number, now = Date.now()): boolean {
  return isPersonalUnlocked(current, now, idleSeconds);
}

/** The device proved who is holding it. */
export function markPersonalUnlocked(now = Date.now()): void {
  commit(afterPersonalAuth(now));
}

/**
 * Shut the section: sign-out, and a check that failed or was cancelled. A
 * refused check must never leave a half-open gate behind it.
 */
export function lockPersonal(): void {
  commit(PERSONAL_LOCKED);
}

/** A personal screen took focus. */
export function enterPersonalSection(idleSeconds: number, now = Date.now()): void {
  if (settling !== null) {
    clearTimeout(settling);
    settling = null;
  }
  present += 1;
  commit(afterPersonalReturn(current, now, idleSeconds));
}

/**
 * A personal screen lost focus. Only the last one out closes the door, and only
 * once the navigation has settled — see `PERSONAL_LEAVE_SETTLE_MS`.
 */
export function leavePersonalSection(now = Date.now()): void {
  present = Math.max(0, present - 1);
  if (present > 0) return;
  if (settling !== null) clearTimeout(settling);
  settling = setTimeout(() => {
    settling = null;
    if (present > 0) return;
    commit(afterPersonalLeave(current, now));
  }, PERSONAL_LEAVE_SETTLE_MS);
}

/** The app went to the background or turned inactive. */
export function personalAppAway(now = Date.now()): void {
  commit(afterPersonalLeave(current, now));
}

/**
 * The app came back to the foreground. It only stops the clock when a personal
 * screen is actually focused — coming back to the dashboard is still time spent
 * away from the ledger.
 */
export function personalAppActive(idleSeconds: number, now = Date.now()): void {
  if (present === 0) return;
  commit(afterPersonalReturn(current, now, idleSeconds));
}

/** Test seam: forget everything, including who is on screen. */
export function resetPersonalLockForTests(): void {
  if (settling !== null) clearTimeout(settling);
  settling = null;
  present = 0;
  current = PERSONAL_LOCKED;
  listeners.clear();
}
