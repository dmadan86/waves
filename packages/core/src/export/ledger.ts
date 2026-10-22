/**
 * The "who paid" and "how it was split" text the CSV and PDF exports print for
 * an expense. Pure, so a test can pin it; the edge function only supplies rows.
 * Amounts go through formatMinor (bigint minor units, no floats) and carry no
 * symbol: the row's currency is printed beside them, and the PDF's base-14
 * fonts cannot draw a rupee sign anyway.
 */

import { unitOf, type GroupUnits } from '../group/units';
import { formatMinor } from './pdf';

export interface MemberAmount {
  readonly member_id: string | null;
  readonly amount: bigint | number | string;
}

/** The app's split-mode names (same words as the expense screen, English). */
const SPLIT_LABELS: Record<string, string> = {
  equal: 'Equally',
  exact: 'By exact amounts',
  percent: 'By percentage',
  shares: 'By shares',
  adjustment: 'Adjusted',
  itemized: 'Itemized',
  units: 'By family',
};

export function splitMethodLabel(splitType: string | null | undefined): string {
  return SPLIT_LABELS[splitType ?? ''] ?? splitType ?? '';
}

/** "Madan 400.00, Renny 200.00" — or joined with "; " for one CSV cell. */
export function memberAmounts(
  rows: readonly MemberAmount[] | null | undefined,
  currency: string,
  nameOf: (memberId: string | null) => string,
  joiner = ', ',
): string {
  return (rows ?? [])
    .map((row) => `${nameOf(row.member_id)} ${formatMinor(row.amount, currency)}`)
    .join(joiner);
}

/** Greedy word wrap, so a long list continues on the next line instead of being clipped. */
export function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The "Family" column: the member's family name, or '' (no family, or a group without any). */
export function familyName(units: GroupUnits | null | undefined, memberId: string | null): string {
  const id = memberId ? unitOf(units, memberId) : null;
  return id ? (units?.[id]?.name ?? '') : '';
}

export interface FamilySubtotal {
  readonly family: string;
  readonly currency: string;
  /** What the family's members paid, their share of the bills, and paid - share (positive: owed). */
  readonly paid: bigint;
  readonly share: bigint;
  readonly net: bigint;
}

/**
 * The per-family block under the ledger: one row per family per currency
 * (never mixed, ADR-004), over the active expenses given. People in no family
 * are left out; empty when the group has no families.
 */
export function familySubtotals(
  units: GroupUnits | null | undefined,
  expenses: readonly {
    readonly currency: string;
    readonly payers: readonly MemberAmount[] | null | undefined;
    readonly shares: readonly MemberAmount[] | null | undefined;
  }[],
): FamilySubtotal[] {
  const sums = new Map<string, { family: string; currency: string; paid: bigint; share: bigint }>();
  const add = (
    currency: string,
    rows: readonly MemberAmount[] | null | undefined,
    field: 'paid' | 'share',
  ): void => {
    for (const row of rows ?? []) {
      const unitId = row.member_id ? unitOf(units, row.member_id) : null;
      if (!unitId) continue;
      const key = `${unitId}\u0000${currency}`;
      const sum = sums.get(key) ?? {
        family: units?.[unitId]?.name ?? '',
        currency,
        paid: 0n,
        share: 0n,
      };
      sum[field] += BigInt(row.amount);
      sums.set(key, sum);
    }
  };
  for (const expense of expenses) {
    add(expense.currency, expense.payers, 'paid');
    add(expense.currency, expense.shares, 'share');
  }
  return [...sums.values()].map((sum) => ({ ...sum, net: sum.paid - sum.share }));
}
