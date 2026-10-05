/**
 * When to ask about notifications again, and what the button does. Pure, so the
 * cadence is testable without a clock or a phone; storage and the OS live in
 * `pushPromptStore` and `lib/push`.
 *
 * A person who is not receiving pushes is missing things without knowing it, so
 * the ask comes back — but gently: every two days for the first three "not
 * now"s, then weekly. A fresh group join is a better moment than any timer, so
 * it may ask sooner, though never more than once a day.
 */

// Type-only, so this stays testable without the native modules `push` loads.
import type { PushPermission } from './push';

type Permission = `${PushPermission}`;

const DAY_MS = 24 * 60 * 60 * 1000;
export const EARLY_GAP_MS = 2 * DAY_MS;
export const LATE_GAP_MS = 7 * DAY_MS;
export const JOIN_GAP_MS = DAY_MS;
/** Dismissals that still get the short gap. */
export const EARLY_DISMISSALS = 3;

export interface PushPromptState {
  /** When the prompt was last put on screen, in ms; null if never. */
  lastShownAt: number | null;
  dismissCount: number;
}

export const EMPTY_PUSH_PROMPT_STATE: PushPromptState = { lastShownAt: null, dismissCount: 0 };

export function shouldShowPushPrompt(input: {
  now: number;
  state: PushPromptState;
  permission: Permission;
  /** Just joined a group by invite: a valid moment to ask ahead of the timer. */
  afterJoin?: boolean;
}): boolean {
  const { now, state, permission, afterJoin = false } = input;
  if (permission === 'granted') return false;
  if (state.lastShownAt === null) return true;
  const elapsed = now - state.lastShownAt;
  // A clock that moved backwards must not silence the prompt for months.
  if (elapsed < 0) return true;
  if (afterJoin) return elapsed >= JOIN_GAP_MS;
  const gap = state.dismissCount < EARLY_DISMISSALS ? EARLY_GAP_MS : LATE_GAP_MS;
  return elapsed >= gap;
}

/** Ask the system, or send them to settings where it will not show its dialog. */
export function pushCtaAction(input: {
  permission: Permission;
  canAskAgain: boolean;
}): 'request' | 'settings' {
  if (input.permission === 'granted') return 'request';
  if (input.permission === 'undetermined') return 'request';
  return input.canAskAgain ? 'request' : 'settings';
}

export function parsePushPromptState(raw: string | null): PushPromptState {
  if (!raw) return EMPTY_PUSH_PROMPT_STATE;
  try {
    const value = JSON.parse(raw) as Partial<PushPromptState> | null;
    const last = value?.lastShownAt;
    const count = value?.dismissCount;
    return {
      lastShownAt: typeof last === 'number' && Number.isFinite(last) ? last : null,
      dismissCount:
        typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
    };
  } catch {
    return EMPTY_PUSH_PROMPT_STATE;
  }
}
