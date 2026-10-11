import { describe, expect, it } from 'vitest';

import { payeeKey, payeeSuggestions } from '../src/lib/payeeSuggestions';

describe('payeeSuggestions', () => {
  it('lists each payee once, most-used first', () => {
    expect(
      payeeSuggestions(['Maid', 'Landlord', 'Car rental', 'Landlord', 'Maid', 'Landlord']),
    ).toEqual(['Landlord', 'Maid', 'Car rental']);
  });

  it('treats case and spacing as the same payee, keeping the most recent spelling', () => {
    // Newest first: "landlord" is the latest spelling.
    expect(payeeSuggestions(['landlord', 'Landlord ', ' LANDLORD', 'Maid'])).toEqual([
      'landlord',
      'Maid',
    ]);
    expect(payeeSuggestions(['Car  rental', 'car rental'])).toEqual(['Car rental']);
  });

  it('breaks a tie by recency', () => {
    expect(payeeSuggestions(['Books', 'Maid', 'Maid', 'Books'])).toEqual(['Books', 'Maid']);
  });

  it('skips blanks and nulls', () => {
    expect(payeeSuggestions([null, undefined, '', '   ', 'Maid'])).toEqual(['Maid']);
  });

  it('narrows to what is typed, case-insensitively, and drops an exact match', () => {
    const used = ['Landlord', 'Land registry', 'Maid'];
    expect(payeeSuggestions(used, 'LAND')).toEqual(['Landlord', 'Land registry']);
    expect(payeeSuggestions(used, 'landlord')).toEqual([]);
    expect(payeeSuggestions(used, 'aid')).toEqual(['Maid']);
  });

  it('stops at the limit', () => {
    expect(payeeSuggestions(['a', 'b', 'c', 'd'], '', 2)).toEqual(['a', 'b']);
  });
});

describe('payeeKey', () => {
  it('folds case and spacing', () => {
    expect(payeeKey('  Car   Rental ')).toBe('car rental');
    expect(payeeKey(null)).toBe('');
  });
});
