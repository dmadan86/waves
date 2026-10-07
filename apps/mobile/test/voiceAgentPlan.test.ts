import { describe, expect, it } from 'vitest';
import { VOICE_AGENT_SCHEMA_VERSION, type VoiceAgentResponse } from '@waves/core';

import {
  expenseWriteFromAction,
  planVoiceAgentActions,
  quotaLeft,
  type AgentLocalData,
  type VoiceAgentText,
} from '@/lib/voiceAgentPlan';
import { resultFromError } from '@/lib/voiceAgentPure';

const text: VoiceAgentText = {
  add: 'Add {amount}',
  paid: '{name} paid',
  you: 'You',
  splitEqual: 'split equally with {names}',
  splitJustPayer: 'not split',
  splitExact: 'split by amounts: {parts}',
  splitPercent: 'split by percent: {parts}',
  splitShares: 'split by shares: {parts}',
  justYou: 'Just for you',
  settle: '{from} paid {to} {amount}',
  remind: 'Remind {name} to settle',
  createGroup: 'Create group {name}',
  withPeople: 'with {names}',
  addMember: 'Add {name} to {group}',
  unknownGroup: 'Unknown group',
  unknownPerson: 'Unknown person',
};

const local: AgentLocalData = {
  groups: [
    {
      id: 'g1',
      name: 'Goa trip',
      currency: 'INR',
      members: [
        { id: 'm1', name: 'Madan', isViewer: true },
        { id: 'm2', name: 'Ravi', isViewer: false },
        { id: 'm3', name: 'Anu', isViewer: false },
      ],
    },
  ],
};

const quota = { used: 3, limit: 10, tier: 'free' as const };
const response = (actions: VoiceAgentResponse['actions']): VoiceAgentResponse => ({
  schemaVersion: VOICE_AGENT_SCHEMA_VERSION,
  transcript: 'dinner 500',
  actions,
  quota,
});

const dinner = {
  type: 'add_expense' as const,
  groupId: 'g1',
  description: 'Dinner',
  amountMinor: '50000',
  currency: 'INR',
  paidByMemberId: 'm1',
  split: {
    mode: 'equal' as const,
    shares: [{ memberId: 'm1' }, { memberId: 'm2' }, { memberId: 'm3' }],
  },
};

describe('planVoiceAgentActions', () => {
  it('describes an equal-split expense with names, money and group', () => {
    const plan = planVoiceAgentActions(response([dinner]), local, text);
    expect(plan.cards).toHaveLength(1);
    const card = plan.cards[0];
    expect(card.problem).toBe(false);
    expect(card.segments[0]).toMatch(/^Add .*500/);
    expect(card.segments.slice(1)).toEqual([
      'Dinner',
      'Goa trip',
      'You paid',
      'split equally with Ravi, Anu',
    ]);
  });

  it('flags an unknown group or member instead of trusting the id', () => {
    const plan = planVoiceAgentActions(
      response([
        { ...dinner, groupId: 'nope' },
        { ...dinner, paidByMemberId: 'ghost' },
        { ...dinner, amountMinor: '12.5' },
      ]),
      local,
      text,
    );
    expect(plan.cards.map((card) => card.problem)).toEqual([true, true, true]);
    expect(plan.cards[0].segments).toContain('Unknown group');
  });

  it('covers settlement, nudge, personal, create group and add member', () => {
    const plan = planVoiceAgentActions(
      response([
        {
          type: 'record_settlement',
          groupId: 'g1',
          fromMemberId: 'm2',
          toMemberId: 'm1',
          amountMinor: '25000',
          currency: 'INR',
        },
        { type: 'nudge', groupId: 'g1', toMemberId: 'm3', currency: 'INR' },
        {
          type: 'add_personal',
          description: 'Coffee',
          amountMinor: '15000',
          currency: 'INR',
        },
        {
          type: 'create_group',
          name: 'Flat',
          groupType: 'home',
          currency: 'INR',
          memberNames: ['Ravi', 'Anu'],
        },
        { type: 'add_member', groupId: 'g1', name: 'Priya' },
      ]),
      local,
      text,
    );
    expect(plan.cards.every((card) => !card.problem)).toBe(true);
    expect(plan.cards[0].segments[0]).toMatch(/^Ravi paid You .*250/);
    expect(plan.cards[1].segments).toEqual(['Remind Anu to settle', 'Goa trip']);
    expect(plan.cards[2].segments[2]).toBe('Just for you');
    expect(plan.cards[3].segments).toEqual(['Create group Flat', 'INR', 'with Ravi, Anu']);
    expect(plan.cards[4].segments).toEqual(['Add Priya to Goa trip']);
  });

  it('describes uneven splits', () => {
    const plan = planVoiceAgentActions(
      response([
        {
          ...dinner,
          split: {
            mode: 'percent',
            shares: [
              { memberId: 'm1', value: '50' },
              { memberId: 'm2', value: '50' },
            ],
          },
        },
      ]),
      local,
      text,
    );
    expect(plan.cards[0].segments[4]).toBe('split by percent: You 50%, Ravi 50%');
  });

  it('carries answer, clarify and the transcript through, trimmed or null', () => {
    const plan = planVoiceAgentActions(
      { ...response([]), answer: '  Anu owes you 1,250  ', clarify: '   ' },
      local,
      text,
    );
    expect(plan.answer).toBe('Anu owes you 1,250');
    expect(plan.clarify).toBeNull();
    expect(plan.transcript).toBe('dinner 500');
  });
});

describe('expenseWriteFromAction', () => {
  const group = local.groups[0];

  it('builds an equal split whose shares add up', () => {
    const write = expenseWriteFromAction(dinner, group, 'e1', '2026-10-07');
    expect(write).not.toBeNull();
    expect(write?.amount).toBe(50000n);
    expect(write?.payers).toEqual({ m1: 50000n });
    expect(write?.expenseDate).toBe('2026-10-07');
    const total = Object.values(write?.expectedShares ?? {}).reduce((a, b) => a + b, 0n);
    expect(total).toBe(50000n);
  });

  it('rejects exact shares that do not add up, and unknown members', () => {
    const bad = {
      ...dinner,
      split: {
        mode: 'exact' as const,
        shares: [
          { memberId: 'm1', value: '100' },
          { memberId: 'm2', value: '100' },
        ],
      },
    };
    expect(expenseWriteFromAction(bad, group, 'e1', '2026-10-07')).toBeNull();
    expect(
      expenseWriteFromAction({ ...dinner, paidByMemberId: 'x' }, group, 'e1', '2026-10-07'),
    ).toBeNull();
    expect(expenseWriteFromAction(dinner, undefined, 'e1', '2026-10-07')).toBeNull();
  });

  it('keeps an explicit date', () => {
    const write = expenseWriteFromAction({ ...dinner, date: '2026-10-01' }, group, 'e1', 'x');
    expect(write?.expenseDate).toBe('2026-10-01');
  });
});

describe('quotaLeft', () => {
  it('never goes below zero', () => {
    expect(quotaLeft({ used: 3, limit: 10, tier: 'free' })).toEqual({ left: 7, limit: 10 });
    expect(quotaLeft({ used: 12, limit: 10, tier: 'free' })).toEqual({ left: 0, limit: 10 });
  });
});

describe('voice agent error mapping', () => {
  it('maps codes and statuses to typed results', () => {
    expect(resultFromError('VOICE_AGENT_QUOTA', 402)).toEqual({ kind: 'quota' });
    expect(resultFromError(null, 503)).toEqual({ kind: 'unavailable' });
    expect(resultFromError('VOICE_AGENT_CLIP_TOO_LONG', null)).toEqual({ kind: 'too-long' });
    expect(resultFromError(null, 422)).toEqual({ kind: 'nothing-heard' });
    expect(resultFromError(null, 500)).toEqual({ kind: 'error' });
  });
});
