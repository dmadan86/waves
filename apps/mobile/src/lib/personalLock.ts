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
 * Whether a route belongs to the private section.
 *
 * Presence is read off the router, not off focus events. Focus arrives as a
 * blur and a focus with a gap between them, and every scheme for deciding
 * whether that gap was a departure — a counter, a settle timer — is a race with
 * a constant in it: too short and a slow focus re-locks mid-push, too long and
 * a real departure is forgiven. The path has no gap. A push from the Me tab to
 * `personal/entry` is one personal route replacing another, and presence never
 * so much as flickers.
 *
 * Group segments are dropped, so this holds whether the router reports
 * `['(tabs)', 'me']` or `['me']`.
 */
export function isPersonalSection(segments: readonly string[]): boolean {
  const first = segments.find(
    (part) => part !== '' && !(part.startsWith('(') && part.endsWith(')')),
  );
  return first === 'me' || first === 'personal';
}

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

/**
 * A successful check.
 *
 * `inside` is whether the user is actually in the section as the result lands.
 * A biometric prompt is a system window that outlives the screen that asked:
 * back out of the section with Android's sheet still up, then present a
 * fingerprint, and the success arrives for a screen that has gone. Stopping the
 * idle clock on that would open the ledger for good, so an unlock granted from
 * outside starts its clock immediately — it is worth exactly the grace window,
 * and nothing more.
 */
export function afterPersonalAuth(now: number, inside: boolean): PersonalLockState {
  return { unlockedAt: now, awaySince: inside ? null : now };
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

/** Whether the current route is in the section. Set from the router, once. */
let inside = false;

/**
 * How many biometric checks are up right now.
 *
 * The OS sheet is not part of our app: iOS reports `inactive` behind Face ID
 * and some Android builds pause the activity outright behind BiometricPrompt.
 * Counting our own prompt as the user leaving would re-lock the section because
 * we asked it to unlock — at a zero-second window, over and over. Suppressing
 * the away-clock while a check is up is safe by construction: we only ever ask
 * while the section is shut, so there is nothing open to protect.
 */
let checks = 0;

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
export function personalUnlockedNow(idleSeconds: number, now = lockClockNow()): boolean {
  return isPersonalUnlocked(current, now, idleSeconds);
}

/** The device proved who is holding it — see `afterPersonalAuth` on `inside`. */
export function markPersonalUnlocked(now = lockClockNow()): void {
  commit(afterPersonalAuth(now, inside));
}

/**
 * Shut the section: sign-out, a switch of account, and a check that failed or
 * was cancelled. A refused check must never leave a half-open gate behind it.
 */
export function lockPersonal(): void {
  commit(PERSONAL_LOCKED);
}

/** Whether the router currently has the user inside the section. */
export function personalPresent(): boolean {
  return inside;
}

/**
 * Which account is signed in, as far as this lock is concerned. Any change —
 * signing out, a session revoked from another device, a refresh that failed, a
 * different person signing in — shuts the section.
 *
 * Most sign-outs never pass through the app's own sign-out action, and this
 * store is module-scoped by design, so it outlives the React tree that was
 * unmounted around it. Without this, the next account signed in during the same
 * process launch would find the ledger already open. The rule lives here rather
 * than in the auth listener so it can be tested without a React tree.
 */
let account: string | null = null;

export function syncPersonalAccount(userId: string | null): void {
  if (userId === account) return;
  account = userId;
  lockPersonal();
}

/**
 * The route changed. One caller — the watcher in `LockProvider` — and it passes
 * what `isPersonalSection` made of the current segments, so arriving and
 * leaving are the same event seen from two sides.
 */
export function setPersonalPresence(
  next: boolean,
  idleSeconds: number,
  now = lockClockNow(),
): void {
  if (next === inside) return;
  inside = next;
  commit(next ? afterPersonalReturn(current, now, idleSeconds) : afterPersonalLeave(current, now));
}

/** A biometric check is going up. Pair every call with `endPersonalCheck`. */
export function beginPersonalCheck(): void {
  checks += 1;
}

export function endPersonalCheck(): void {
  checks = Math.max(0, checks - 1);
}

/**
 * What an `AppState` value means to this lock. A function rather than a
 * condition inlined in the listener, so the app lock and the personal gate
 * cannot drift into reading the same transitions differently.
 *
 * `inactive` counts as leaving. On iOS it is what the app switcher reports —
 * and `background` only follows once some other app actually takes over, so a
 * switcher swipe alone would otherwise never start the clock. That is exactly
 * the case the lock exists for: the phone gets handed over with the ledger
 * still on screen. It costs a false positive on a notification banner and a
 * control-centre pull, which every window above zero forgives anyway, and which
 * at "Straight away" is arguably what was asked for. Our own biometric sheet
 * also reports `inactive`, and that one is not a trade-off but a bug — it is
 * excluded by name, in `personalAppAway`, not by ignoring the whole transition.
 */
export function personalAppTransition(state: string): 'away' | 'back' | 'ignore' {
  if (state === 'background' || state === 'inactive') return 'away';
  if (state === 'active') return 'back';
  return 'ignore';
}

/**
 * The app went away — see `personalAppTransition` for what counts.
 *
 * A check in flight means the prompt we raised is the reason the app went
 * quiet, so this is a no-op until it resolves. Safe by construction: we only
 * ever ask while the section is shut, so nothing is being held open. iOS
 * reports `inactive` on the way *into* the sheet and `active` on the way out,
 * so the suppression window covers the whole of it.
 */
export function personalAppAway(now = lockClockNow()): void {
  if (checks > 0) return;
  commit(afterPersonalLeave(current, now));
}

/**
 * The app came back to the foreground. It only stops the clock when a personal
 * screen is actually focused — coming back to the dashboard is still time spent
 * away from the ledger.
 */
export function personalAppActive(idleSeconds: number, now = lockClockNow()): void {
  if (!inside) return;
  commit(afterPersonalReturn(current, now, idleSeconds));
}

/** Test seam: forget everything, including where the user is. */
export function resetPersonalLockForTests(): void {
  inside = false;
  checks = 0;
  account = null;
  current = PERSONAL_LOCKED;
  listeners.clear();
}
