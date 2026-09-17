/**
 * Turning a half-typed bill into split parameters.
 *
 * The subtle part is the indexing. `ItemizedParams` keys its claims by an
 * item's *position* in the items array, and the editor's rows are not that
 * array: a row somebody has not finished typing carries no amount and is left
 * out. So the two have to be built together, with the claim written against the
 * position the line actually lands in — not against the row's position in the
 * editor. Getting that wrong moves people's dinners onto somebody else's bill,
 * silently, and the only symptom is that the numbers are wrong.
 *
 * Kept out of the screen so it can be tested without one.
 */

import type { ItemizedParams } from '@waves/core';

/** One row of the editor, as typed. */
export interface DraftLine {
  label: string;
  amountText: string;
  claimers: string[];
}

/** The extras, which are prorated by item subtotal rather than split equally. */
export interface DraftExtras {
  taxes: string;
  serviceCharge: string;
  tip: string;
  discounts: string;
}

/** Reads a typed amount in this currency, or null if it is not one yet. */
export type ParseAmount = (text: string) => bigint | null;

/** A row counts once it carries an amount. Until then it is somebody typing. */
export function isTyped(line: DraftLine, parse: ParseAmount): boolean {
  return parse(line.amountText) !== null;
}

/**
 * The split parameters for the rows that carry an amount, or null when none
 * do yet.
 */
export function itemizedParams(
  lines: readonly DraftLine[],
  extras: DraftExtras,
  parse: ParseAmount,
): ItemizedParams | null {
  const items: { label?: string; total: bigint }[] = [];
  const claims: Record<number, string[]> = {};

  for (const line of lines) {
    const total = parse(line.amountText);
    if (total === null) continue;
    // Written against the position this line takes in `items`, which is what
    // the claim is keyed by — never the row's index in the editor.
    claims[items.length] = line.claimers;
    items.push({ label: line.label.trim() || undefined, total });
  }

  if (items.length === 0) return null;

  const extra = (text: string) => parse(text) ?? undefined;
  return {
    kind: 'itemized',
    items,
    claims,
    taxes: extra(extras.taxes),
    serviceCharge: extra(extras.serviceCharge),
    tip: extra(extras.tip),
    discounts: extra(extras.discounts),
  };
}

/**
 * What the bill comes to: the lines, plus tax and service and tip, less any
 * discount. The expense's own total, which the server recomputes and checks.
 */
export function billTotal(
  lines: readonly DraftLine[],
  extras: DraftExtras,
  parse: ParseAmount,
): bigint {
  let total = 0n;
  for (const line of lines) total += parse(line.amountText) ?? 0n;
  const extra = (text: string) => parse(text) ?? 0n;
  return (
    total +
    extra(extras.taxes) +
    extra(extras.serviceCharge) +
    extra(extras.tip) -
    extra(extras.discounts)
  );
}

/** Everybody who claimed a line that counts. Nobody else is on this bill. */
export function claimants(lines: readonly DraftLine[], parse: ParseAmount): string[] {
  return [
    ...new Set(lines.filter((line) => isTyped(line, parse)).flatMap((line) => line.claimers)),
  ];
}

/** The lines that carry an amount but that nobody has claimed yet. */
export function unclaimed(lines: readonly DraftLine[], parse: ParseAmount): DraftLine[] {
  return lines.filter((line) => isTyped(line, parse) && line.claimers.length === 0);
}
