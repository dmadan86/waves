/**
 * The review asks one question at a time. Everything that can be open at once
 * (an amount read two ways, a bare "dollars", a group, the payer, a person nobody
 * matched) is queued in a fixed order, and only the first is shown; the rest wait
 * until it is settled. Pure, so the order and the wording of a name question can
 * be tested without a phone.
 */

import type { VoiceNameCandidate, VoiceParty } from '@waves/core';

export type ReviewQuestion = 'amount' | 'currency' | 'group' | 'payer' | 'people';

/** Which questions are open right now. */
export type ReviewOpen = Readonly<Record<ReviewQuestion, boolean>>;

const ORDER: readonly ReviewQuestion[] = ['amount', 'currency', 'group', 'payer', 'people'];

/** Every open question, in the order they are asked. */
export function reviewQueue(open: ReviewOpen): ReviewQuestion[] {
  return ORDER.filter((question) => open[question]);
}

/** The one question to show, or null when the review is settled. */
export function currentQuestion(open: ReviewOpen): ReviewQuestion | null {
  return reviewQueue(open)[0] ?? null;
}

export interface PartyQuestion {
  title: string;
  /** One tap each; the tapped member settles the name. */
  options: { memberId: string; label: string }[];
}

export interface PartyText {
  you: string;
  /** "Did you mean {name}?" */
  didYouMean: string;
  didYouMeanYes: string;
  /** "{names} or {last}?" */
  whichOf: string;
}

/**
 * A heard name the review could not fill in on its own, as a question: "Did you
 * mean Renny?" with a Yes, or "Ravi or Rajiv?" with a choice each. Null when the
 * name is settled or has no member to offer.
 */
export function partyQuestion(
  party: VoiceParty,
  members: readonly VoiceNameCandidate[],
  text: PartyText,
): PartyQuestion | null {
  if (party.status !== 'suggested' && party.status !== 'ambiguous') return null;
  const candidates = (party.candidates ?? []).filter((candidate) =>
    members.some((member) => member.id === candidate.id),
  );
  const label = (candidate: VoiceNameCandidate): string =>
    candidate.isMe ? text.you : candidate.name;
  const first = candidates[0];
  if (!first) return null;
  if (party.status === 'suggested') {
    return {
      title: text.didYouMean.replace('{name}', label(first)),
      options: [{ memberId: first.id, label: text.didYouMeanYes }],
    };
  }
  if (candidates.length < 2) return null;
  const names = candidates.map(label);
  return {
    title: text.whichOf
      .replace('{names}', names.slice(0, -1).join(', '))
      .replace('{last}', names[names.length - 1] ?? ''),
    options: candidates.map((candidate) => ({ memberId: candidate.id, label: label(candidate) })),
  };
}
