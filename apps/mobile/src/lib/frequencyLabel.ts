/**
 * A repeat pattern in words.
 *
 * Three places say a cadence out loud — the rules list, the one form that
 * writes a rule, and a rule's own timeline — and a rule that reads "Quarterly"
 * in the list and "Every 3 months" in the form is the same rule described
 * twice. It lived on the recurring screen until the editor moved off it, which
 * made a route file the thing two other screens imported from.
 *
 * Kept apart from `personalEntry.ts` on purpose: that module is the decision
 * about what a save writes and is unit-tested as plain data, and reaching the
 * string tables from it would drag `expo-localization` — and through it the
 * whole of react-native — into a node test suite that has no business loading
 * either.
 */

import { Frequency } from '@waves/core';

import { fill, type UiStrings } from '@/i18n';

/** The open-ended pattern names its own interval, so "every 5 months" never
 *  reads as the vaguer "every few months". */
export function frequencyLabel(t: UiStrings, frequency: Frequency, interval: number): string {
  switch (frequency) {
    case Frequency.Weekly:
      return t.personal.weekly;
    case Frequency.Fortnightly:
      return t.personal.fortnightly;
    case Frequency.TwiceAMonth:
      return t.personal.twiceAMonth;
    case Frequency.Quarterly:
      return t.personal.quarterly;
    case Frequency.HalfYearly:
      return t.personal.halfYearly;
    case Frequency.Yearly:
      return t.personal.yearly;
    case Frequency.EveryNMonths:
      return fill(t.personal.monthsInterval, { n: String(interval) });
    default:
      return t.personal.monthly;
  }
}
