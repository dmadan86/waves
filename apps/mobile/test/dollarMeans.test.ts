import { afterEach, describe, expect, it } from 'vitest';

import { setDollarMeans } from '@waves/core';

import { parseVoiceExpenses } from '@/lib/voiceExpense';

afterEach(() => setDollarMeans('ask'));

describe('Dollar means in the voice parser', () => {
  it('a chosen dollar answers "$10 coffee" without a question', () => {
    setDollarMeans('USD');
    const parsed = parseVoiceExpenses('$10 coffee', []);
    expect(parsed.items[0]?.currency).toBe('USD');
    expect(parsed.amount?.currencyOptions ?? []).toEqual([]);
  });

  it('"ask" asks which dollars', () => {
    setDollarMeans('ask');
    expect(parseVoiceExpenses('$10 coffee', []).amount?.currencyOptions).toEqual(['USD', 'AUD']);
  });

  it('an explicit dollar beats the setting', () => {
    setDollarMeans('USD');
    expect(parseVoiceExpenses('10 Australian dollars coffee', []).items[0]?.currency).toBe('AUD');
    expect(parseVoiceExpenses('A$10 coffee', []).items[0]?.currency).toBe('AUD');
  });

  it('a CAD setting reads bucks as CAD', () => {
    setDollarMeans('CAD');
    expect(parseVoiceExpenses('10 bucks coffee', []).items[0]?.currency).toBe('CAD');
  });
});
