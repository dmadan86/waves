/**
 * The sheet we hand somebody to fill in: the group's real member names and
 * currency, with two example rows that show the paid-by and split syntax.
 * What it writes is exactly what `draftFromTable` reads back.
 */

import type { CurrencyCode } from '../money/currency';
import { minorUnitExponent } from '../money/currency';

export const TEMPLATE_HEADER = [
  'date',
  'description',
  'amount',
  'currency',
  'paid_by',
  'split_between',
  'category',
] as const;

// Member names are typed by other people, and the template is opened in a
// spreadsheet: a leading =, +, -, @ (or tab/CR) would run as a formula. Prefix
// a single quote, as the exports do; readTable strips it on the way back in.
const cellText = (raw: string): string => {
  const value = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /["\n\r,;]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
};

export function buildTemplateCsv(
  members: readonly string[],
  currency: CurrencyCode,
  options: { exampleDate?: string } = {},
): string {
  const date = options.exampleDate ?? '2026-01-15';
  const [first, second, third] = members;
  const money = (whole: number): string =>
    minorUnitExponent(currency) === 0 ? String(whole) : `${whole}.00`;

  const rows: string[][] = [
    [date, 'Dinner', money(1200), currency, first ?? '', '', 'food'],
    [
      date,
      'Cab to the airport',
      money(600),
      currency,
      second ?? first ?? '',
      [first, second, third]
        .filter((name): name is string => Boolean(name))
        .slice(0, 2)
        .join('; '),
      'travel',
    ],
  ];
  return [TEMPLATE_HEADER as readonly string[], ...rows]
    .map((row) => row.map(cellText).join(','))
    .join('\n');
}
