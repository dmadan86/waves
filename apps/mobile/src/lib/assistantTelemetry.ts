/**
 * The assistant's analytics: which step happened, never what was said.
 *
 * Ten events (spec 3.7), each with a fixed set of enum-word props. The set is
 * typed so a call with an unknown word does not compile, and checked again at
 * runtime so a value that sneaks past the types (an `as` cast, a string built
 * from a transcript) is dropped before it reaches `track`. The database applies
 * the same rules a third time in `waves_track_event`.
 *
 * Fire-and-forget like every `track`: it returns nothing and never throws.
 */

import { track } from '@/lib/events';

/** The follow-up question kinds (spec 2.8). */
export const FOLLOWUP_KINDS = [
  'place',
  'receipt',
  'split',
  'payer',
  'attendance',
  'trip',
  'wrapup',
  'recurring',
  'duplicate',
  'currency',
  'category',
  'date',
  'lend',
  'work',
  'payment',
] as const;
export type FollowUpKind = (typeof FOLLOWUP_KINDS)[number];

const SCOPES = ['personal', 'group'] as const;
export type AssistantScope = (typeof SCOPES)[number];

const OPENED_SOURCES = ['mic', 'hold', 'typed', 'quick', 'personal'] as const;
const ANSWER_SOURCES = ['chip', 'typed', 'voice'] as const;
const COMMAND_PATHS = ['fast', 'agent'] as const;
const ANSWER_PATHS = ['device', 'llm'] as const;
const COMMAND_OUTCOMES = ['confirmed', 'discarded', 'clarified', 'failed'] as const;
const SKIP_OUTCOMES = ['skipped', 'dismissed', 'done'] as const;
const MUTE_HOWS = ['manual', 'auto'] as const;
const CORRECTION_FIELDS = ['amount', 'date', 'description', 'group', 'currency'] as const;
const UNDO_WHATS = ['expense', 'answer', 'handoff'] as const;
const QUESTION_KINDS = ['balance', 'spend', 'budget'] as const;

/** Every assistant event and the exact words each of its props may take. */
export const ASSISTANT_PROP_VALUES = {
  assistant_opened: { source: OPENED_SOURCES },
  assistant_command: { path: COMMAND_PATHS, outcome: COMMAND_OUTCOMES, scope: SCOPES },
  assistant_followup_shown: { kind: FOLLOWUP_KINDS, scope: SCOPES },
  assistant_followup_answered: {
    kind: FOLLOWUP_KINDS,
    source: ANSWER_SOURCES,
    path: ANSWER_PATHS,
  },
  assistant_followup_skipped: { kind: FOLLOWUP_KINDS, outcome: SKIP_OUTCOMES },
  assistant_followup_muted: { kind: FOLLOWUP_KINDS, how: MUTE_HOWS },
  assistant_correction: { field: CORRECTION_FIELDS, path: ANSWER_PATHS },
  assistant_undo: { what: UNDO_WHATS },
  assistant_question_answered: { kind: QUESTION_KINDS, path: ANSWER_PATHS },
  assistant_teaser_viewed: { kind: FOLLOWUP_KINDS },
} as const;

export type AssistantEventName = keyof typeof ASSISTANT_PROP_VALUES;

/** The props one event takes, each one of its allowed words. */
export type AssistantProps<E extends AssistantEventName> = {
  [
    K in keyof (typeof ASSISTANT_PROP_VALUES)[E]
  ]?: (typeof ASSISTANT_PROP_VALUES)[E][K] extends readonly (infer V)[] ? V : never;
};

/**
 * Keeps only the keys this event defines, and only the words each one allows.
 * Anything else is dropped, not coerced.
 */
export function assistantProps(
  name: AssistantEventName,
  props: Readonly<Record<string, unknown>> | undefined,
): Record<string, string> {
  const allowed = ASSISTANT_PROP_VALUES[name] as Readonly<Record<string, readonly string[]>>;
  const clean: Record<string, string> = {};
  if (!props || typeof props !== 'object') return clean;
  for (const [key, words] of Object.entries(allowed)) {
    const value = props[key];
    if (typeof value === 'string' && words.includes(value)) clean[key] = value;
  }
  return clean;
}

/** Sends one assistant event. Never throws, never waits. */
export function trackAssistant<E extends AssistantEventName>(
  name: E,
  props?: AssistantProps<E>,
): void {
  try {
    track(name, assistantProps(name, props as Record<string, unknown> | undefined));
  } catch {
    // Analytics never reaches the caller.
  }
}

/** `personal` or `group`, from whether a saved expense has a group. */
export function scopeOf(groupId: string | null | undefined): AssistantScope {
  return groupId ? 'group' : 'personal';
}

/** The plans screen opened from an assistant teaser (existing `premium_viewed`). */
export function trackAssistantPremiumViewed(): void {
  try {
    track('premium_viewed', { screen: 'assistant_teaser' });
  } catch {
    // Never reaches the caller.
  }
}
