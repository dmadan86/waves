import { describe, expect, it } from 'vitest';

import { parseVoiceIntent } from '../src/voice/intent';
import { namesSoundAlike, resolveSpokenName, romanise } from '../src/voice/names';

describe('names a phone recogniser mishears as words', () => {
  it('hears "rainy" as Renny', () => {
    expect(namesSoundAlike('rainy', 'renny')).toBe(true);
    expect(namesSoundAlike('raini', 'renny')).toBe(true);
  });

  it('still keeps unrelated words apart', () => {
    expect(namesSoundAlike('rainy', 'ravi')).toBe(false);
    expect(namesSoundAlike('any', 'renny')).toBe(false);
  });

  it('resolves "rainy" to Renny among the group', () => {
    const result = resolveSpokenName('rainy', [
      { id: 'r', name: 'Renny Benita' },
      { id: 'v', name: 'Ravi' },
      { id: 'a', name: 'Anu' },
    ]);
    expect(result).toMatchObject({ status: 'resolved', id: 'r', fuzzy: true });
  });
});

describe('names the way recognisers really write them', () => {
  const group = [
    { id: 'sunil', name: 'Sunil Kumar' },
    { id: 'shreya', name: 'Shreya' },
    { id: 'harry', name: 'Harry' },
    { id: 'hari', name: 'Hari' },
    { id: 'matthew', name: 'Matthew' },
    { id: 'jack', name: 'Jack' },
    { id: 'john', name: 'John' },
    { id: 'murugan', name: 'Murugan' },
    { id: 'renny', name: 'Renny' },
    { id: 'dileep', name: 'Dileep' },
    { id: 'me', name: 'Madan', isMe: true },
  ];
  const resolve = (heard: string) => resolveSpokenName(heard, group);

  it('reads a name written in Hindi script', () => {
    expect(romanise('श्रेया')).toBe('shreya');
    expect(resolve('श्रेया')).toMatchObject({ status: 'resolved', id: 'shreya' });
  });

  it('joins a name split into words', () => {
    expect(resolve('sun eel')).toMatchObject({ status: 'resolved', id: 'sunil' });
    expect(resolve('so neil')).toMatchObject({ status: 'resolved', id: 'sunil' });
  });

  it('never joins across "and"', () => {
    expect(resolve('matt and you').status).not.toBe('resolved');
  });

  it('asks when two people sound the same', () => {
    const result = resolve('harry');
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous')
      expect(result.candidates.map((c) => c.id).sort()).toEqual(['hari', 'harry']);
  });

  it('takes a nickname, but never over somebody with that very name', () => {
    expect(resolve('matt')).toMatchObject({ status: 'resolved', id: 'matthew', fuzzy: true });
    expect(resolve('jack')).toMatchObject({ status: 'resolved', id: 'jack', fuzzy: false });
  });

  it('drops honorifics said with the name', () => {
    expect(resolve('murugan anna')).toMatchObject({ status: 'resolved', id: 'murugan' });
    expect(resolve('muruganna')).toMatchObject({ status: 'resolved', id: 'murugan' });
  });

  it('hears an everyday word as a name only when it sounds the same', () => {
    expect(resolve('rainy')).toMatchObject({ status: 'resolved', id: 'renny' });
    expect(resolve('delete')).toEqual({ status: 'unresolved' });
    expect(resolve('mother')).toEqual({ status: 'unresolved' });
  });

  it('asks rather than picks between two near spellings', () => {
    const result = resolveSpokenName('rajesh', [
      { id: 'a', name: 'Rajesh' },
      { id: 'b', name: 'Rajeesh' },
    ]);
    expect(result.status).toBe('ambiguous');
  });
});

describe('sentences a recogniser mangled around a name', () => {
  const members = [
    { id: 'rahul', name: 'Rahul' },
    { id: 'deepak', name: 'Deepak' },
    { id: 'jobin', name: 'Jobin' },
    { id: 'me', name: 'Madan', isMe: true },
  ];
  const parse = (said: string) => parseVoiceIntent(said, { members });

  it('reads "8004 rahul" as 8000 for Rahul', () => {
    const intent = parse('8004 rahul');
    expect(intent.amountMinor).toBe(800000n);
    expect(intent.participants?.map((p) => p.memberId)).toEqual(['rahul']);
  });

  it('reads "80004 rahul" as 8000 for Rahul', () => {
    expect(parse('80004 rahul').amountMinor).toBe(800000n);
  });

  it('keeps 8004 when no name follows', () => {
    expect(parse('8004 dinner').amountMinor).toBe(800400n);
  });

  it('joins a split name back together', () => {
    expect(parse('8000 for d pack').participants?.map((p) => p.memberId)).toEqual(['deepak']);
    expect(parse('job in paid 500').payer).toMatchObject({ memberId: 'jobin' });
  });

  it('reads "full" and "p" heard around a name as "for" and "paid"', () => {
    expect(parse('8000 full rahul').participants?.map((p) => p.memberId)).toEqual(['rahul']);
    expect(parse('rahul p 500').payer).toMatchObject({ memberId: 'rahul', explicit: true });
  });
});
