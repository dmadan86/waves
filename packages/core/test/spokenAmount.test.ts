import { describe, expect, it } from 'vitest';

import {
  foldSpokenPriceIdiom,
  foldThousandsShorthand,
  normaliseSpokenAmounts,
} from '../src/text/spokenAmount';

describe('foldSpokenPriceIdiom', () => {
  const folds: [string, string][] = [
    // The reported bug: 350 heard as "three 50" / "3 50" / "three fifty".
    ['three fifty', '350'],
    ['three 50', '350'],
    ['3 50', '350'],
    ['3 fifty', '350'],
    ['twelve fifty', '1250'],
    ['12 50', '1250'],
    ['two fifty', '250'],
    ['two twenty five', '225'],
    ['nine ninety nine', '999'],
    ['paid two fifty for auto', 'paid 250 for auto'],
    ['lunch 3 50 with Arun', 'lunch 350 with Arun'],
    ['three fifty rupees', '350 rupees'],
    ['3 50 rupees', '350 rupees'],
    ['rs 3 50', 'rs 350'],
    ['₹3 50', '₹350'],
    ['3 50 dirhams', '350 dirhams'],
    // Dollar, euro and pound prices are spoken as decimals.
    ['twelve fifty dollars', '12.50 dollars'],
    ['three fifty bucks', '3.50 bucks'],
    ['$3 50', '$3.50'],
    ['3 75 euros', '3.75 euros'],
    ['two ten pounds', '2.10 pounds'],
    ['three-fifty', '350'],
  ];
  it.each(folds)('%s -> %s', (input, expected) => {
    expect(foldSpokenPriceIdiom(input)).toBe(expected);
  });

  const untouched = [
    '5 10', // two numbers, not 510
    'split 500 60 40', // a percentage split, not 6040
    'split 500 sixty forty',
    'split 800 70 30 with arjun',
    '5 rupees snacks 10 rupees tea',
    'three fifteen', // reads as a time as often as a price
    'meeting at three fifty',
    'at 3 50 pm',
    '3 50 pm',
    '3:50',
    'split between three fifty',
    'room 3 50',
    'three hundred fifty',
    'three hundred and fifty rupees',
    'fifteen hundred',
    'twenty five rupees',
    'twenty five',
    'two thousand five hundred',
    'split with 3 people',
    'split among 3 people 500 rupees',
    'on the 5th 500 rupees',
    'twelve point fifty',
    '12.50 dollars',
    '1,250',
    '350',
    '100 50',
    'three',
    '',
  ];
  it.each(untouched)('leaves %j alone', (input) => {
    expect(foldSpokenPriceIdiom(input)).toBe(input);
  });
});

describe('foldThousandsShorthand', () => {
  const cases: [string, string][] = [
    ['2k', '2000'],
    ['1.5k', '1500'],
    ['1.5k for dinner', '1500 for dinner'],
    ['dinner for 2K', 'dinner for 2000'],
    ['two k for rent', '2000 for rent'],
    ['twenty five k', '25000'],
    ['2.25k', '2250'],
    ['5km run', '5km run'],
    ['book', 'book'],
    ['2 kg rice', '2 kg rice'],
  ];
  it.each(cases)('%s -> %s', (input, expected) => {
    expect(foldThousandsShorthand(input)).toBe(expected);
  });
});

describe('normaliseSpokenAmounts', () => {
  it('applies shorthand then the price idiom', () => {
    expect(normaliseSpokenAmounts('1.5k and three fifty')).toBe('1500 and 350');
  });
});
