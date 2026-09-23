/**
 * What an import or a receipt check found wrong, in the reader's language.
 *
 * `@waves/core` reports problems as structured kinds with an English `message`
 * alongside for logs and the server-side import report. That sentence used to
 * reach the screen as-is, so a Tamil, Hindi or Arabic reader got the one line
 * that mattered most — why their file or bill was refused — in English. The
 * screens translate the kind here instead and never show `message`.
 */

import { ImportProblemKind, type ImportProblem, type ReceiptProblem } from '@waves/core';

import { fill, type UiStrings } from '@/i18n';

type ImportText = Pick<
  UiStrings['importLedger'],
  | 'rowNumber'
  | 'fileWide'
  | 'problemUnreadable'
  | 'problemDoesNotBalance'
  | 'problemUnknownCurrency'
  | 'problemDuplicatePerson'
  | 'problemNonPositiveCost'
  | 'problemNoPeople'
  | 'problemNoRows'
  | 'problemNotAnExport'
  | 'problemNewerFormat'
>;

/** The sentence for one import problem, without saying where in the file it is. */
export function importProblemText(problem: ImportProblem, t: ImportText): string {
  switch (problem.kind) {
    case ImportProblemKind.UnparseableRow:
      return t.problemUnreadable;
    case ImportProblemKind.RowDoesNotBalance:
      return t.problemDoesNotBalance;
    case ImportProblemKind.UnknownCurrency:
      return t.problemUnknownCurrency;
    case ImportProblemKind.DuplicatePerson:
      return t.problemDuplicatePerson;
    case ImportProblemKind.NonPositiveCost:
      return t.problemNonPositiveCost;
    case ImportProblemKind.NoPeople:
      return t.problemNoPeople;
    case ImportProblemKind.NoRows:
      return t.problemNoRows;
    case ImportProblemKind.NotAnExport:
      return t.problemNotAnExport;
    case ImportProblemKind.NewerFormat:
      return t.problemNewerFormat;
  }
}

/**
 * One line of the "rows left out" list: where, then what — "Row 4 · …" for a
 * row, "File · …" for a problem with the file as a whole.
 */
export function importProblemLine(problem: ImportProblem, t: ImportText): string {
  const where = problem.row === null ? t.fileWide : fill(t.rowNumber, { n: problem.row });
  return `${where} · ${importProblemText(problem, t)}`;
}

type ReceiptText = Pick<
  UiStrings['itemize'],
  | 'itemFallback'
  | 'problemNoItems'
  | 'problemNegativeLine'
  | 'problemLowConfidence'
  | 'problemDoesNotReconcile'
>;

/**
 * The sentence for one receipt-check problem. `labels` are the scanned lines'
 * names, so a line problem can say which line; one with no readable name falls
 * back to "Item n".
 */
export function receiptProblemText(
  problem: ReceiptProblem,
  t: ReceiptText,
  labels: readonly string[],
): string {
  const label = (): string => {
    const index = problem.itemIndex ?? -1;
    const named = labels[index]?.trim();
    return named || fill(t.itemFallback, { n: index + 1 });
  };
  switch (problem.kind) {
    case 'no_items':
      return t.problemNoItems;
    case 'negative_line':
      return fill(t.problemNegativeLine, { label: label() });
    case 'low_confidence':
      return fill(t.problemLowConfidence, { label: label() });
    case 'does_not_reconcile':
      return t.problemDoesNotReconcile;
  }
}
