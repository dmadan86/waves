/**
 * The pure half of the tappable clarification options: cleaning what the
 * agent sent, picking an icon and tint per option, and what Continue sends.
 * No React, so it is unit-tested.
 */

import type { VoiceClarifyOption } from '@waves/core';

export type ClarifyTint = 'peach' | 'sky' | 'mint' | 'lilac' | 'pink';

export interface ClarifyOptionView {
  readonly label: string;
  readonly detail: string | null;
  readonly answer: string;
  readonly icon: string;
  readonly tint: ClarifyTint;
}

const OTHER = { icon: 'help-circle-outline', tint: 'lilac' } as const;
const LOOKS: Readonly<Record<string, { icon: string; tint: ClarifyTint }>> = {
  food: { icon: 'cafe-outline', tint: 'peach' },
  amount: { icon: 'cash-outline', tint: 'peach' },
  trip: { icon: 'airplane-outline', tint: 'sky' },
  group: { icon: 'people-outline', tint: 'sky' },
  person: { icon: 'person-outline', tint: 'mint' },
  date: { icon: 'calendar-outline', tint: 'lilac' },
  other: OTHER,
};

/** Options the screen can show: 2-4 with a label and an answer, else none. */
export function clarifyOptionViews(
  options: readonly VoiceClarifyOption[] | undefined,
): ClarifyOptionView[] {
  if (!Array.isArray(options)) return [];
  const views: ClarifyOptionView[] = [];
  for (const option of options) {
    const label = typeof option?.label === 'string' ? option.label.trim() : '';
    const answer = typeof option?.answer === 'string' ? option.answer.trim() : '';
    if (!label || !answer) continue;
    const look = LOOKS[option.icon ?? ''] ?? OTHER;
    const detail = typeof option.detail === 'string' ? option.detail.trim() : '';
    views.push({ label, detail: detail || null, answer, ...look });
  }
  return views.length >= 2 && views.length <= 4 ? views : [];
}

/** The follow-up Continue sends for the chosen option, or null with no choice. */
export function clarifyFollowUp(
  views: readonly ClarifyOptionView[],
  selected: number | null,
  transcript: string,
  question: string,
): { transcript: string; question: string; answer: string } | null {
  const chosen = selected === null ? undefined : views[selected];
  if (!chosen) return null;
  return { transcript, question, answer: chosen.answer };
}

/**
 * The follow-up a typed answer sends: the same `{transcript, question}` plus
 * the answer the voice path would have produced, or null for blank input.
 */
export function typedFollowUp(
  typed: string,
  transcript: string,
  question: string,
): { transcript: string; question: string; answer: string } | null {
  const answer = typed.replace(/\s+/g, ' ').trim();
  if (!answer) return null;
  return { transcript, question, answer };
}
