/**
 * What the delete confirmation says (A64).
 *
 * The server no longer refuses to delete an unsettled group, so this alert is
 * the whole of what stands between an admin and a record that goes for
 * everyone. Worth pinning the wording down without a device.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  groupDeleteBody,
  MAX_DELETE_DEBT_LINES,
  orderDebtsForWarning,
} from '../src/lib/groupDeleteWarning';
import { Language, STRINGS_BY_LANGUAGE } from '@/i18n';

// The i18n module imports expo-localization (and through it react-native) at
// load; this test only needs the strings and the plural rules. Same shim
// dictation.test.ts and language.test.ts use.
vi.mock('expo-localization', () => ({ getLocales: () => [] }));

const text = {
  deleteBody: 'It goes for everyone in it, immediately, and this cannot be undone.',
  deleteUnsettledIntro: 'This group is not settled. Right now:',
  deleteUnsettledWarning:
    'Deleting it wipes that record for everyone in the group, not just for you.',
  deleteMoreDebts: { one: 'and {n} more', other: 'and {n} more' },
};

describe('groupDeleteBody', () => {
  it('uses the short confirmation for a settled group', () => {
    expect(
      groupDeleteBody({
        groupSettled: true,
        debtLines: ['Rider owes Financer ₹500'],
        locale: 'en',
        text,
      }),
    ).toBe(text.deleteBody);
  });

  it('names outstanding rider, traveller, and financer debts before counting the rest', () => {
    const debtLines = [
      'Rider owes Financer ₹500',
      'Traveller owes Financer AED 25.00',
      'User owes Rider ₹120',
      'Traveller owes User $8.50',
      'Financer owes Traveller €3.00',
    ];

    const body = groupDeleteBody({ groupSettled: false, debtLines, locale: 'en', text });

    for (const line of debtLines.slice(0, MAX_DELETE_DEBT_LINES)) {
      expect(body).toContain(line);
    }
    expect(body).not.toContain(debtLines[MAX_DELETE_DEBT_LINES]);
    expect(body).toContain('and 1 more');
    expect(body).toContain(text.deleteUnsettledWarning);
  });

  // Arabic has six plural categories where English has two, and the count of
  // unnamed debts lands in a different one at 1, 2, 3 and 11. The shipped `ar`
  // strings have to supply all of them, and the shared `plural` has to pick
  // them — a wrong form here is a sentence nobody would write.
  it('counts the remaining debts with the right Arabic plural form', () => {
    const ar = STRINGS_BY_LANGUAGE[Language.Ar].group;
    const locale = 'ar';
    const bodyWith = (extra: number): string =>
      groupDeleteBody({
        groupSettled: false,
        // No digits in the lines themselves, so an assertion about digits in
        // the body is an assertion about the count and nothing else.
        debtLines: Array.from({ length: MAX_DELETE_DEBT_LINES + extra }, (_unused, index) =>
          'debt '.concat('x'.repeat(index + 1)),
        ),
        locale,
        text: ar,
      });

    // One and two are the forms Arabic spells out as words, and the ones an
    // English-shaped implementation gets wrong by reaching for `other`.
    expect(bodyWith(1)).toContain(ar.deleteMoreDebts.one);
    expect(bodyWith(1)).not.toContain('1');
    expect(bodyWith(2)).toContain(ar.deleteMoreDebts.two);
    expect(bodyWith(2)).not.toContain('2');

    // From three on the count is printed, and in the locale's own digits — a
    // phrase reading "و3 أخرى" is a sentence in two number systems.
    expect(bodyWith(3)).toContain(new Intl.NumberFormat(locale).format(3));
    expect(bodyWith(11)).toContain(new Intl.NumberFormat(locale).format(11));
  });
});

describe('orderDebtsForWarning', () => {
  const debt = (from: string, to: string, currency: string, amount: bigint) => ({
    from,
    to,
    currency,
    amount,
  });

  it("leads with the group's own currency, largest debt first", () => {
    // As `transfers` arrives from the balance maths: alphabetical by currency,
    // then by member id — so the biggest rupee debt is last of all.
    const transfers = [
      debt('asha', 'ravi', 'AED', 2500n),
      debt('meera', 'ravi', 'INR', 12000n),
      debt('zoya', 'asha', 'INR', 400000n),
    ];

    expect(orderDebtsForWarning(transfers, 'INR')).toEqual([
      transfers[2],
      transfers[1],
      transfers[0],
    ]);
  });

  it('does not compare amounts across currencies', () => {
    // ¥5,000 is not 50× ₹100 and this screen has no rate to say what it is, so
    // the currencies stay in blocks rather than interleaving by minor units.
    const transfers = [
      debt('asha', 'ravi', 'JPY', 5000n),
      debt('meera', 'ravi', 'INR', 10000n),
      debt('zoya', 'asha', 'JPY', 900n),
    ];

    expect(orderDebtsForWarning(transfers, 'INR').map((row) => row.currency)).toEqual([
      'INR',
      'JPY',
      'JPY',
    ]);
  });

  it('leaves the caller its own array', () => {
    const transfers = [debt('asha', 'ravi', 'INR', 100n), debt('meera', 'ravi', 'INR', 900n)];
    const before = [...transfers];

    orderDebtsForWarning(transfers, 'INR');

    expect(transfers).toEqual(before);
  });
});
