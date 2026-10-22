/**
 * "Split by item" from the voice follow-up card.
 *
 * A group expense saved by voice has no lines. A bill somebody already scanned
 * for the same group does: it sits among the group's open receipts with its
 * parsed items. When one of those is the same bill (same total, nobody has
 * claimed a line yet) the card offers to split by item, and tapping it opens the
 * itemize screen already filled with the lines and the receipt attached.
 *
 * The lines travel the way a scan from the add-expense screen does: through the
 * one-shot receipt handover in the draft store (`lib/handover`), keyed per
 * group. The expense the voice agent just saved is not duplicated: the itemize
 * screen is told to replace it (`replaces`) and deletes it only after the
 * itemised one is written.
 */

import { hasSplittableItems, type ParsedReceipt } from '@waves/core';

import type { ReceiptHandover } from '@/lib/handover';

export interface OpenReceiptLike {
  readonly id: string;
  readonly created_at: string;
  readonly parsed: ParsedReceipt | null;
  readonly claimed: number;
}

/**
 * The open receipt that is this expense's bill, or null. Only a bill with
 * priced lines, no claims yet and the same grand total qualifies; the newest
 * wins when a group scanned the same amount twice.
 */
export function findSplittableReceipt(
  rows: readonly OpenReceiptLike[] | null | undefined,
  amountMinor: bigint,
): OpenReceiptLike | null {
  const matches = (rows ?? []).filter(
    (row) =>
      row.parsed !== null &&
      row.claimed === 0 &&
      hasSplittableItems(row.parsed) &&
      Number.isSafeInteger(row.parsed.grandTotal) &&
      BigInt(row.parsed.grandTotal) === amountMinor,
  );
  if (matches.length === 0) return null;
  return [...matches].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

/** The handover the itemize screen consumes, stamped now. */
export function handoverFor(row: OpenReceiptLike, now = Date.now()): ReceiptHandover {
  return { parsed: row.parsed as ParsedReceipt, receiptId: row.id, at: now };
}

/** Route params for the itemize screen when it replaces a voice-saved expense. */
export function itemizeParams(groupId: string, replacesExpenseId: string) {
  return { id: groupId, replaces: replacesExpenseId };
}
