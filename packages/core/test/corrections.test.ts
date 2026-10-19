import { describe, expect, it } from 'vitest';

import {
  correctionFieldNames,
  parseCorrection,
  type Correction,
  type CorrectionContext,
  type CorrectionFields,
  type CorrectionTarget,
} from '../src/voice/corrections';

const TODAY = '2026-10-19'; // a Monday
const personal: CorrectionTarget = { kind: 'personal', groupId: null, currency: 'INR' };
const inGoa: CorrectionTarget = { kind: 'group', groupId: 'g-goa', currency: 'INR' };
const ctx: CorrectionContext = {
  today: TODAY,
  locale: 'en',
  groups: [
    { id: 'g-home', name: 'Flat 4B' },
    { id: 'g-goa', name: 'Goa trip' },
    { id: 'g-london', name: 'London' },
  ],
  members: [
    { id: 'm-me', name: 'Madan', isMe: true },
    { id: 'm-ravi', name: 'Ravi' },
    { id: 'm-anu', name: 'Anu' },
  ],
};

function fieldsOf(text: string, target: CorrectionTarget = personal): CorrectionFields {
  const out: Correction | null = parseCorrection(text, target, ctx);
  expect(out, text).not.toBeNull();
  expect(out?.kind, text).toBe('update');
  return out?.kind === 'update' ? out.fields : {};
}

describe('parseCorrection: amount', () => {
  it('CR-01 "no, make it 800" is 80000 minor in INR', () => {
    expect(fieldsOf('no, make it 800')).toEqual({ amountMinor: 80000n });
  });
  it('CR-02 "800 not 8000" keeps the first number', () => {
    expect(fieldsOf('800 not 8000')).toEqual({ amountMinor: 80000n });
  });
  it('CR-03 "it\'s 8k" is 800000', () => {
    expect(fieldsOf("it's 8k")).toEqual({ amountMinor: 800000n });
  });
  it('CR-04 "actually ₹1,250.50" is 125050', () => {
    expect(fieldsOf('actually ₹1,250.50')).toEqual({ amountMinor: 125050n });
  });
  it('CR-05 "make it eight hundred" uses the spoken-number reader', () => {
    expect(fieldsOf('make it eight hundred')).toEqual({ amountMinor: 80000n });
  });
  it('CR-06 "800 nahi, 8000" takes the number after nahi', () => {
    expect(fieldsOf('800 nahi, 8000')).toEqual({ amountMinor: 800000n });
  });
  it('CR-07 "nahi 800" is 80000', () => {
    expect(fieldsOf('nahi 800')).toEqual({ amountMinor: 80000n });
  });
  it('CR-03b lakh and decimals scale exactly', () => {
    expect(fieldsOf('make it 1.5 lakh')).toEqual({ amountMinor: 15000000n });
    expect(fieldsOf('make it 2.5k')).toEqual({ amountMinor: 250000n });
  });
  it('CR-01b a zero-decimal currency is not scaled by 100', () => {
    const jpy: CorrectionTarget = { kind: 'personal', groupId: null, currency: 'JPY' };
    expect(fieldsOf('make it 800', jpy)).toEqual({ amountMinor: 800n });
  });
  it('CR-01c a bare number is an amount; a number inside a new command is not', () => {
    expect(fieldsOf('800')).toEqual({ amountMinor: 80000n });
    expect(parseCorrection('add 800 for lunch with Ravi', personal, ctx)).toBeNull();
    expect(parseCorrection('split it 3 ways', personal, ctx)).toBeNull();
  });
  it('CR-01d zero and two unrelated numbers are not read', () => {
    expect(parseCorrection('make it 0', personal, ctx)).toBeNull();
    expect(parseCorrection('make it 800 or 900', personal, ctx)).toBeNull();
  });
});

describe('parseCorrection: date', () => {
  it('CR-08 "it was yesterday" is today minus one', () => {
    expect(fieldsOf('it was yesterday')).toEqual({ date: '2026-10-18' });
  });
  it('CR-09 "kal tha" is yesterday', () => {
    expect(fieldsOf('kal tha')).toEqual({ date: '2026-10-18' });
  });
  it('CR-09b bare "kal hoga" (tomorrow) is not guessed', () => {
    expect(parseCorrection('kal hoga', personal, ctx)).toBeNull();
    expect(parseCorrection('kal', personal, ctx)).toBeNull();
  });
  it('CR-10 "last Friday" is 2026-10-16', () => {
    expect(fieldsOf('last Friday')).toEqual({ date: '2026-10-16' });
  });
  it('CR-10b the same weekday as today is a week ago, not today', () => {
    expect(fieldsOf('it was on monday')).toEqual({ date: '2026-10-12' });
  });
  it('CR-11 "on the 3rd" is 2026-10-03', () => {
    expect(fieldsOf('on the 3rd')).toEqual({ date: '2026-10-03' });
  });
  it('CR-11b a day still ahead in the month falls back to last month', () => {
    expect(fieldsOf('it was on the 25th')).toEqual({ date: '2026-09-25' });
  });
  it('CR-11c "3 oct" and "2 days ago" read, and an invalid day does not', () => {
    expect(fieldsOf('it was 3 oct')).toEqual({ date: '2026-10-03' });
    expect(fieldsOf('2 days ago')).toEqual({ date: '2026-10-17' });
    expect(fieldsOf('day before yesterday')).toEqual({ date: '2026-10-17' });
    expect(parseCorrection('on the 31st of february', personal, ctx)).toBeNull();
  });
  it('CR-12 "next month" is null: a future date is asked about', () => {
    expect(parseCorrection('next month', personal, ctx)).toBeNull();
    expect(parseCorrection('make it tomorrow', personal, ctx)).toBeNull();
  });
  it('CR-23 "make it 800 yesterday" applies both fields', () => {
    expect(fieldsOf('make it 800 yesterday')).toEqual({
      amountMinor: 80000n,
      date: '2026-10-18',
    });
  });
  it('CR-23b a date word does not leak its number into the amount', () => {
    expect(fieldsOf('2 days ago')).not.toHaveProperty('amountMinor');
    expect(fieldsOf('it was on the 3rd')).not.toHaveProperty('amountMinor');
  });
});

describe('parseCorrection: description', () => {
  it('CR-13 "it was dinner not lunch" sets Dinner', () => {
    expect(fieldsOf('it was dinner not lunch')).toEqual({ description: 'Dinner' });
  });
  it('CR-14 "call it Team dinner" keeps the casing said', () => {
    expect(fieldsOf('call it Team dinner')).toEqual({ description: 'Team dinner' });
  });
  it('CR-15 "rename to" and "rename it to" prefixes are stripped', () => {
    expect(fieldsOf('rename to Cab to airport')).toEqual({ description: 'Cab to airport' });
    expect(fieldsOf('rename it to Groceries')).toEqual({ description: 'Groceries' });
  });
  it('CR-15b a long description is cut to 120 characters', () => {
    const long = 'x'.repeat(300);
    expect(fieldsOf(`call it ${long}`.slice(0, 190)).description).toHaveLength(120);
  });
});

describe('parseCorrection: group, payer, currency', () => {
  it('CR-16 "that was in Flat 4B" moves to g-home', () => {
    expect(fieldsOf('that was in Flat 4B')).toEqual({ groupId: 'g-home' });
  });
  it('CR-17 "move to Goa" moves to g-goa', () => {
    expect(fieldsOf('move to Goa')).toEqual({ groupId: 'g-goa' });
  });
  it('CR-18 "put it in personal" moves a group expense to personal', () => {
    expect(fieldsOf('put it in personal', inGoa)).toEqual({ groupId: null });
  });
  it('CR-18b "personal" on an already personal expense and the same group change nothing', () => {
    expect(parseCorrection('put it in personal', personal, ctx)).toBeNull();
    expect(parseCorrection('move to Goa', inGoa, ctx)).toBeNull();
  });
  it('CR-17b an unknown group is not guessed', () => {
    expect(parseCorrection('move to Atlantis', personal, ctx)).toBeNull();
  });
  it('CR-21 "in AED" relabels the currency only', () => {
    expect(fieldsOf('in AED')).toEqual({ currency: 'AED' });
    expect(fieldsOf('it was in aed')).toEqual({ currency: 'AED' });
  });
  it('CR-21b an amount with its currency carries both; unknown codes are ignored', () => {
    expect(fieldsOf('make it 800 AED')).toEqual({ amountMinor: 80000n, currency: 'AED' });
    expect(parseCorrection('in zzz', personal, ctx)).toBeNull();
  });
  it('CR-22 "paid by Ravi" sets the payer on a group expense', () => {
    expect(fieldsOf('paid by Ravi', inGoa)).toEqual({ payerMemberId: 'm-ravi' });
    expect(fieldsOf('it was Ravi paid', inGoa)).toEqual({ payerMemberId: 'm-ravi' });
  });
  it('CR-22b a payer correction on a personal entry is not read', () => {
    expect(parseCorrection('paid by Ravi', personal, ctx)).toBeNull();
  });
});

describe('parseCorrection: undo and unrelated text', () => {
  it.each([
    'undo',
    'undo that',
    'Cancel',
    'delete it',
    'remove that',
    'hata do',
    'wapas',
    'no, undo that please',
    'delete that expense',
  ])('CR-19 "%s" is undo', (text) => {
    expect(parseCorrection(text, personal, ctx)).toEqual({ kind: 'undo' });
  });
  it('CR-20 "undo the place" takes back the last answer only', () => {
    expect(parseCorrection('undo the place', personal, ctx)).toEqual({ kind: 'undoAnswer' });
    expect(parseCorrection('undo the last answer', personal, ctx)).toEqual({ kind: 'undoAnswer' });
  });
  it('CR-24 unrelated text "blue tokai" is null', () => {
    expect(parseCorrection('blue tokai', personal, ctx)).toBeNull();
    expect(parseCorrection('upi', personal, ctx)).toBeNull();
    expect(parseCorrection('', personal, ctx)).toBeNull();
    expect(parseCorrection('x'.repeat(500), personal, ctx)).toBeNull();
  });
  it('CR-24b a long sentence that merely mentions a day is not a correction', () => {
    expect(
      parseCorrection('we went to the new cafe near the lake last friday with everyone', personal, ctx),
    ).toBeNull();
  });
  it('CR-24c correctionFieldNames lists only what changed', () => {
    expect(correctionFieldNames({ amountMinor: 1n, date: '2026-10-18' })).toEqual([
      'amountMinor',
      'date',
    ]);
  });
});
