import { describe, expect, it } from 'vitest';

import {
  amountIsUnambiguous,
  parseVoiceExpense,
  parseVoiceExpenses,
  voiceAutoAction,
  type VoiceGroupRef,
} from '@/lib/voiceExpense';
import { voiceAmountQuestion, voiceCurrencyQuestion } from '@/lib/voiceAmountChoice';

const strings = {
  amountWhich: 'Was that {a} or {b}?',
  amountTotalOrEach: '{amount} total or {amount} each?',
  amountTotal: '{amount} total',
  amountEach: '{amount} each',
  whichDollars: 'US or Australian dollars?',
  dollarNames: { USD: 'US dollars', AUD: 'Australian dollars' },
};
const rupees = (major: string): string => `₹${major}`;

describe('the amounts people said that used to go wrong', () => {
  it.each([
    ['One point five lakh', 15000000n],
    ['Twenty point zero five', 2005n],
    ['Fifteen sorry fifty', 5000n],
    ['paanch sau', 50000n],
    ['ek hazaar', 100000n],
    ['do hazaar paanch sau', 250000n],
    ['dedh sau', 15000n],
    ['dhai hazaar', 250000n],
    ['saade teen sau', 35000n],
    ['nooru', 10000n],
    ['aayiram', 100000n],
    ['rendu aayiram', 200000n],
    ['aimbadhu', 5000n],
    ['khamsa mia', 50000n],
    ['alf', 100000n],
    ['alfain', 200000n],
  ])('%s → %s', (said, minor) => {
    expect(parseVoiceExpense(said, []).amountMinor).toBe(minor);
  });

  it('reads "each" as a share and totals it over the people counted', () => {
    const parsed = parseVoiceExpense('Five hundred each for three people', []);
    expect(parsed.amountMinor).toBe(150000n);
    expect(parsed.amount?.eachMinor).toBe(50000n);
    expect(parsed.splitCount).toBe(3);
  });

  it('flags "one fifty" as 150 or 1.50', () => {
    expect(parseVoiceExpense('One fifty', []).amount?.ambiguity).toBe('decimal-or-hundreds');
    expect(parseVoiceExpense('One fifty rupees', []).amount?.ambiguity).toBe('none');
  });

  it('still refuses a third-party payer on the single reader, but reads the amount', () => {
    const parsed = parseVoiceExpense(
      'Renny paid twelve hundred split between me Priya and Sunil',
      [],
    );
    expect(parsed.amountMinor).toBeNull();
    expect(parsed.refused).toBe('third-party-payer');
    expect(parsed.amount?.totalMinor).toBe(120000n);
    // The review path carries the payer, so it books the amount for confirmation.
    const reviewed = parseVoiceExpenses(
      'Renny paid twelve hundred split between me Priya and Sunil',
      [],
    );
    expect(reviewed.items.map((item) => item.amountMinor)).toEqual([120000n]);
    expect(reviewed.intent?.payer.name).toBe('renny');
  });

  it('never reads a date, a time, a party or a label as money', () => {
    for (const said of ['5th of October dinner', 'at 7 tonight', 'table for two', 'flight 302'])
      expect(parseVoiceExpenses(said, []).items).toEqual([]);
  });
});

describe('currency', () => {
  const groups: VoiceGroupRef[] = [
    { id: 'syd', name: 'Sydney', currency: 'AUD' },
    { id: 'goa', name: 'Goa', currency: 'INR' },
  ];

  it('takes a dollar group for a bare "dollars", and asks otherwise', () => {
    const inSydney = parseVoiceExpenses('20 dollars for lunch', groups, { currentGroupId: 'syd' });
    expect(inSydney.items[0]?.currency).toBe('AUD');
    expect(amountIsUnambiguous(inSydney)).toBe(true);
    const inGoa = parseVoiceExpenses('20 dollars for lunch', groups, { currentGroupId: 'goa' });
    expect(inGoa.amount?.currencyOptions).toEqual(['USD', 'AUD']);
    expect(amountIsUnambiguous(inGoa)).toBe(false);
    expect(parseVoiceExpenses('20 US dollars', groups).items[0]?.currency).toBe('USD');
    expect(parseVoiceExpenses('20 Australian dollars', groups).items[0]?.currency).toBe('AUD');
  });

  it('never auto-saves an amount that needs asking', () => {
    const result = parseVoiceExpenses('one fifty to Goa', groups);
    expect(result.group).toEqual({ kind: 'existing', groupId: 'goa' });
    // A rupee group settles "one fifty" as 150.
    expect(amountIsUnambiguous(result)).toBe(true);
    const doubtful = parseVoiceExpenses('fifteen rupees to Goa', groups, {
      alternatives: ['fifty rupees to Goa'],
    });
    expect(doubtful.amount?.ambiguity).toBe('teen-vs-ty');
    expect(voiceAutoAction(doubtful)).toBeNull();
  });
});

describe('the review question', () => {
  it('asks "Was that ₹15 or ₹50?" and answers with the amount', () => {
    const result = parseVoiceExpenses('fifteen rupees for tea', [], {
      alternatives: ['fifty rupees for tea'],
    });
    const question = voiceAmountQuestion(result.amount, 'INR', null, strings, rupees);
    expect(question?.prompt).toBe('Was that ₹15 or ₹50?');
    expect(question?.answers.map((answer) => answer.amount)).toEqual(['15', '50']);
  });

  it('asks total-or-each and totals the share over the people', () => {
    const result = parseVoiceExpenses('500 each', []);
    const question = voiceAmountQuestion(result.amount, 'INR', 4, strings, rupees);
    expect(question?.prompt).toBe('₹500 total or ₹500 each?');
    expect(question?.answers.map((answer) => [answer.label, answer.amount])).toEqual([
      ['₹500 total', '500'],
      ['₹500 each', '2000'],
    ]);
    // Nobody to total over: only the whole-bill answer is offered.
    expect(voiceAmountQuestion(result.amount, 'INR', null, strings, rupees)?.answers).toHaveLength(
      1,
    );
  });

  it('asks which dollars', () => {
    const result = parseVoiceExpenses('25 dollars', []);
    const question = voiceCurrencyQuestion(result.amount, strings);
    expect(question?.prompt).toBe('US or Australian dollars?');
    expect(question?.answers.map((answer) => answer.currency)).toEqual(['USD', 'AUD']);
  });

  it('asks nothing when nothing is in doubt', () => {
    const result = parseVoiceExpenses('500 rupees for dinner', []);
    expect(voiceAmountQuestion(result.amount, 'INR', null, strings, rupees)).toBeNull();
    expect(voiceCurrencyQuestion(result.amount, strings)).toBeNull();
  });
});
