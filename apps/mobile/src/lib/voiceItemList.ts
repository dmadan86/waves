/**
 * One sentence, several priced things ("food 20, tea 30, dress 1000") is ONE
 * expense per currency: the amounts add up and the description lists the items.
 * Shared by the on-device parser and the server agent's actions, so both read
 * the same. Amounts of different currencies are never added together.
 */

import { minorToDecimal } from '@waves/core';

/** Rows in first-seen currency order: [[₹ rows], [$ rows]]. */
export function groupByCurrency<T extends { currency: string | null }>(rows: readonly T[]): T[][] {
  const groups = new Map<string | null, T[]>();
  for (const row of rows) groups.set(row.currency, [...(groups.get(row.currency) ?? []), row]);
  return [...groups.values()];
}

/** "food 20, tea 30": each item with its plain amount, in the order said. */
export function itemList(
  rows: readonly { note: string; amountMinor: bigint }[],
  currency: string | null,
  maxChars = 160,
): string {
  return rows
    .map((row) =>
      [row.note.trim(), minorToDecimal(row.amountMinor, currency)].filter(Boolean).join(' '),
    )
    .join(', ')
    .slice(0, maxChars);
}

/** The row with the biggest amount: its category stands for the lot. */
export function largest<T extends { amountMinor: bigint }>(rows: readonly T[]): T {
  return rows.reduce((top, row) => (row.amountMinor > top.amountMinor ? row : top));
}
