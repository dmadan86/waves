/**
 * The Friends screen's arithmetic, and specifically what it does when somebody
 * is carrying a lot of currencies at once — the case a screenshot caught the
 * layout failing on.
 */

import { describe, expect, it } from 'vitest';

import {
  commonOnlyGroupId,
  currencyTotals,
  directionGroups,
  personDirection,
  rowAction,
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

  it('keeps exponent-3 precision when ranking close currencies', () => {
    // KWD 0.101 and USD 0.10 both truncated to 10 hundredths before, so input
    // order could hide the slightly larger KWD balance.
    const { shown } = shownAmounts(
      [
        { currency: 'USD', net: '10' },
        { currency: 'KWD', net: '101' },
      ],
      1,
    );
    expect(codes(shown)).toEqual(['KWD']);
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

describe('rowAction', () => {
  const entry = (net: string, only_group_id: string | null) => ({ net, only_group_id });

  it('finds the common group across several currency rows', () => {
    expect(commonOnlyGroupId([entry('500', 'trip'), entry('-20', 'trip')])).toBe('trip');
    expect(commonOnlyGroupId([entry('500', 'trip'), entry('-20', 'ride')])).toBeNull();
    expect(commonOnlyGroupId([entry('500', 'trip'), entry('-20', null)])).toBeNull();
    expect(commonOnlyGroupId([])).toBeNull();
  });

  it('offers a nudge when one group and one currency explain the debt', () => {
    expect(rowAction({ is_ghost: false, entries: [entry('500', 'g1')] })).toBe('remind');
    // Spread over several groups: there is no single pair to nudge, so the row
    // carries nothing — which is why a list of such people reserved a column it
    // never filled and pushed every amount away from the edge.
    expect(rowAction({ is_ghost: false, entries: [entry('500', null)] })).toBeNull();
    expect(
      rowAction({ is_ghost: false, entries: [entry('500', 'g1'), entry('20', 'g2')] }),
    ).toBeNull();
  });

  it('will not nudge across currencies, because the nudge names one', () => {
    // `waves_nudge_to_settle` takes a currency alongside the group and the
    // person, so there is no single request that means "remind them" about two
    // debts — only a silent choice of which one to raise, made by whichever row
    // is picked first, with nothing on screen saying which was sent. The person
    // page splits them out and asks properly.
    expect(
      rowAction({ is_ghost: false, entries: [entry('500', 'g1'), entry('-20', 'g1')] }),
    ).toBeNull();
    expect(
      rowAction({ is_ghost: false, entries: [entry('500', 'g1'), entry('20', 'g1')] }),
    ).toBeNull();
  });

  it('offers nothing to somebody you owe', () => {
    expect(rowAction({ is_ghost: false, entries: [entry('-500', 'g1')] })).toBeNull();
  });

  it('offers a guest their invite, whichever way the same-group balance runs', () => {
    expect(rowAction({ is_ghost: true, entries: [entry('-500', 'g1')] })).toBe('invite');
    expect(rowAction({ is_ghost: true, entries: [entry('500', 'g1')] })).toBe('invite');
    expect(rowAction({ is_ghost: true, entries: [entry('500', 'g1'), entry('-20', 'g1')] })).toBe(
      'invite',
    );
  });

  it('offers nothing when several currencies do not share one group', () => {
    expect(
      rowAction({ is_ghost: true, entries: [entry('500', 'g1'), entry('-20', 'g2')] }),
    ).toBeNull();
  });
});
