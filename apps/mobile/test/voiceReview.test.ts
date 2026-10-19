import { describe, expect, it } from 'vitest';

import type { VoiceNameCandidate, VoiceParty } from '@waves/core';

import {
  currentQuestion,
  partyQuestion,
  reviewQueue,
  type PartyText,
  type ReviewOpen,
} from '@/lib/voiceReviewPure';

const none: ReviewOpen = {
  amount: false,
  currency: false,
  group: false,
  payer: false,
  people: false,
};

describe('the review asks one question at a time', () => {
  it('RV-01: nothing open means a settled review', () => {
    expect(reviewQueue(none)).toEqual([]);
    expect(currentQuestion(none)).toBeNull();
  });

  it('RV-02: amount, currency, group, payer, people - in that order, whatever is open', () => {
    const all: ReviewOpen = {
      amount: true,
      currency: true,
      group: true,
      payer: true,
      people: true,
    };
    expect(reviewQueue(all)).toEqual(['amount', 'currency', 'group', 'payer', 'people']);
    expect(currentQuestion(all)).toBe('amount');
  });

  it('RV-03: answering the first brings the next, not the ones after it', () => {
    const open = { ...none, group: true, people: true };
    expect(currentQuestion(open)).toBe('group');
    expect(currentQuestion({ ...open, group: false })).toBe('people');
    expect(currentQuestion({ ...open, group: false, people: false })).toBeNull();
  });

  it('RV-04: a payer question comes before an unknown participant', () => {
    expect(currentQuestion({ ...none, payer: true, people: true })).toBe('payer');
  });
});

describe('a heard name as a question', () => {
  const text: PartyText = {
    you: 'You',
    didYouMean: 'Did you mean {name}?',
    didYouMeanYes: 'Yes',
    whichOf: '{names} or {last}?',
  };
  const members: VoiceNameCandidate[] = [
    { id: 'm1', name: 'Madan', isMe: true },
    { id: 'm2', name: 'Ravi', isMe: false },
    { id: 'm3', name: 'Rajiv', isMe: false },
  ];
  const party = (status: VoiceParty['status'], ids: string[]): VoiceParty =>
    ({
      kind: 'member',
      name: 'Rav',
      status,
      candidates: ids.map((id) => members.find((member) => member.id === id)),
    }) as unknown as VoiceParty;

  it('RV-05: a suggestion is one Yes on the suggested member', () => {
    expect(partyQuestion(party('suggested', ['m2']), members, text)).toEqual({
      title: 'Did you mean Ravi?',
      options: [{ memberId: 'm2', label: 'Yes' }],
    });
  });

  it('RV-06: an ambiguous name is a pill per candidate, "You" for the speaker', () => {
    expect(partyQuestion(party('ambiguous', ['m1', 'm2', 'm3']), members, text)).toEqual({
      title: 'You, Ravi or Rajiv?',
      options: [
        { memberId: 'm1', label: 'You' },
        { memberId: 'm2', label: 'Ravi' },
        { memberId: 'm3', label: 'Rajiv' },
      ],
    });
  });

  it('RV-07: a settled name, a lone ambiguous candidate or a stranger asks nothing', () => {
    expect(partyQuestion(party('resolved', ['m2']), members, text)).toBeNull();
    expect(partyQuestion(party('ambiguous', ['m2']), members, text)).toBeNull();
    expect(partyQuestion(party('suggested', []), members, text)).toBeNull();
    const outsider = { ...party('suggested', []), candidates: [{ id: 'x', name: 'Zed' }] };
    expect(partyQuestion(outsider as unknown as VoiceParty, members, text)).toBeNull();
  });
});
