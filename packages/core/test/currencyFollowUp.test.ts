import { describe, expect, it } from 'vitest';

import {
  buildHistoryStats,
  floorMinor,
  isSmallSpend,
  type HistoryRecord,
} from '../src/voice/followUps';
import { format, money, readVoiceAmounts } from '../src';

describe('currency follow-ups in core', () => {
  it('CU-07 scales the currency floor table and the default floor by exponent', () => {
    for (const [currency, major] of [
      ['INR', 200n],
      ['USD', 5n],
      ['GBP', 4n],
      ['AED', 20n],
      ['AUD', 8n],
    ] as const) {
      expect(floorMinor(currency, 2)).toBe(major * 100n);
      expect(floorMinor(currency.toLowerCase(), 2)).toBe(major * 100n);
    }
    expect(floorMinor('KWD', 3)).toBe(5000n);
  });

  it('CU-08 uses a per-currency median and falls back to the GBP floor without GBP history', () => {
    const record: HistoryRecord = {
      scope: 'personal',
      amountMinor: 800000n,
      currency: 'inr',
      category: 'shopping',
      description: 'Shoes',
      date: '2026-10-21',
      partners: [],
      place: null,
      at: '2026-10-21',
    };
    const history = buildHistoryStats(Array.from({ length: 5 }, () => ({ ...record })));
    expect(history.byCurrency).toEqual({ INR: { median: 800000n, count: 5 } });
    expect(isSmallSpend(400n, 'INR', history)).toBe(true);
    expect(isSmallSpend(399n, 'GBP', history)).toBe(true);
    expect(isSmallSpend(400n, 'GBP', history)).toBe(false);
    const mixed = buildHistoryStats([
      ...Array.from({ length: 5 }, () => record),
      ...Array.from({ length: 5 }, () => ({ ...record, currency: 'gbp', amountMinor: 1000n })),
    ]);
    expect(mixed.byCurrency.GBP).toEqual({ median: 1000n, count: 5 });
    expect(isSmallSpend(999n, 'gbp', mixed)).toBe(true);
    expect(isSmallSpend(1000n, 'GBP', mixed)).toBe(false);
  });

  it('CU-11 reads JPY with no decimal scaling', () => {
    expect(readVoiceAmounts('1,250 yen', { currency: 'JPY' }).totalMinor?.toString()).toBe('1250');
  });

  it('CU-12 reads KWD with three decimal places', () => {
    expect(readVoiceAmounts('1.250 KD', { currency: 'KWD' }).totalMinor?.toString()).toBe('1250');
  });

  it('CU-14 documents en-IN and Hindi formatting with retained currency decimals', () => {
    // The existing formatter always retains currency minor digits, including .00.
    expect(format(money(800000n, 'INR'), { locale: 'en-IN' })).toBe('₹8,000.00');
    expect(format(money(800000n, 'INR'), { locale: 'hi' })).toBe('₹8,000.00');
  });
});
