import { describe, expect, it } from 'vitest';

import type { SavedState } from '../src/lib/followUpApply';
import {
  findHeardNames,
  heardSegments,
  savedPeople,
  swappedName,
  swapPerson,
} from '../src/lib/voiceHeardPure';

const members = [
  { id: 'me', name: 'Madan', isMe: true },
  { id: 'ren', name: 'Renny' },
  { id: 'rav', name: 'Ravindra' },
  { id: 'pri', name: 'Priya Shah' },
];

describe('findHeardNames', () => {
  it('finds the words that named each person, never the viewer', () => {
    const said = 'Madan paid 500 for dinner with Renny and Priya Shah';
    const names = findHeardNames(said, members, ['me', 'ren', 'pri']);
    expect(names.map((n) => [n.text, n.memberId])).toEqual([
      ['Renny', 'ren'],
      ['Priya Shah', 'pri'],
    ]);
    expect(said.slice(names[0]!.start, names[0]!.end)).toBe('Renny');
  });

  it('follows a learned correction for a mishearing', () => {
    const names = findHeardNames(
      'split 300 with rainy',
      members,
      ['ren'],
      [{ heard: 'rainy', memberId: 'ren', count: 2 }],
    );
    expect(names.map((n) => n.text)).toEqual(['rainy']);
  });

  it('has nothing for somebody the sentence does not name', () => {
    expect(findHeardNames('lunch 200 with Renny', members, ['rav'])).toEqual([]);
  });
});

describe('heardSegments', () => {
  it('cuts the sentence around the spans', () => {
    const said = 'dinner with Renny today';
    const names = findHeardNames(said, members, ['ren']);
    expect(heardSegments(said, names).map((s) => [s.text, !!s.name])).toEqual([
      ['dinner with ', false],
      ['Renny', true],
      [' today', false],
    ]);
  });
});

describe('swappedName', () => {
  const names = [{ text: 'raining', start: 0, end: 7, memberId: 'ren' }];
  it('reads one person swapped for another as the heard name corrected', () => {
    expect(swappedName(names, ['me', 'ren'], ['me', 'rav'])).toEqual({
      heard: 'raining',
      from: 'ren',
      to: 'rav',
    });
  });
  it('ignores an add, a drop or a wider change', () => {
    expect(swappedName(names, ['me', 'ren'], ['me', 'ren', 'rav'])).toBeNull();
    expect(swappedName(names, ['me', 'ren'], ['me'])).toBeNull();
    expect(swappedName(names, ['me', 'ren', 'pri'], ['me', 'rav', 'x'])).toBeNull();
    expect(swappedName(names, ['me', 'pri'], ['me', 'rav'])).toBeNull();
  });
});

describe('swapPerson', () => {
  const state = {
    payers: { ren: 500n },
    participants: ['me', 'ren'],
  } as unknown as SavedState;
  it('moves the payer and the share to the new person', () => {
    const next = swapPerson(state, 'ren', 'rav');
    expect(next.payers).toEqual({ rav: 500n });
    expect(next.participants).toEqual(['me', 'rav']);
    expect(savedPeople(next).sort()).toEqual(['me', 'rav']);
  });
  it('does not list somebody twice', () => {
    expect(swapPerson(state, 'ren', 'me').participants).toEqual(['me']);
  });
});
