/**
 * The "who paid" and "how it was split" text the CSV and PDF exports print for
 * an expense. Pure, so a test can pin it; the edge function only supplies rows.
 * Amounts go through formatMinor (bigint minor units, no floats) and carry no
 * symbol: the row's currency is printed beside them, and the PDF's base-14
 * fonts cannot draw a rupee sign anyway.
 */

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
