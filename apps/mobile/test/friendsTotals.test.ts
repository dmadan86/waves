/**
 * The Friends screen's arithmetic, and specifically what it does when somebody
 * is carrying a lot of currencies at once — the case a screenshot caught the
 * layout failing on.
 */

import { describe, expect, it } from 'vitest';

import {
  currencyTotals,
  directionGroups,
  personDirection,
  shownAmounts,
  type CurrencyTotal,
} from '@/lib/friendsTotals';

const total = (currency: string, net: bigint): CurrencyTotal => ({ currency, net });

describe('currencyTotals', () => {
  it('sums per currency and never across them', () => {
    expect(
      currencyTotals([
        { currency: 'INR', net: '1000' },
        { currency: 'USD', net: '50' },
        { currency: 'INR', net: '500' },
      ]),
    ).toEqual([total('INR', 1500n), total('USD', 50n)]);
  });

  it('drops a currency that nets to nothing', () => {
    // "You are owed ₹0" is not news, and it would take a headline slot.
    expect(
      currencyTotals([
        { currency: 'INR', net: '1000' },
        { currency: 'INR', net: '-1000' },
        { currency: 'EUR', net: '-20' },
      ]),
    ).toEqual([total('EUR', -20n)]);
  });

  it('puts the biggest first, by size rather than by sign', () => {
    const out = currencyTotals([
      { currency: 'USD', net: '100' },
      { currency: 'EUR', net: '-900' },
      { currency: 'INR', net: '400' },
    ]);
    expect(out.map((entry) => entry.currency)).toEqual(['EUR', 'INR', 'USD']);
  });
});

describe('directionGroups', () => {
  it('says each direction once, however many currencies it holds', () => {
    // The bug this pins: the hero drew one full-size row per currency, so the
    // screenshot read "You're owed" three times down the panel.
    const groups = directionGroups([
      total('INR', 4336574n),
      total('USD', 70296n),
      total('JPY', 11579n),
      total('EUR', -1830n),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ owed: true, head: total('INR', 4336574n) });
    expect(groups[0]?.rest.map((entry) => entry.currency)).toEqual(['USD', 'JPY']);
    expect(groups[1]).toMatchObject({ owed: false, head: total('EUR', -1830n), rest: [] });
  });

  it('leads with the biggest of each direction, keeping the incoming order', () => {
    const groups = directionGroups([
      total('EUR', -9000n),
      total('INR', 4000n),
      total('USD', -100n),
    ]);
    // Owed first even though the largest figure overall is money you owe.
    expect(groups.map((group) => group.owed)).toEqual([true, false]);
    expect(groups[1]?.head).toEqual(total('EUR', -9000n));
    expect(groups[1]?.rest).toEqual([total('USD', -100n)]);
  });

  it('gives one group when everything runs one way, and none when there is nothing', () => {
    expect(directionGroups([total('INR', 10n)]).map((group) => group.owed)).toEqual([true]);
    expect(directionGroups([total('INR', -10n)]).map((group) => group.owed)).toEqual([false]);
    expect(directionGroups([])).toEqual([]);
  });
});

describe('personDirection', () => {
  it('names the direction when every currency agrees', () => {
    // The bug this pins: this was answered only for a single-currency person, so
    // a row with two currencies lost its caption line entirely and the list
    // alternated between one-line and two-line rows.
    expect(
      personDirection([
        { currency: 'INR', net: '14068' },
        { currency: 'USD', net: '32459' },
      ]),
    ).toBe('owed');
    expect(
      personDirection([
        { currency: 'INR', net: '-1' },
        { currency: 'USD', net: '-2' },
      ]),
    ).toBe('owing');
  });

  it('stays silent when the balance runs both ways', () => {
    // No word is true of both halves; the coloured amounts carry it instead.
    expect(
      personDirection([
        { currency: 'INR', net: '4614' },
        { currency: 'USD', net: '-39' },
      ]),
    ).toBeNull();
  });

  it('treats a zero as neither owed nor owing', () => {
    expect(personDirection([{ currency: 'INR', net: '0' }])).toBeNull();
    expect(personDirection([])).toBeNull();
  });
});

describe('shownAmounts', () => {
  const codes = (rows: readonly { currency: string }[]): string[] =>
    rows.map((row) => row.currency);

  it('never hides a direction, even when both of that side are small', () => {
    // The bug this pins: taking the two biggest dropped both of Tom's red
    // amounts, so a person who owed money as well as being owed it rendered as
    // purely owed-to-you — a row stating the opposite of the truth.
    const { shown, hidden } = shownAmounts(
      [
        { currency: 'USD', net: '41777' },
        { currency: 'INR', net: '21000' },
        { currency: 'JPY', net: '-15487' },
        { currency: 'EUR', net: '-1830' },
      ],
      2,
    );
    expect(codes(shown)).toContain('JPY');
    expect(shown.some((row) => BigInt(row.net) > 0n)).toBe(true);
    expect(shown.some((row) => BigInt(row.net) < 0n)).toBe(true);
    expect(hidden).toBe(2);
  });

  it('takes the two biggest when everything runs one way', () => {
    const { shown, hidden } = shownAmounts(
      [
        { currency: 'INR', net: '100' },
        { currency: 'USD', net: '900' },
        { currency: 'EUR', net: '500' },
      ],
      2,
    );
    expect(codes(shown)).toEqual(['USD', 'EUR']);
    expect(hidden).toBe(1);
  });

  it('compares currencies by their major unit, not by raw minor units', () => {
    // JPY has no minor unit, so ¥27,066 is 27066 while ₹4,614.66 is 461466.
    // Sorting the raw numbers ranks the rupees above the yen on a hundred-fold
    // scale error rather than on anything about the money.
    const { shown } = shownAmounts(
      [
        { currency: 'INR', net: '461466' },
        { currency: 'JPY', net: '27066' },
      ],
      1,
    );
    expect(codes(shown)).toEqual(['JPY']);
  });

  it('hides nothing when everything already fits', () => {
    const { shown, hidden } = shownAmounts([{ currency: 'INR', net: '2239525' }], 2);
    expect(codes(shown)).toEqual(['INR']);
    expect(hidden).toBe(0);
  });

  it('would rather exceed the cap than drop a side', () => {
    // A row that misstates the direction is not a smaller version of the truth.
    const { shown, hidden } = shownAmounts(
      [
        { currency: 'INR', net: '100' },
        { currency: 'USD', net: '-100' },
      ],
      1,
    );
    expect(shown).toHaveLength(2);
    expect(hidden).toBe(0);
  });
});
