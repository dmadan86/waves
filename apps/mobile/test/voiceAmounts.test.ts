import { describe, expect, it } from 'vitest';

import {
  matchMemberNames,
  parseVoiceExpenseDate,
  parseVoiceExpenses,
  type VoiceGroupRef,
} from '@/lib/voiceExpense';

const groups: VoiceGroupRef[] = [{ id: 'g-goa', name: 'Goa Trip' }];

function first(transcript: string) {
  const result = parseVoiceExpenses(transcript, groups);
  return { result, item: result.items[0] };
}

describe('spoken amounts through the whole parser', () => {
  // [transcript, amountMajor, currency]
  const amounts: [string, number, string | null][] = [
    ['three fifty', 350, null],
    ['three 50', 350, null],
    ['3 50', 350, null],
    ['lunch 3 50', 350, null],
    ['three fifty rupees for tea', 350, 'INR'],
    ['3 50 rupees', 350, 'INR'],
    ['twelve fifty', 1250, null],
    ['twelve fifty rupees', 1250, 'INR'],
    ['twelve fifty dollars', 12.5, 'USD'],
    ['paid two fifty for auto', 250, null],
    ['three hundred fifty', 350, null],
    ['three hundred and fifty', 350, null],
    ['fifteen hundred', 1500, null],
    ['twenty five hundred rupees', 2500, 'INR'],
    ['two thousand five hundred', 2500, null],
    ['1.5k', 1500, null],
    ['1.5k for dinner', 1500, null],
    ['dinner for 2k', 2000, null],
    ['two k for rent', 2000, null],
    ['2.5 lakh', 250000, null],
    ['350 rupees for lunch with Arun', 350, 'INR'],
    ['lunch 350 split with Arun and Priya', 350, null],
    ['₹350', 350, 'INR'],
    ['rs 350', 350, 'INR'],
    ['rs. 350 auto', 350, 'INR'],
    ['12.50 dollars', 12.5, 'USD'],
    ['350 bucks', 350, 'USD'],
    ['five hundred dirhams', 500, 'AED'],
    ['20 quid', 20, 'GBP'],
    ['twenty five rupees', 25, 'INR'],
    ['lunch three fifty with arun', 350, null],
  ];
  it.each(amounts)('%s -> %s %s', (transcript, amount, currency) => {
    const { result, item } = first(transcript);
    expect(result.items).toHaveLength(1);
    expect(item.amountMajor).toBe(amount);
    expect(item.currency).toBe(currency);
  });

  it('keeps the people count apart from the amount', () => {
    const { result, item } = first('split 3 50 among 3 people');
    expect(item.amountMajor).toBe(350);
    expect(result.splitCount).toBe(3);
  });

  it('does not turn a split count or a date into an amount', () => {
    expect(first('1000 rupees dinner split among 4').item.amountMajor).toBe(1000);
    const { result } = first('paid 500 on the 5th');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].amountMajor).toBe(500);
  });

  it('still reads two spoken amounts as two expenses', () => {
    const result = parseVoiceExpenses('5 rupees snacks 10 rupees tea', groups);
    expect(result.items.map((item) => item.amountMajor)).toEqual([5, 10]);
  });

  it('keeps the description free of the amount words', () => {
    expect(first('lunch three fifty with arun').item.note).toBe('lunch arun');
  });
});

describe('spoken dates', () => {
  // Monday 5 October 2026, local time.
  const now = new Date(2026, 9, 5, 12, 0, 0);
  const cases: [string, string | null][] = [
    ['yesterday 200 for chai', '2026-10-04'],
    ['day before yesterday', '2026-10-03'],
    ['last friday 400 petrol', '2026-10-02'],
    ['on saturday', '2026-10-03'],
    ['last monday', '2026-09-28'],
    ['3 days ago', '2026-10-02'],
    ['two days ago', '2026-10-03'],
    ['on the 3rd', '2026-10-03'],
    ['on 25th', '2026-09-25'],
    ['400 petrol', null],
    ['split among 3 people', null],
  ];
  it.each(cases)('%s -> %s', (text, expected) => {
    expect(parseVoiceExpenseDate(text, now)).toBe(expected);
  });

  it('removes the date words from the note', () => {
    const result = parseVoiceExpenses('last friday 400 petrol', groups);
    expect(result.items[0].note).toBe('petrol');
    expect(result.expenseDate).not.toBeNull();
  });
});

describe('member names heard slightly wrong', () => {
  const members = [
    { id: 'm-priya', name: 'Priya' },
    { id: 'm-arun', name: 'Arun Kumar' },
    { id: 'm-sumit', name: 'Sumit' },
    { id: 'm-mark', name: 'Mark' },
  ];
  const cases: [string, string[]][] = [
    ['split with Priya', ['m-priya']],
    ['split with Pria', ['m-priya']],
    ['dinner with Arrun', ['m-arun']],
    ['with Sumeet and Priya', ['m-priya', 'm-sumit']],
    ['dinner with Kumar', ['m-arun']],
    // Short or common words never pass for a name.
    ['make dinner', []],
    ['lunch with them', []],
  ];
  it.each(cases)('%s', (text, ids) => {
    expect(matchMemberNames(text, members).sort()).toEqual(ids);
  });

  it('declines a near-miss that fits two people', () => {
    const twins = [
      { id: 'a', name: 'Rohan' },
      { id: 'b', name: 'Rohit' },
    ];
    expect(matchMemberNames('with Rohin', twins)).toEqual([]);
    expect(matchMemberNames('with Rohan', twins)).toEqual(['a']);
  });
});
