/**
 * What the delete confirmation says (A64).
 *
 * The server no longer refuses to delete an unsettled group, so this alert is
 * the whole of what stands between an admin and a record that goes for
 * everyone. Worth pinning the wording down without a device.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  groupDeleteWarning,
  MAX_DELETE_DEBT_LINES,
  orderDebtsForWarning,
} from '../src/lib/groupDeleteWarning';
import type { DialogRow } from '../src/lib/dialogQueue';
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

/** A debt as the screen hands it over: who owes whom, and the money apart. */
const debtRow = (label: string, minor = 500n): DialogRow => ({
  key: label,
  label,
  amount: { minor, currency: 'INR' },
});

describe('groupDeleteWarning', () => {
  it('uses the short confirmation for a settled group, and shows no ledger', () => {
    const warning = groupDeleteWarning({
      groupSettled: true,
      debts: [debtRow('Rider owes Financer')],
      locale: 'en',
      text,
    });

    expect(warning.body).toBe(text.deleteBody);
    expect(warning.rows).toEqual([]);
    expect(warning.moreRows).toBeUndefined();
    expect(warning.note).toBeUndefined();
  });

  it('names outstanding rider, traveller, and financer debts before counting the rest', () => {
    const debts = [
      debtRow('Rider owes Financer'),
      debtRow('Traveller owes Financer'),
      debtRow('User owes Rider'),
      debtRow('Traveller owes User'),
      debtRow('Financer owes Traveller'),
    ];

    const warning = groupDeleteWarning({ groupSettled: false, debts, locale: 'en', text });

    // The rows are handed over whole — label and money apart — rather than
    // flattened into the body, which is the point of the new dialog.
    expect(warning.rows).toEqual(debts.slice(0, MAX_DELETE_DEBT_LINES));
    expect(warning.rows).not.toContain(debts[MAX_DELETE_DEBT_LINES]);
    expect(warning.moreRows).toBe('and 1 more');
    expect(warning.body).toContain(text.deleteUnsettledIntro);
    expect(warning.note).toBe(text.deleteUnsettledWarning);
  });

  it('counts nothing extra when every debt is named', () => {
    const warning = groupDeleteWarning({
      groupSettled: false,
      debts: [debtRow('Rider owes Financer')],
      locale: 'en',
      text,
    });

    expect(warning.moreRows).toBeUndefined();
  });

  // Arabic has six plural categories where English has two, and the count of
  // unnamed debts lands in a different one at 1, 2, 3 and 11. The shipped `ar`
  // strings have to supply all of them, and the shared `plural` has to pick
  // them — a wrong form here is a sentence nobody would write.
  it('counts the remaining debts with the right Arabic plural form', () => {
    const ar = STRINGS_BY_LANGUAGE[Language.Ar].group;
    const locale = 'ar';
    const moreWith = (extra: number): string =>
      groupDeleteWarning({
        groupSettled: false,
        // No digits in the labels themselves, so an assertion about digits is
        // an assertion about the count and nothing else.
        debts: Array.from({ length: MAX_DELETE_DEBT_LINES + extra }, (_unused, index) =>
          debtRow('debt '.concat('x'.repeat(index + 1))),
        ),
        locale,
        text: ar,
      }).moreRows ?? '';

    // One and two are the forms Arabic spells out as words, and the ones an
    // English-shaped implementation gets wrong by reaching for `other`.
    expect(moreWith(1)).toContain(ar.deleteMoreDebts.one);
    expect(moreWith(1)).not.toContain('1');
    expect(moreWith(2)).toContain(ar.deleteMoreDebts.two);
    expect(moreWith(2)).not.toContain('2');

    // From three on the count is printed, and in the locale's own digits — a
    // phrase reading "و3 أخرى" is a sentence in two number systems.
    expect(moreWith(3)).toContain(new Intl.NumberFormat(locale).format(3));
    expect(moreWith(11)).toContain(new Intl.NumberFormat(locale).format(11));
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
