/**
 * The four tiers a spoken name lands in — filled in, "Did you mean …?", "A or
 * B?", nobody — and the evidence beyond one transcript that moves it between
 * them: the recogniser's other hypotheses, corrections this user confirmed in
 * this group, confirmed aliases, and where in the sentence the words stood.
 */

import { describe, expect, it } from 'vitest';

import { parseVoiceIntent, resolveIntentPeople } from '../src/voice/intent';
import {
  aliasCollisions,
  arabicVariant,
  confusablePairs,
  resolveSpokenName,
  type VoiceNameCandidate,
} from '../src/voice/names';

const GROUP: VoiceNameCandidate[] = [
  { id: 'ravi', name: 'Ravi' },
  { id: 'rajiv', name: 'Rajiv' },
  { id: 'renny', name: 'Renny' },
  { id: 'anu', name: 'Anu' },
  { id: 'murugan', name: 'Murugan' },
  { id: 'me', name: 'Madan', isMe: true },
];

describe('tiers', () => {
  it('fills in a name said clearly in a person slot', () => {
    expect(resolveSpokenName('renny', GROUP, { span: 'strong' })).toMatchObject({
      status: 'resolved',
      id: 'renny',
    });
  });

  it('suggests a weak likeness in a person slot, and only there', () => {
    expect(resolveSpokenName('yurugen', GROUP, { span: 'strong' })).toMatchObject({
      status: 'suggested',
      id: 'murugan',
    });
    // Without a slot (the parser asking "is this a person at all?") it is nobody.
    expect(resolveSpokenName('yurugen', GROUP).status).toBe('unresolved');
  });

  it('suggests a near match in a slot a description fits too', () => {
    expect(resolveSpokenName('rainy', GROUP, { span: 'weak' })).toMatchObject({
      status: 'suggested',
      id: 'renny',
    });
  });

  it('asks between two people who fit about as well', () => {
    const twins = [...GROUP, { id: 'hari', name: 'Hari' }, { id: 'harry', name: 'Harry' }];
    const result = resolveSpokenName('harry', twins);
    expect(result.status).toBe('ambiguous');
  });

  it('never fills in a near match while a look-alike of it is close behind', () => {
    const group = [
      { id: 'swetha', name: 'Swetha' },
      { id: 'shwetha', name: 'Shwetha' },
      { id: 'me', name: 'Madan', isMe: true },
    ];
    expect(confusablePairs(group).get('swetha')?.has('shwetha')).toBe(true);
    expect(resolveSpokenName('swetta', group).status).not.toBe('resolved');
  });

  it('works out confusable pairs once per member list', () => {
    const pairs = confusablePairs(GROUP);
    expect(pairs.get('ravi')?.has('rajiv')).toBe(true);
    expect(pairs.get('ravi')?.has('murugan') ?? false).toBe(false);
    expect(confusablePairs(GROUP)).toBe(pairs);
  });
});

describe('several hypotheses', () => {
  it('takes the best evidence any hypothesis has', () => {
    expect(
      resolveSpokenName('a room', GROUP, { alternatives: ['anu'], span: 'strong' }),
    ).toMatchObject({ id: 'anu' });
  });

  it('never fills in a person only another hypothesis heard', () => {
    expect(
      resolveSpokenName('a room', GROUP, { alternatives: ['anu'], span: 'strong' }).status,
    ).toBe('suggested');
  });

  it('asks when two hypotheses clearly name two different people', () => {
    const result = resolveSpokenName('ravi', GROUP, { alternatives: ['rajiv'] });
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous')
      expect(result.candidates.map((c) => c.id).sort()).toEqual(['rajiv', 'ravi']);
  });

  it('counts near-copies of one hearing as one vote', () => {
    // Five spellings of the same sound do not outvote anything; they are one hearing.
    const result = resolveSpokenName('renny', GROUP, {
      alternatives: ['reni', 'rennie', 'renni', 'renny'],
    });
    expect(result).toMatchObject({ status: 'resolved', id: 'renny' });
  });

  it('reads the n-best list through the sentence parser', () => {
    const intent = parseVoiceIntent('8000 for a room', {
      members: GROUP,
      alternatives: ['8000 for anu'],
    });
    expect(intent.participants?.[0]).toMatchObject({ status: 'suggested', alternativeOnly: true });
    expect(intent.participants?.[0]?.candidates?.[0]?.id).toBe('anu');
  });
});

describe('learned corrections', () => {
  const group = [
    { id: 'pradeep', name: 'Pradeep' },
    { id: 'rakesh', name: 'Rakesh' },
    { id: 'rajeesh', name: 'Rajeesh' },
    { id: 'me', name: 'Madan', isMe: true },
  ];

  it('suggests after one confirmation and fills in after two', () => {
    expect(resolveSpokenName('pravi', group, { span: 'strong' }).status).toBe('suggested');
    const once = [{ heard: 'pravi', memberId: 'pradeep', count: 1 }];
    expect(resolveSpokenName('pravi', group, { learned: once })).toMatchObject({
      status: 'suggested',
      id: 'pradeep',
    });
    const twice = [{ heard: 'pravi', memberId: 'pradeep', count: 2 }];
    expect(resolveSpokenName('pravi', group, { learned: twice })).toMatchObject({
      status: 'resolved',
      id: 'pradeep',
    });
  });

  it('never overrides somebody else whose name was clearly said', () => {
    const learned = [{ heard: 'rakesh', memberId: 'rajeesh', count: 9 }];
    const result = resolveSpokenName('rakesh', group, { learned });
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous')
      expect(result.candidates.map((c) => c.id).sort()).toEqual(['rajeesh', 'rakesh']);
  });

  it('applies to the group it was learned in only', () => {
    // The caller passes this group's corrections; another group's member ids never match.
    const learned = [{ heard: 'pravi', memberId: 'someone-elsewhere', count: 5 }];
    expect(resolveSpokenName('pravi', group, { learned, span: 'strong' }).status).toBe('suggested');
  });

  it('reaches the parser and the re-read for another group', () => {
    const learned = [{ heard: 'pravi', memberId: 'pradeep', count: 2 }];
    const intent = parseVoiceIntent('pravi paid 500', { members: group, learned });
    expect(intent.payer).toMatchObject({ status: 'resolved', memberId: 'pradeep' });
    const again = resolveIntentPeople(parseVoiceIntent('pravi paid 500', {}), group, { learned });
    expect(again.payer).toMatchObject({ status: 'resolved', memberId: 'pradeep' });
  });

  it('takes a pick made on the screen as settled', () => {
    const intent = parseVoiceIntent('pravi paid 500', { members: group });
    const picked = resolveIntentPeople(intent, group, { picks: { pravi: 'pradeep' } });
    expect(picked.payer).toMatchObject({ status: 'resolved', memberId: 'pradeep', heard: 'pravi' });
  });
});

describe('aliases', () => {
  const group: VoiceNameCandidate[] = [
    { id: 'ravindra', name: 'Ravindra Reddy', aliases: ['Ravi'] },
    { id: 'anu', name: 'Anu' },
    { id: 'me', name: 'Madan', isMe: true },
  ];

  it('finds a person by a confirmed alias', () => {
    expect(resolveSpokenName('ravi', group)).toMatchObject({ status: 'resolved', id: 'ravindra' });
  });

  it('asks when somebody else is actually called that', () => {
    const withRavi = [...group, { id: 'ravi', name: 'Ravi Kumar' }];
    expect(aliasCollisions('Ravi', 'ravindra', withRavi).map((c) => c.id)).toEqual(['ravi']);
    expect(resolveSpokenName('ravi', withRavi).status).toBe('ambiguous');
  });

  it('has no collision when nobody else sounds like it', () => {
    expect(aliasCollisions('Ravi', 'ravindra', group)).toEqual([]);
  });
});

describe('Arabic name variants', () => {
  it.each([
    ['muhammad', 'Mohammed'],
    ['mohamed', 'Mohammad'],
    ['mohd', 'Muhammad'],
    ['yousef', 'Yusuf'],
    ['youssef', 'Yusuf'],
    ['hasan', 'Hassan'],
    ['hussein', 'Hussain'],
    ['khaled', 'Khalid'],
    ['kasim', 'Qasim'],
    ['abdelrahman', 'Abdul Rahman'],
    ['abd al rahman', 'Abdulrahman'],
    ['el mansoori', 'Al Mansoori'],
  ])('%s is %s', (heard, name) => {
    const group = [
      { id: 'x', name },
      { id: 'o', name: 'Omar' },
    ];
    expect(resolveSpokenName(heard, group)).toMatchObject({ status: 'resolved', id: 'x' });
  });

  it('keeps two names apart that only differ in vowels', () => {
    expect(arabicVariant('hassan')).not.toBe(arabicVariant('hussein'));
    const group = [
      { id: 'hassan', name: 'Hassan' },
      { id: 'hussein', name: 'Hussein' },
    ];
    expect(resolveSpokenName('hasan', group)).toMatchObject({ id: 'hassan' });
    expect(resolveSpokenName('husain', group)).toMatchObject({ id: 'hussein' });
  });

  it('never reads an English word as one', () => {
    expect(resolveSpokenName('said', [{ id: 's', name: 'Saeed' }]).status).toBe('unresolved');
  });
});

describe('a person, or a phrase that sounds like one', () => {
  const members: VoiceNameCandidate[] = [...GROUP, { id: 'deepa', name: 'Deepa' }];
  const parse = (said: string) => parseVoiceIntent(said, { members });
  const people = (said: string) => {
    const intent = parse(said);
    return [intent.payer, ...(intent.participants ?? [])]
      .filter((party) => party.kind === 'member')
      .map(
        (party) => `${party.status}:${party.memberId ?? party.candidates?.[0]?.id ?? party.name}`,
      );
  };

  it('finds a name at the start of the sentence', () => {
    expect(parse('Renny paid 500').payer).toMatchObject({ status: 'resolved', memberId: 'renny' });
  });

  it('does not turn an everyday phrase into a person', () => {
    expect(people('bought a new phone 500')).toEqual([]);
    expect(people('paid 500 for a new phone')).toEqual([]);
    expect(people('paid 500 for rainy day taxi')).toEqual([]);
    expect(people('paid 300 for deep fried snacks')).toEqual([]);
  });

  it('keeps the one person who was named', () => {
    expect(people('rainy day taxi, paid by ravi')).toEqual(['resolved:ravi']);
    expect(people('rainy day taxi 400 paid by ravi')).toEqual(['resolved:ravi']);
  });

  it('still reads a person at the end of a "for"', () => {
    expect(people('8000 for murugan')).toEqual(['resolved:murugan']);
    expect(people('500 for renny and me')).toEqual(['resolved:renny']);
    expect(people('500 for ravi for dinner')).toEqual(['resolved:ravi']);
  });

  it('reads "for" misheard before a name', () => {
    expect(people('8000 phil murugan')).toEqual(['resolved:murugan']);
    expect(people('8000 fianu')).toEqual(['resolved:anu']);
  });

  it('keeps what was heard on every party', () => {
    expect(parse('rainy paid 500').payer).toMatchObject({ heard: 'rainy', span: 'strong' });
  });
});
