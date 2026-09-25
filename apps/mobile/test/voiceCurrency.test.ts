import { describe, expect, it } from 'vitest';

import { parseVoiceExpenses } from '../src/lib/voiceExpense';
import { voiceNewGroupCurrency, voiceSaveCurrency } from '../src/lib/voiceCurrency';

describe('voiceSaveCurrency', () => {
  it('keeps the spoken currency in a group that uses another one', () => {
    // The report: "200 dollars for petrol" saved to a rupee group read ₹200.
    const [item] = parseVoiceExpenses('200 dollars for petrol', []).items;
    expect(item?.currency).toBe('USD');
    expect(voiceSaveCurrency(item?.currency ?? null, 'INR', 'INR')).toBe('USD');
  });

  it('falls back to the group, then the default, when no currency was heard', () => {
    expect(voiceSaveCurrency(null, 'EUR', 'INR')).toBe('EUR');
    expect(voiceSaveCurrency(null, null, 'INR')).toBe('INR');
  });
});

describe('voiceNewGroupCurrency', () => {
  it('makes a new group in the one currency the batch named', () => {
    expect(voiceNewGroupCurrency(['USD', null, 'USD'], 'INR')).toBe('USD');
  });

  it('uses the default when the batch named none, or several', () => {
    expect(voiceNewGroupCurrency([null], 'INR')).toBe('INR');
    expect(voiceNewGroupCurrency(['USD', 'EUR'], 'INR')).toBe('INR');
  });
});
