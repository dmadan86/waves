import { describe, expect, it } from 'vitest';

import { parseVoiceIntent, resolveIntentPeople } from '@waves/core';

import { parseVoiceExpenses } from '../src/lib/voiceExpense';
import {
  EMPTY_NAME_MEMORY,
  learnedForGroup,
  MAX_VOICE_HINTS,
  parseNameMemory,
  recordNamePick,
  voiceNameHints,
  withAliases,
  type VoiceNameMemory,
} from '../src/lib/voiceNames';

const GOA = 'g-goa';
const FLAT = 'g-flat';
const MEMBERS = [
  { id: 'm-ravindra', name: 'Ravindra Reddy' },
  { id: 'm-pradeep', name: 'Pradeep' },
  { id: 'm-renny', name: 'Renny' },
  { id: 'm-me', name: 'Madan', isMe: true },
];

const pick = (memory: VoiceNameMemory, heard: string, memberId: string, groupId = GOA, at = 1) =>
  recordNamePick(memory, { heard, memberId, groupId, members: MEMBERS, now: at });

describe('voice name memory', () => {
  it('counts a confirmed phrase per group', () => {
    let memory = pick(EMPTY_NAME_MEMORY, 'Pravi', 'm-pradeep');
    memory = pick(memory, 'pravi', 'm-pradeep', GOA, 2);
    expect(learnedForGroup(memory, GOA)).toEqual([
      { heard: 'pravi', memberId: 'm-pradeep', count: 2 },
    ]);
    expect(learnedForGroup(memory, FLAT)).toEqual([]);
  });

  it('replaces a phrase picked for somebody else rather than keeping two to tie', () => {
    let memory = pick(EMPTY_NAME_MEMORY, 'rainy', 'm-renny');
    memory = pick(memory, 'rainy', 'm-pradeep', GOA, 2);
    expect(learnedForGroup(memory, GOA)).toEqual([
      { heard: 'rainy', memberId: 'm-pradeep', count: 1 },
    ]);
  });

  it('never learns "me" or nothing', () => {
    expect(pick(EMPTY_NAME_MEMORY, 'me', 'm-renny')).toBe(EMPTY_NAME_MEMORY);
    expect(pick(EMPTY_NAME_MEMORY, '  ', 'm-renny')).toBe(EMPTY_NAME_MEMORY);
  });

  it('makes a phrase confirmed twice an alias, unless somebody else is called that', () => {
    let memory = pick(EMPTY_NAME_MEMORY, 'ravi', 'm-ravindra');
    expect(memory.aliases).toEqual([]);
    memory = pick(memory, 'ravi', 'm-ravindra', GOA, 2);
    expect(memory.aliases).toEqual([{ alias: 'Ravi', memberId: 'm-ravindra', groupId: GOA }]);

    const withRavi = [...MEMBERS, { id: 'm-ravi', name: 'Ravi' }];
    let other = recordNamePick(EMPTY_NAME_MEMORY, {
      heard: 'ravi',
      memberId: 'm-ravindra',
      groupId: GOA,
      members: withRavi,
      now: 1,
    });
    other = recordNamePick(other, {
      heard: 'ravi',
      memberId: 'm-ravindra',
      groupId: GOA,
      members: withRavi,
      now: 2,
    });
    expect(other.aliases).toEqual([]);
  });

  it('puts aliases on the members, and drops one that now collides', () => {
    let memory = pick(EMPTY_NAME_MEMORY, 'ravi', 'm-ravindra');
    memory = pick(memory, 'ravi', 'm-ravindra', GOA, 2);
    const aliased = withAliases(MEMBERS, memory, GOA);
    expect(aliased.find((m) => m.id === 'm-ravindra')?.aliases).toEqual(['Ravi']);
    expect(withAliases(MEMBERS, memory, FLAT).find((m) => m.id === 'm-ravindra')?.aliases).toBe(
      undefined,
    );
    const joined = withAliases([...MEMBERS, { id: 'm-ravi', name: 'Ravi K' }], memory, GOA);
    expect(joined.find((m) => m.id === 'm-ravindra')?.aliases).toBe(undefined);
  });

  it('reads back what it wrote and survives anything else', () => {
    const memory = pick(EMPTY_NAME_MEMORY, 'pravi', 'm-pradeep');
    expect(parseNameMemory(JSON.stringify(memory))).toEqual(memory);
    expect(parseNameMemory(null)).toBe(EMPTY_NAME_MEMORY);
    expect(parseNameMemory('{nope')).toBe(EMPTY_NAME_MEMORY);
    expect(parseNameMemory('{"v":2}')).toBe(EMPTY_NAME_MEMORY);
    expect(
      parseNameMemory('{"v":1,"corrections":[{"heard":1}],"aliases":"x"}').corrections,
    ).toEqual([]);
  });

  it('feeds the resolver: a mishearing confirmed twice is filled in next time', () => {
    let memory = pick(EMPTY_NAME_MEMORY, 'pravi', 'm-pradeep');
    const once = parseVoiceIntent('pravi paid 500', {
      members: MEMBERS,
      learned: learnedForGroup(memory, GOA),
    });
    expect(once.payer.status).toBe('suggested');
    memory = pick(memory, 'pravi', 'm-pradeep', GOA, 2);
    const twice = resolveIntentPeople(parseVoiceIntent('pravi paid 500', {}), MEMBERS, {
      learned: learnedForGroup(memory, GOA),
    });
    expect(twice.payer).toMatchObject({ status: 'resolved', memberId: 'm-pradeep' });
  });
});

describe('voice name hints', () => {
  it('lists display names, aliases and first names once each', () => {
    expect(
      voiceNameHints([
        { name: 'Ravindra Reddy', aliases: ['Ravi'] },
        { name: 'Renny' },
        { name: 'renny' },
        { name: 'Madan  D' },
      ]),
    ).toEqual(['Ravindra Reddy', 'Renny', 'Madan D', 'Ravi', 'Ravindra', 'Madan']);
  });

  it('stops at the cap with everybody in it once', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ name: `Person${i} Surname${i}` }));
    const hints = voiceNameHints(many);
    expect(hints).toHaveLength(MAX_VOICE_HINTS);
    expect(hints.slice(0, 80).every((hint) => hint.includes('Surname'))).toBe(true);
  });
});

describe('the recogniser’s other hypotheses', () => {
  it('reach the intent through the expense parser', () => {
    const result = parseVoiceExpenses('8000 for a room', [], {
      members: MEMBERS,
      alternatives: ['eight thousand for renny'],
    });
    const person = result.intent?.participants?.[0];
    expect(person).toMatchObject({ status: 'suggested', alternativeOnly: true });
    expect(person?.candidates?.[0]?.id).toBe('m-renny');
  });

  it('change nothing when there are none', () => {
    const plain = parseVoiceExpenses('renny paid 500', [], { members: MEMBERS });
    const withNone = parseVoiceExpenses('renny paid 500', [], {
      members: MEMBERS,
      alternatives: [],
    });
    expect(withNone.intent?.payer).toEqual(plain.intent?.payer);
  });
});
