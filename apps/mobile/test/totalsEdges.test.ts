import { describe, expect, it } from 'vitest';

import { otherCurrencyChips, totalsByCurrency, type CurrencyTotals } from '@/data/totals';
import { personDirectionTotals } from '@/lib/friendsTotals';

const r = (person_key: string, currency: string, net: string | bigint) => ({
  person_key,
  currency,
  net,
});
const t = (currency: string, owed: bigint, owing: bigint): CurrencyTotals => ({
  currency,
  net: owed - owing,
  owed,
  owing,
});

describe('personDirectionTotals edges', () => {
  it('is empty for no rows', () => {
    expect(personDirectionTotals([])).toEqual({ owed: [], owing: [] });
  });

  it('a person who nets to zero across groups appears in neither direction', () => {
    expect(personDirectionTotals([r('a', 'INR', '500'), r('a', 'INR', '-500')])).toEqual({
      owed: [],
      owing: [],
    });
  });

  it('nets per person per currency: INR and USD for one person stay separate', () => {
    const out = personDirectionTotals([r('a', 'INR', '100'), r('a', 'USD', '-40')]);
    expect(out.owed).toEqual([{ currency: 'INR', net: 100n }]);
    expect(out.owing).toEqual([{ currency: 'USD', net: -40n }]);
  });

  it('never sums across currencies and accepts bigint or string nets', () => {
    const out = personDirectionTotals([r('a', 'INR', 100n), r('b', 'INR', '250'), r('c', 'USD', 999n)]);
    expect(out.owed).toEqual([
      { currency: 'USD', net: 999n },
      { currency: 'INR', net: 350n },
    ]);
  });

  it('two people owing in the same currency add up, and a net debt flips direction', () => {
    const out = personDirectionTotals([
      r('a', 'INR', '-100'),
      r('b', 'INR', '-50'),
      r('c', 'INR', '30'),
      r('c', 'INR', '-80'),
    ]);
    expect(out.owing).toEqual([{ currency: 'INR', net: -200n }]);
    expect(out.owed).toEqual([]);
  });

  it('owed + owing equals the plain sum of every row in that currency', () => {
    const rows = [r('a', 'INR', '700'), r('a', 'INR', '-200'), r('b', 'INR', '-450'), r('c', 'INR', '10')];
    const { owed, owing } = personDirectionTotals(rows);
    const sum = [...owed, ...owing].reduce((n, x) => n + x.net, 0n);
    expect(sum).toBe(rows.reduce((n, x) => n + BigInt(x.net), 0n));
  });

  it('breaks no ties by throwing: equal magnitudes keep both entries', () => {
    const out = personDirectionTotals([r('a', 'INR', '100'), r('b', 'USD', '100')]);
    expect(out.owed.map((x) => x.currency).sort()).toEqual(['INR', 'USD']);
  });
});

describe('otherCurrencyChips edges', () => {
  it('is empty when only the headline currency exists', () => {
    expect(otherCurrencyChips([t('INR', 5n, 1n)], 'INR')).toEqual({ owed: [], owing: [] });
    expect(otherCurrencyChips([], 'INR')).toEqual({ owed: [], owing: [] });
  });

  it('a mixed currency shows in both lists, each with its own side', () => {
    expect(otherCurrencyChips([t('USD', 500n, 200n)], 'INR')).toEqual({
      owed: [{ currency: 'USD', amount: 500n }],
      owing: [{ currency: 'USD', amount: 200n }],
    });
  });

  it('drops zero-sided currencies entirely', () => {
    expect(otherCurrencyChips([t('USD', 0n, 0n), t('JPY', 0n, 7n)], 'INR')).toEqual({
      owed: [],
      owing: [{ currency: 'JPY', amount: 7n }],
    });
  });

  it('works from real totalsByCurrency output, keeping its order', () => {
    const totals = totalsByCurrency([
      ['INR', 1000n],
      ['USD', 50n],
      ['USD', -20n],
      ['EUR', -900n],
      ['JPY', 0n],
    ]);
    const chips = otherCurrencyChips(totals, 'INR');
    expect(chips.owed).toEqual([{ currency: 'USD', amount: 50n }]);
    expect(chips.owing).toEqual([
      { currency: 'EUR', amount: 900n },
      { currency: 'USD', amount: 20n },
    ]);
  });
});

describe('totalsByCurrency', () => {
  it('splits owed and owing within a currency and sorts by absolute net, ties alphabetical', () => {
    const out = totalsByCurrency([
      ['USD', -300n],
      ['INR', 100n],
      ['INR', -100n],
      ['EUR', 300n],
    ]);
    expect(out.map((x) => x.currency)).toEqual(['EUR', 'USD', 'INR']);
    expect(out[2]).toEqual({ currency: 'INR', net: 0n, owed: 100n, owing: 100n });
  });
});
