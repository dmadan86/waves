/**
 * The body of the "delete this group?" confirmation (A64).
 *
 * Pulled out of the screen so the wording can be tested without a device: the
 * alert is the only thing standing between an admin and a record that goes for
 * everyone, so what it says is worth pinning down.
 */

import { plural, type PluralForms } from '@/i18n';
import type { Transfer } from '@waves/core';

/**
 * How many open debts the warning spells out before it starts counting the
 * rest. Four is enough to make the loss feel like a list of real people rather
 * than a number, and short enough that the alert still fits on a phone.
 */
export const MAX_DELETE_DEBT_LINES = 4;

export interface GroupDeleteWarningStrings {
  readonly deleteBody: string;
  readonly deleteUnsettledIntro: string;
  readonly deleteUnsettledWarning: string;
  readonly deleteMoreDebts: PluralForms;
}

/**
 * The order the debts are said in, given only four of them are said at all.
 *
 * `transfers` arrives in the order the balance maths happened to produce —
 * alphabetical by currency then by member id — so slicing it takes four
 * arbitrary debts and counts the rest, which can hide the ₹40,000 nobody paid
 * behind three small ones. The point of naming them is to make the loss
 * concrete, so the biggest go first.
 *
 * "Biggest" only means anything inside one currency: comparing ₹500 with $8.50
 * needs an FX rate this screen does not have, and minor units are not even the
 * same size (JPY has no decimals). So the group's own currency leads, the rest
 * follow alphabetically, and within each the largest debt is first.
 */
export function orderDebtsForWarning(
  transfers: readonly Transfer[],
  defaultCurrency: string,
): Transfer[] {
  return [...transfers].sort((a, b) => {
    if (a.currency !== b.currency) {
      if (a.currency === defaultCurrency) return -1;
      if (b.currency === defaultCurrency) return 1;
      return a.currency.localeCompare(b.currency);
    }
    // bigint, so no subtraction into a number that might not hold it.
    return a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0;
  });
}

export function groupDeleteBody(params: {
  readonly groupSettled: boolean;
  readonly debtLines: readonly string[];
  readonly locale: string;
  readonly text: GroupDeleteWarningStrings;
}): string {
  if (params.groupSettled) return params.text.deleteBody;

  const shown = params.debtLines.slice(0, MAX_DELETE_DEBT_LINES);
  return [
    params.text.deleteBody,
    '',
    params.text.deleteUnsettledIntro,
    ...shown,
    ...(params.debtLines.length > shown.length
      ? [plural(params.locale, params.debtLines.length - shown.length, params.text.deleteMoreDebts)]
      : []),
    '',
    params.text.deleteUnsettledWarning,
  ].join('\n');
}
