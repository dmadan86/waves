/**
 * "Paid to" suggestions: the payees this group has used before.
 *
 * A Home group pays the same few outsiders every month — the landlord, the
 * maid, the car rental — so the sheet offers them back rather than asking for
 * the same name to be typed again. Most-used first; a tie goes to the one used
 * most recently. Case and spacing do not make a second payee: "landlord" and
 * "Landlord " are one, shown in the spelling used most recently.
 *
 * Pure, so it is tested without React Native.
 */

import { cleanPayee } from '@waves/core';

/** How many the sheet offers at once. */
export const PAYEE_SUGGESTION_LIMIT = 6;

/** A payee as a comparison key: cleaned and case-folded. */
export function payeeKey(value: string | null | undefined): string {
  return (cleanPayee(value) ?? '').toLocaleLowerCase();
}

/**
 * Distinct payees, most-used first, narrowed to those containing `query`.
 *
 * `payees` is read newest first (the order the ledger lists expenses in), so
 * the first spelling met is the most recent one, and an earlier position wins a
 * tie in the count. What is already typed in full is left out: offering
 * "Landlord" under a field that says "Landlord" is a row that does nothing.
 */
export function payeeSuggestions(
  payees: Iterable<string | null | undefined>,
  query = '',
  limit = PAYEE_SUGGESTION_LIMIT,
): string[] {
  const seen = new Map<string, { label: string; count: number; first: number }>();
  let index = 0;
  for (const raw of payees) {
    const label = cleanPayee(raw);
    if (!label) continue;
    const key = label.toLocaleLowerCase();
    const entry = seen.get(key);
    if (entry) entry.count += 1;
    else seen.set(key, { label, count: 1, first: index });
    index += 1;
  }
  const needle = payeeKey(query);
  return [...seen.entries()]
    .filter(([key]) => key !== needle && (needle === '' || key.includes(needle)))
    .sort(([, a], [, b]) => b.count - a.count || a.first - b.first)
    .slice(0, limit)
    .map(([, entry]) => entry.label);
}
