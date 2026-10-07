import { describe, expect, it } from 'vitest';

import {
  decimalToMinor,
  findAmountSpans,
  findAmbiguousPriceIdioms,
  foldSpokenAmountWords,
  isVoiceAmountClear,
  majorToMinor,
  maskNonMoneyNumbers,
  minorToDecimal,
  parseVoiceIntent,
  readVoiceAmounts,
  resolveSpokenDollar,
  spokenNumberValue,
} from '../src';

describe('exact minor units', () => {
  it.each([
    ['20.05', 'INR', 2005n],
    ['0.1', 'USD', 10n],
    ['1,20,000', 'INR', 12000000n],
    ['3000', 'JPY', 3000n],
    ['1.2345', 'KWD', 1235n],
    ['19.999', 'USD', 2000n],
  ])('%s %s → %s', (value, currency, minor) => {
    expect(decimalToMinor(value, currency)).toBe(minor);
  });

  it('never drifts through a float', () => {
    expect(majorToMinor(20.05, 'INR')).toBe(2005n);
    expect(majorToMinor(1.005, 'USD')).toBe(101n);
    expect(majorToMinor(0.29, null)).toBe(29n);
    expect(minorToDecimal(2005n, 'INR')).toBe('20.05');
    expect(minorToDecimal(150000n, 'INR')).toBe('1500');
  });
});

describe('spokenNumberValue', () => {
  it.each([
    ['one point five lakh', '150000'],
    ['twenty point zero five', '20.05'],
    ['do hazaar paanch sau', '2500'],
    ['dedh sau', '150'],
    ['dhai hazaar', '2500'],
    ['saade teen sau', '350'],
    ['sava sau', '125'],
    ['paune do sau', '175'],
    ['rendu aayiram', '2000'],
    ['khamsa mia', '500'],
    ['alf w khamsa mia', '1500'],
    ['alfain', '2000'],
    ['thalath alaf', '3000'],
    ['2 hazaar', '2000'],
  ])('%s → %s', (words, value) => {
    expect(spokenNumberValue(words)).toBe(value);
  });

  it('refuses what is not a number', () => {
    expect(spokenNumberValue('point point five')).toBeNull();
    expect(spokenNumberValue('dinner')).toBeNull();
  });
});

describe('foldSpokenAmountWords', () => {
  it.each([
    ['paanch sau', '500'],
    ['pachaas rupaye chai', '50 rupaye chai'],
    ['nooru', '100'],
    ['aimbadhu', '50'],
    ['fifteen sorry fifty', '50'],
    ['500 no wait 600 for dinner', '600 for dinner'],
    ['fifty rupees sorry sixty', '60 rupees'],
    ['three fifty sorry four fifty rupees', 'four fifty rupees'],
    ['400 for petrol, no wait, 450 for petrol', '450 for petrol'],
    ['half a lakh', '50000'],
  ])('%s → %s', (said, folded) => {
    expect(foldSpokenAmountWords(said)).toBe(folded);
  });

  it('leaves everyday words that happen to be numbers elsewhere alone', () => {
    for (const said of [
      'do it later',
      'teen patti night',
      'char minar trip',
      'dinner with Mia',
      'so far so good',
      'sorry I am late',
      'I actually paid 300',
    ])
      expect(foldSpokenAmountWords(said)).toBe(said);
  });
});

describe('findAmountSpans', () => {
  const roles = (text: string): string[] =>
    findAmountSpans(text).map((span) => `${span.value}:${span.role}`);

  it('tells money from everything else', () => {
    expect(roles('500 each for 3 people')).toEqual(['500:each', '3:count']);
    expect(roles('flight 302 ticket 4500 rupees')).toEqual(['302:quantity', '4500:total']);
    expect(roles('dinner at 7 for 500')).toEqual(['7:date-ish', '500:total']);
    expect(roles('on the 5th paid 300')).toEqual(['5:date-ish', '300:total']);
    expect(roles('table for 4 dinner 2400')).toEqual(['4:count', '2400:total']);
    expect(roles('split 60 % with ravi')).toEqual(['60:percent']);
    expect(roles('2 beers 600')).toEqual(['2:quantity', '600:total']);
    expect(roles('5 snacks 10 tea')).toEqual(['5:total', '10:total']);
    expect(roles('room 204')).toEqual(['204:quantity']);
    expect(roles('room 4500')).toEqual(['4500:total']);
    expect(roles('meet at 5 30')).toEqual(['5:date-ish', '30:date-ish']);
    expect(roles('in 2024 we went')).toEqual(['2024:date-ish']);
  });

  it('masks only what is never money', () => {
    const masked = maskNonMoneyNumbers('flight 302 at 7 for 500 rupees, 3 people');
    expect(masked.match(/\d+/g)).toEqual(['500', '3']);
  });
});

describe('readVoiceAmounts', () => {
  it('totals a share when the people are counted', () => {
    const reading = readVoiceAmounts('500 each for 3 people', { chosenMinor: 50000n });
    expect(reading).toMatchObject({
      role: 'each',
      eachMinor: 50000n,
      totalMinor: 150000n,
      count: 3,
      ambiguity: 'none',
    });
    expect(isVoiceAmountClear(reading)).toBe(true);
  });

  it('asks total-or-each when nobody is counted', () => {
    const reading = readVoiceAmounts('500 each', { chosenMinor: 50000n });
    expect(reading.ambiguity).toBe('total-or-each');
    expect(reading.totalMinor).toBeNull();
    expect(isVoiceAmountClear(reading)).toBe(false);
  });

  it('asks decimal-or-hundreds only with nothing to lean on', () => {
    const idioms = findAmbiguousPriceIdioms('one fifty');
    expect(idioms).toEqual([{ hundreds: '150', decimal: '1.50' }]);
    const open = readVoiceAmounts('150', { chosenMinor: 15000n, idioms });
    expect(open.ambiguity).toBe('decimal-or-hundreds');
    expect(open.options.map((option) => option.minor)).toEqual([15000n, 150n]);
    const rupeeGroup = readVoiceAmounts('150', {
      chosenMinor: 15000n,
      idioms,
      groupCurrency: 'INR',
    });
    expect(rupeeGroup.ambiguity).toBe('none');
    expect(findAmbiguousPriceIdioms('one fifty rupees')).toEqual([]);
  });

  it('asks teen-vs-ty only when the alternatives disagree', () => {
    const agree = readVoiceAmounts('15', { chosenMinor: 1500n, alternativeMinors: [1500n, null] });
    expect(agree.ambiguity).toBe('none');
    const disagree = readVoiceAmounts('15', { chosenMinor: 1500n, alternativeMinors: [5000n] });
    expect(disagree.ambiguity).toBe('teen-vs-ty');
    expect(disagree.options.map((option) => option.minor)).toEqual([1500n, 5000n]);
  });
});

describe('resolveSpokenDollar', () => {
  it('lets a named dollar stand', () => {
    expect(resolveSpokenDollar('20 US dollars', null)).toBeNull();
    expect(resolveSpokenDollar('30 Australian dollars', 'INR')).toBeNull();
    expect(resolveSpokenDollar('A$30', null)).toBeNull();
  });

  it('takes a dollar group, and otherwise asks', () => {
    expect(resolveSpokenDollar('20 dollars', 'AUD')).toEqual({ currency: 'AUD', options: [] });
    expect(resolveSpokenDollar('$20', 'CAD')).toEqual({ currency: 'CAD', options: [] });
    expect(resolveSpokenDollar('20 bucks', 'INR')).toEqual({
      currency: 'USD',
      options: ['USD', 'AUD'],
    });
    expect(resolveSpokenDollar('20 rupees', null)).toBeNull();
  });
});

describe('parseVoiceIntent amounts', () => {
  it('reads a share times a spoken count', () => {
    const intent = parseVoiceIntent('500 each for 3 people');
    expect(intent.eachMinor).toBe(50000n);
    expect(intent.amountMinor).toBe(150000n);
    expect(intent.notes).toContain('amount_each');
  });

  it('never reads a label, a time or a date as the amount', () => {
    expect(parseVoiceIntent('flight 302 at 7').amountMinor).toBeNull();
    expect(parseVoiceIntent('dinner at 7 for 500').amountMinor).toBe(50000n);
    expect(parseVoiceIntent('paanch sau rupaye chai').amountMinor).toBe(50000n);
  });
});
