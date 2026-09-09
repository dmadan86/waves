/**
 * The body of the "delete this group?" confirmation (A64).
 *
 * Pulled out of the screen so the wording can be tested without a device: this
 * dialog is the only thing standing between an admin and a record that goes for
 * everyone, so what it says is worth pinning down.
 */

import { plural, type PluralForms } from '@/i18n';
import type { DialogRow } from '@/lib/dialogQueue';
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

/** What the confirmation is handed: a title's worth of prose, then the ledger. */
export interface GroupDeleteWarning {
  readonly body: string;
  /** The open debts, at most {@link MAX_DELETE_DEBT_LINES} of them. */
  readonly rows: readonly DialogRow[];
  /** "and 3 more", when there were more debts than rows. */
  readonly moreRows?: string;
  /** The line that says the loss is everybody's, not only the admin's. */
  readonly note?: string;
}

/**
 * The parts of the "delete this group?" confirmation.
 *
 * It used to return one string, because a native alert could be told nothing
 * else — so four real debts, names and rupee amounts, arrived as a paragraph.
 * The app's own dialog takes rows, so the amounts are handed over as money and
 * drawn as money (A66); what is left here is the wording and the arithmetic of
 * how many to show, which is the part worth pinning down without a device.
 */
export function groupDeleteWarning(params: {
  readonly groupSettled: boolean;
  readonly debts: readonly DialogRow[];
  readonly locale: string;
  readonly text: GroupDeleteWarningStrings;
}): GroupDeleteWarning {
  if (params.groupSettled) return { body: params.text.deleteBody, rows: [] };

  const rows = params.debts.slice(0, MAX_DELETE_DEBT_LINES);
  const unnamed = params.debts.length - rows.length;
  return {
    // The lead-in belongs to the list, so it is the last thing said before it.
    body: `${params.text.deleteBody}

${params.text.deleteUnsettledIntro}`,
    rows,
    moreRows: unnamed > 0 ? plural(params.locale, unnamed, params.text.deleteMoreDebts) : undefined,
    note: params.text.deleteUnsettledWarning,
  };
}
