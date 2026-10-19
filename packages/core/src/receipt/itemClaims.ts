/**
 * Turning a parsed receipt into the lines of a split-by-item bill.
 *
 * Pure: no I/O, no ids. The itemize screen, the voice follow-up card and the
 * tests all go through here so they agree on which lines count, where charges
 * go and whether the result still adds up to the printed total.
 */

import type { ItemizedParams, MemberId } from '../split/types';
import type { ParsedReceipt } from './types';

export interface ItemDraftLine {
  readonly label: string;
  /** Line total in minor units. Always > 0. */
  readonly total: bigint;
  /** Who had it. Empty until somebody claims the line. */
  readonly claimers: readonly MemberId[];
}

export interface ReceiptItemDraft {
  readonly merchant: string | null;
  readonly currency: string;
  readonly items: readonly ItemDraftLine[];
  readonly taxes: bigint;
  readonly serviceCharge: bigint;
  readonly tip: bigint;
  /** Positive value, subtracted from the bill (coupons, negative lines). */
  readonly discounts: bigint;
  /** items + taxes + service + tip - discounts. */
  readonly total: bigint;
  /** The printed grand total, in minor units. */
  readonly printedTotal: bigint;
  /** True when `total` equals the printed total. */
  readonly reconciles: boolean;
}

const isMinor = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

/** The part of a receipt that can be split: lines with a positive price. */
function positiveLines(parsed: ParsedReceipt): ParsedReceipt['items'][number][] {
  return (parsed.items ?? []).filter((line) => isMinor(line.total) && line.total > 0);
}

/** True when there is at least one priced line to hand out. */
export function hasSplittableItems(parsed: ParsedReceipt | null | undefined): boolean {
  return Boolean(parsed) && positiveLines(parsed as ParsedReceipt).length > 0;
}

/**
 * The draft a person starts from on the itemize screen.
 *
 * - zero-priced lines are dropped (nothing to claim);
 * - a negative line (a printed coupon) becomes a discount, never an item;
 * - non-integer or non-finite amounts are ignored rather than rounded, because
 *   a guessed amount in the ledger is worse than a missing line.
 */
export function receiptToItemDraft(parsed: ParsedReceipt): ReceiptItemDraft {
  const lines = positiveLines(parsed);
  const items: ItemDraftLine[] = lines.map((line, index) => ({
    label: line.label?.trim() || `Item ${index + 1}`,
    total: BigInt(line.total),
    claimers: [],
  }));

  const sum = (values: readonly (number | null | undefined)[]): bigint =>
    values.reduce<bigint>((acc, v) => (isMinor(v) && v > 0 ? acc + BigInt(v) : acc), 0n);

  const negativeLines = (parsed.items ?? []).filter((l) => isMinor(l.total) && l.total < 0);
  const taxes = sum((parsed.taxes ?? []).map((t) => t.amount));
  const serviceCharge = sum([parsed.serviceCharge]);
  const tip = sum([parsed.tip]);
  const discounts =
    sum((parsed.discounts ?? []).map((d) => d.amount)) +
    negativeLines.reduce((acc, l) => acc + BigInt(-l.total), 0n);

  const itemsTotal = items.reduce((acc, i) => acc + i.total, 0n);
  const total = itemsTotal + taxes + serviceCharge + tip - discounts;
  const printedTotal = isMinor(parsed.grandTotal) ? BigInt(parsed.grandTotal) : 0n;

  return {
    merchant: parsed.merchant?.trim() || null,
    currency: parsed.currency,
    items,
    taxes,
    serviceCharge,
    tip,
    discounts,
    total,
    printedTotal,
    reconciles: total === printedTotal,
  };
}

/** index -> claimers, the shape `ItemizedParams.claims` wants. */
export function claimsRecord(
  items: readonly Pick<ItemDraftLine, 'claimers'>[],
): Record<number, readonly MemberId[]> {
  return Object.fromEntries(items.map((item, index) => [index, item.claimers]));
}

/** The split params for a draft once every line has been claimed. */
export function draftToItemizedParams(draft: ReceiptItemDraft): ItemizedParams {
  return {
    kind: 'itemized',
    items: draft.items.map((item) => ({ label: item.label, total: item.total })),
    claims: claimsRecord(draft.items),
    taxes: draft.taxes,
    serviceCharge: draft.serviceCharge,
    tip: draft.tip,
    discounts: draft.discounts,
  };
}

/** Give every line of a draft to the same people (a quick "split it all"). */
export function claimAll(draft: ReceiptItemDraft, members: readonly MemberId[]): ReceiptItemDraft {
  return { ...draft, items: draft.items.map((item) => ({ ...item, claimers: [...members] })) };
}

/** Lines nobody has claimed yet, by index. */
export function unclaimedIndexes(items: readonly Pick<ItemDraftLine, 'claimers'>[]): number[] {
  return items.flatMap((item, index) => (item.claimers.length === 0 ? [index] : []));
}
