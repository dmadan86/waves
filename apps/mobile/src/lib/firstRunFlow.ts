/**
 * The first-run flow (`app/start.tsx`): who sees it, and where it sends them.
 *
 * It is for brand-new accounts only. "New" is read from facts the phone
 * already has: no groups, and neither this flag nor the old three intro cards
 * answered for the account. Anyone else is marked seen so a later empty
 * account list (a deleted group) never brings it back.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { rememberOnboardingSeen } from '@/lib/onboardingSeen';
import { parseVoiceExpenses } from '@/lib/voiceExpense';

export const INTENTS = ['trip', 'flat', 'family', 'couple', 'own'] as const;
export type Intent = (typeof INTENTS)[number];

export const isIntent = (value: unknown): value is Intent =>
  typeof value === 'string' && (INTENTS as readonly string[]).includes(value);

export type FirstRunDecision = 'wait' | 'show' | 'skip' | 'mark-existing';

export function decideFirstRun(input: {
  /** This flow's own flag; null until storage has answered. */
  seen: boolean | null;
  /** The old intro cards' flag; null until storage has answered. */
  introSeen: boolean | null;
  groupsReady: boolean;
  groupCount: number;
}): FirstRunDecision {
  if (input.seen === true) return 'skip';
  if (input.seen === null || input.introSeen === null || !input.groupsReady) return 'wait';
  return input.groupCount > 0 || input.introSeen ? 'mark-existing' : 'show';
}

/** The join screen and short invite links: the first run must not pull someone off them. */
export const isInviteRoute = (path: string): boolean =>
  path === '/join' || path.startsWith('/join?') || path.startsWith('/r/');

/** Suggested group names, already in the person's language. */
export interface IntentNames {
  trip: string;
  flat: string;
  family: string;
  couple: string;
}

const GROUP_FOR: Record<Exclude<Intent, 'own'>, { type: string; name: keyof IntentNames }> = {
  trip: { type: 'trip', name: 'trip' },
  flat: { type: 'home', name: 'flat' },
  family: { type: 'other', name: 'family' },
  couple: { type: 'couple', name: 'couple' },
};

/** The Personal tab; swap for the questionnaire route once that screen ships. */
export const PERSONAL_ROUTE = '/me';
export const HOME_ROUTE = '/';

/**
 * Where the flow ends. The first shared intent (in the order picked) makes a
 * group; only "my own money" opens Personal; nothing picked goes Home.
 */
export function routeForIntents(intents: readonly Intent[], names: IntentNames): string {
  const shared = intents.find((i): i is Exclude<Intent, 'own'> => i !== 'own');
  if (shared) {
    const { type, name } = GROUP_FOR[shared];
    return `/new-group?type=${type}&name=${encodeURIComponent(names[name])}`;
  }
  return intents.includes('own') ? PERSONAL_ROUTE : HOME_ROUTE;
}

/** The sign-in's placeholder name is not a name anyone chose. */
export const nameForField = (displayName: string | null | undefined): string => {
  const name = (displayName ?? '').trim();
  return name === 'Guest' ? '' : name;
};

export interface HeardExpense {
  note: string;
  amount: number;
  /** Everyone in the split, the speaker included; null when nobody was named. */
  people: number | null;
}

/** What the mic heard, as the three facts the confirmation shows. Null when no amount came out. */
export function summariseHeard(transcript: string): HeardExpense | null {
  const parsed = parseVoiceExpenses(transcript, []);
  const item = parsed.items[0];
  if (!item) return null;
  // The names are whatever follows "with"; the parser's own note keeps them, so lift them out.
  const withText = /\bwith\s+(.+)$/i.exec(transcript)?.[1] ?? '';
  const named = withText.split(/,|\band\b|&/i).filter((part) => part.trim()).length;
  const note = (withText ? item.note.replace(withText, '') : item.note).trim();
  return {
    note: note || item.note,
    amount: item.amountMajor,
    people: parsed.splitCount ?? (named > 0 ? named + 1 : null),
  };
}

const slot = (ownerId: string): string => `waves.first_run_flow_seen.${ownerId}`;
const answers = new Map<string, boolean>();
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((listener) => listener());

/** Never rejects. Unreadable storage reports "seen": a phone that cannot answer must not trap anyone. */
export async function firstRunSeen(ownerId: string): Promise<boolean> {
  let seen = true;
  try {
    seen = (await AsyncStorage.getItem(slot(ownerId))) === 'yes';
  } catch {
    // keep the safe answer
  }
  answers.set(ownerId, seen);
  notify();
  return seen;
}

export async function firstRunSeenAfter(ownerId: string): Promise<void> {
  await Promise.all([rememberFirstRunSeen(ownerId), rememberOnboardingSeen(ownerId)]);
}

export async function rememberFirstRunSeen(ownerId: string): Promise<void> {
  answers.set(ownerId, true);
  notify();
  try {
    await AsyncStorage.setItem(slot(ownerId), 'yes');
  } catch {
    // costs one repeat, not a stuck screen
  }
}

/** The answer for this account: null until `firstRunSeen` has run. */
export function useFirstRunSeen(ownerId: string | null): boolean | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (ownerId ? (answers.get(ownerId) ?? null) : null),
  );
}
