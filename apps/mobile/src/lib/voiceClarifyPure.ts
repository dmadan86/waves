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
  if (views.length < 2 || views.length > 4) return [];
  // Every option titled the same ("₹80,000", "₹80,000") tells the reader nothing;
  // the detail is what tells them apart, so it becomes the title.
  const sameLabel = views.every((view) => view.label === views[0].label);
  if (sameLabel && views.every((view) => view.detail))
    return views.map((view) => ({ ...view, label: view.detail as string, detail: null }));
  return views;
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

/** A group the reader belongs to, as the "Another group" list needs it. */
export interface ClarifyGroup {
  readonly name: string;
  /** "Trip", "3 people": the secondary line, if any. */
  readonly detail?: string | null;
}

/**
 * The reader's other groups when the agent asked which group: every named
 * group not already offered, sorted by name. Empty unless at least one offered
 * option is one of the reader's groups, so an amount or person question never
 * grows a group list.
 */
export function otherGroupChoices(
  views: readonly ClarifyOptionView[],
  groups: readonly ClarifyGroup[],
): ClarifyOptionView[] {
  const key = (s: string) => s.trim().toLocaleLowerCase();
  const named = groups.filter((group) => group.name.trim());
  const names = new Set(named.map((group) => key(group.name)));
  const offered = new Set(views.flatMap((view) => [key(view.label), key(view.answer)]));
  if (![...offered].some((name) => names.has(name))) return [];
  const seen = new Set<string>();
  const rest: ClarifyOptionView[] = [];
  for (const group of named) {
    const name = group.name.trim();
    if (offered.has(key(name)) || seen.has(key(name))) continue;
    seen.add(key(name));
    rest.push({
      label: name,
      detail: group.detail?.trim() || null,
      answer: name,
      ...LOOKS.group!,
    });
  }
  return rest.sort((a, b) => a.label.localeCompare(b.label));
}

/** The choices matching a search, by any word of the name. Blank: all of them. */
export function filterGroupChoices(
  choices: readonly ClarifyOptionView[],
  query: string,
): ClarifyOptionView[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [...choices];
  return choices.filter((choice) => choice.label.toLocaleLowerCase().includes(q));
}
