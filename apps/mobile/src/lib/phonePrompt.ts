/**
 * When to ask somebody for their phone number, and how firmly.
 *
 * A number on the account is how friends find you (`waves_find_person` reads
 * `auth.users.phone`), so an account without one is an account nobody can add
 * by the thing they actually know about you. The ask after sign-in is the fix,
 * and it stays optional: a popup put off daily at first, then less often.
 *
 * Not a hard wall from the first launch, on purpose. Waves works without a
 * number, App Review rejects apps that demand personal data they do not need,
 * and some people cannot receive an SMS on the day they install. Three days of
 * "Later" is room for all of that, with a longer pause after repeated asks.
 *
 * The answer lives on the device, one slot per account, the same as the tour
 * (`lib/onboardingSeen`): a second account signed in on the same phone starts
 * its own count rather than inheriting somebody else's patience.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** After this many "Later"s, wait 30 local days between asks. */
export const PHONE_PROMPT_LATER_LIMIT = 3;
export const PHONE_PROMPT_LATER_BACKOFF_DAYS = 30;

export enum PhonePromptMode {
  /** Nothing to show: a number is linked, it was put off today, or it does not apply. */
  Hidden = 'hidden',
  /** The ask, with a "Later" that hides it until tomorrow. */
  Soft = 'soft',
}

export interface PhonePromptState {
  /** How many times this account has pressed "Later". */
  readonly laterCount: number;
  /** The local day (`YYYY-MM-DD`) of the most recent "Later", if any. */
  readonly lastLaterOn: string | null;
}

export const EMPTY_PHONE_PROMPT_STATE: PhonePromptState = { laterCount: 0, lastLaterOn: null };

export interface PhonePromptFacts {
  /** The account already has a number. */
  readonly hasPhone: boolean;
  /** A guest: their own card already asks them to secure the account. */
  readonly isGuest: boolean;
  /** This build can verify a number at all (native Firebase is present). */
  readonly canVerify: boolean;
  /** The remote switch (`phone_link_prompt`). */
  readonly enabled: boolean;
}

/**
 * Which ask, if any. Pure, so the whole policy is one function a test can read.
 *
 * Guests are left to their own card: it carries the trial countdown this one
 * would hide, and "sign out" — this ask's last resort — would cost a guest
 * everything they entered.
 */
export function phonePromptMode(
  facts: PhonePromptFacts,
  state: PhonePromptState,
  today: string,
): PhonePromptMode {
  if (!facts.enabled || !facts.canVerify || facts.hasPhone || facts.isGuest) {
    return PhonePromptMode.Hidden;
  }
  if (state.lastLaterOn && daysBetween(state.lastLaterOn, today) < cooldownDays(state.laterCount)) {
    return PhonePromptMode.Hidden;
  }
  return PhonePromptMode.Soft;
}

function cooldownDays(laterCount: number): number {
  return laterCount > PHONE_PROMPT_LATER_LIMIT ? PHONE_PROMPT_LATER_BACKOFF_DAYS : 1;
}

function daysBetween(from: string, to: string): number {
  const parse = (day: string): number => {
    const [year, month, date] = day.split('-').map(Number);
    return Date.UTC(year, month - 1, date);
  };
  return Math.floor((parse(to) - parse(from)) / 86_400_000);
}

/** The state after one more "Later" today. */
export function withLater(state: PhonePromptState, today: string): PhonePromptState {
  return { laterCount: state.laterCount + 1, lastLaterOn: today };
}

/** Today as `YYYY-MM-DD` in the device's own zone — the unit "Later" counts in. */
export function localDay(now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA').format(now);
  } catch {
    // Local getters, not `toISOString` — that is UTC, and near midnight it
    // names a different day from the one on the person's phone.
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
}

const slot = (ownerId: string): string => `waves.phone_prompt.${ownerId}`;

/**
 * This account's count. Never rejects.
 *
 * Unreadable storage reads as a fresh start: the worst that costs is a soft ask
 * somebody already put off today, never a wall they had not yet reached.
 */
export async function readPhonePromptState(ownerId: string): Promise<PhonePromptState> {
  try {
    const raw = await AsyncStorage.getItem(slot(ownerId));
    if (!raw) return EMPTY_PHONE_PROMPT_STATE;
    const parsed = JSON.parse(raw) as Partial<PhonePromptState>;
    return {
      laterCount:
        typeof parsed.laterCount === 'number' && parsed.laterCount >= 0 ? parsed.laterCount : 0,
      lastLaterOn: typeof parsed.lastLaterOn === 'string' ? parsed.lastLaterOn : null,
    };
  } catch {
    return EMPTY_PHONE_PROMPT_STATE;
  }
}

/** Remember this account's count. Never rejects. */
export async function writePhonePromptState(
  ownerId: string,
  state: PhonePromptState,
): Promise<void> {
  try {
    await AsyncStorage.setItem(slot(ownerId), JSON.stringify(state));
  } catch {
    // A write that fails costs one repeat of the soft ask.
  }
}
