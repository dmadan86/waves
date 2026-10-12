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
  | 'problemAmbiguousDate'
  | 'problemMixedDates'
  | 'problemTooManyDecimals'
  | 'problemRefund'
  | 'problemUnknownPerson'
  | 'problemSplitMismatch'
  | 'problemPercentNot100'
  | 'problemTooManyRows'
  | 'problemFileTooLarge'
  | 'problemEncoding'
  | 'problemLikelyDuplicate'
  | 'problemLowConfidence'
  | 'problemNotAnExpense'
  | 'problemPayerEstimated'
  | 'problemUnexpectedSettlement'
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
    case ImportProblemKind.AmbiguousDate:
      return t.problemAmbiguousDate;
    case ImportProblemKind.MixedDateFormats:
      return t.problemMixedDates;
    case ImportProblemKind.TooManyDecimals:
      return t.problemTooManyDecimals;
    case ImportProblemKind.RefundNotSupported:
      return t.problemRefund;
    case ImportProblemKind.UnknownPerson:
      return t.problemUnknownPerson;
    case ImportProblemKind.SplitDoesNotAddUp:
      return t.problemSplitMismatch;
    case ImportProblemKind.PercentNot100:
      return t.problemPercentNot100;
    case ImportProblemKind.TooManyRows:
      return t.problemTooManyRows;
    case ImportProblemKind.FileTooLarge:
      return t.problemFileTooLarge;
    case ImportProblemKind.EncodingLost:
      return t.problemEncoding;
    case ImportProblemKind.LikelyDuplicate:
      return t.problemLikelyDuplicate;
    case ImportProblemKind.LowConfidence:
      return t.problemLowConfidence;
    case ImportProblemKind.NotAnExpense:
      return t.problemNotAnExpense;
    case ImportProblemKind.PayerEstimated:
      return t.problemPayerEstimated;
    case ImportProblemKind.UnexpectedSettlement:
      return t.problemUnexpectedSettlement;
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
