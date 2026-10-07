import { describe, expect, it } from 'vitest';

import {
  explainLocalParse,
  localParseIsConfident,
  parseLocally,
  type FastPathContext,
} from '../src/lib/voiceFastPath';

const members = [
  { id: 'm-me', name: 'Madan', isMe: true },
  { id: 'm-ravi', name: 'Ravi' },
  { id: 'm-anu', name: 'Anu' },
];

const base: FastPathContext = {
  groups: [
    { id: 'g-goa', name: 'Goa Trip' },
    { id: 'g-flat', name: 'Flatmates' },
    { id: 'g-lunch', name: 'Office Lunch' },
  ],
  membersByGroup: { 'g-goa': members, 'g-flat': members, 'g-lunch': members },
  contacts: [
    { id: 'c-ravi', name: 'Ravi', balances: [50_000n] },
    { id: 'c-priya', name: 'Priya', balances: [-20_000n] },
    { id: 'c-sam', name: 'Sam', balances: [0n] },
    { id: 'c-jo', name: 'Jo', balances: [10_000n, -5_000n] },
  ],
};

const verdict = (transcript: string, context: FastPathContext = base) =>
  explainLocalParse(parseLocally(transcript, context), context);

const confident = (transcript: string, context: FastPathContext = base): boolean =>
  localParseIsConfident(parseLocally(transcript, context), context);

describe('localParseIsConfident: confident', () => {
  it('a single expense with a named group and named people', () => {
    expect(verdict('I paid 1200 for dinner in Goa Trip split with Ravi and Anu')).toEqual({
      confident: true,
      reason: 'expense',
    });
  });

  it('a single expense where someone else paid', () => {
    expect(confident('Anu paid 800 for the cab in Flatmates')).toBe(true);
  });

  it('a single expense into the group the mic was opened in', () => {
    const ctx = { ...base, currentGroupId: 'g-flat' };
    expect(confident('I paid 450 for groceries', ctx)).toBe(true);
  });

  it('a fuzzy name with a clear winner', () => {
    expect(confident('I paid 600 for dinner in Office Lunch split with Rahvi and Anu')).toBe(true);
  });

  it('a settle with one contact and one balance', () => {
    expect(verdict('settle up with Ravi')).toEqual({ confident: true, reason: 'settle' });
    expect(confident('settle 200 with Ravi')).toBe(true);
    expect(confident('settle up with Priya')).toBe(true);
  });

  it('a remind when they owe me', () => {
    expect(verdict('remind Ravi')).toEqual({ confident: true, reason: 'remind' });
  });

  it('a balance query about a person or a named group', () => {
    expect(confident('how much does Ravi owe me')).toBe(true);
    expect(confident('what is my balance in Office Lunch')).toBe(true);
  });
});

describe('localParseIsConfident: not confident', () => {
  it('two expenses in one breath', () => {
    expect(confident('dinner 500 and taxi 200 in Goa Trip')).toBe(false);
  });

  it('a name that is nobody in the group', () => {
    expect(verdict('I paid 1200 for dinner in Goa Trip split with Ravi and Zed').confident).toBe(
      false,
    );
  });

  it('a payer who is nobody in the group', () => {
    expect(confident('Zed paid 800 for the cab in Flatmates')).toBe(false);
  });

  it('an ambiguous name', () => {
    const ctx: FastPathContext = {
      ...base,
      membersByGroup: {
        ...base.membersByGroup,
        'g-lunch': [
          ...members,
          { id: 'm-ravi2', name: 'Ravi Shah' },
          { id: 'm-ravi3', name: 'Ravi K' },
        ],
      },
    };
    expect(confident('I paid 300 for lunch in Office Lunch split with Ravi', ctx)).toBe(false);
  });

  it('an ambiguous group', () => {
    const ctx: FastPathContext = {
      ...base,
      groups: [...base.groups, { id: 'g-goa2', name: 'Goa Flat' }],
    };
    expect(confident('I paid 1200 for dinner in Goa split with Ravi and Anu', ctx)).toBe(false);
  });

  it('a group the reader does not have', () => {
    expect(confident('I paid 1200 for dinner in Manali Crew')).toBe(false);
  });

  it('no group at all and none open', () => {
    expect(confident('I paid 500 for dinner')).toBe(false);
  });

  it('a group picked only because a note word overlaps its name', () => {
    expect(confident('I spent 500 on lunch')).toBe(false);
  });

  it('a question with the names missing', () => {
    expect(confident('how much does Dev owe me')).toBe(false);
    expect(confident('how much do I owe')).toBe(false);
  });

  it('a balance question about someone with no single contact', () => {
    expect(confident('how much does Ravi owe me', { ...base, contacts: [] })).toBe(false);
  });

  it('a settle with nothing to settle, or several currencies', () => {
    expect(confident('settle up with Sam')).toBe(false);
    expect(confident('settle up with Jo')).toBe(false);
    expect(confident('settle up with Dev')).toBe(false);
  });

  it('a remind when I owe them', () => {
    expect(confident('remind Priya')).toBe(false);
  });

  it('two money commands or a command plus an expense', () => {
    expect(confident('settle up with Ravi and remind Priya')).toBe(false);
    expect(confident('I paid 500 for dinner in Goa Trip and settle up with Ravi')).toBe(false);
  });

  it('a repayment the parser refuses', () => {
    expect(confident('Ravi paid me back 500')).toBe(false);
    expect(confident('Ravi gave me 500')).toBe(false);
  });

  it('money owed to me phrased as an expense', () => {
    const ctx = { ...base, currentGroupId: 'g-flat' };
    expect(confident('Ravi owes me 500 for dinner', ctx)).toBe(false);
  });

  it('Hinglish the parser half reads', () => {
    const ctx = { ...base, currentGroupId: 'g-lunch' };
    expect(confident('mujhe Ravi ko 500 dene hai lunch ka', ctx)).toBe(false);
    expect(confident('kal 300 ka petrol Office Lunch me', ctx)).toBe(false);
  });

  it('a script the parser does not read', () => {
    const ctx = { ...base, currentGroupId: 'g-lunch' };
    expect(confident('५०० रुपये डिनर', ctx)).toBe(false);
  });

  it('words that suggest something was dropped', () => {
    for (const text of [
      'refund 500 for dinner in Goa Trip',
      'cancel the 500 dinner in Goa Trip',
      'delete the 500 dinner in Goa Trip',
      'edit the 500 dinner in Goa Trip',
      'I paid 500 for dinner in Goa Trip and also 200 for a cab',
    ])
      expect(confident(text), text).toBe(false);
  });

  it('adding a member or making a group', () => {
    expect(confident('add Ravi to Goa Trip')).toBe(false);
    expect(confident('create a group called Hampi Gang')).toBe(false);
  });

  it('a split that is not equal, or a head count that disagrees', () => {
    expect(confident('I paid 1000 for dinner in Goa Trip, Ravi 400 and Anu 600')).toBe(false);
    expect(confident('I paid 1200 for dinner in Goa Trip split 5 ways with Ravi and Anu')).toBe(
      false,
    );
  });

  it('a payer who is not in the split', () => {
    expect(confident('Anu paid 800 for the cab in Flatmates split between Ravi and Madan')).toBe(
      false,
    );
  });

  it('members of the destination group not loaded', () => {
    const ctx = { ...base, membersByGroup: {} };
    expect(confident('I paid 1200 for dinner in Goa Trip split with Ravi and Anu', ctx)).toBe(
      false,
    );
  });

  it('no amount, empty, or far too long', () => {
    expect(confident('dinner in Goa Trip')).toBe(false);
    expect(confident('   ')).toBe(false);
    expect(confident(`I paid 500 for ${'a very long dinner '.repeat(10)} in Goa Trip`)).toBe(false);
  });
});
