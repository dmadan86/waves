/**
 * What can go wrong reading a file, as structured kinds.
 *
 * `kind` is what a screen branches on and translates; `message` is the English
 * sentence for logs and the server-side import report, never for UI.
 */

export enum ImportProblemKind {
  UnparseableRow = 'unparseable_row',
  RowDoesNotBalance = 'row_does_not_balance',
  UnknownCurrency = 'unknown_currency',
  DuplicatePerson = 'duplicate_person',
  NonPositiveCost = 'non_positive_cost',
  NoPeople = 'no_people',
  NoRows = 'no_rows',
  /** The file is not a Waves export at all (it did not parse as one). */
  NotAnExport = 'not_an_export',
  /** A Waves export written by a newer app than this one; update to read it. */
  NewerFormat = 'newer_format',
  /** A date like 03/04/2026 that reads two ways and the file gave no hint which. */
  AmbiguousDate = 'ambiguous_date',
  /** Some dates in the file are day-first and others month-first. */
  MixedDateFormats = 'mixed_date_formats',
  /** More decimal places than the currency has, so reading it would mean rounding. */
  TooManyDecimals = 'too_many_decimals',
  /** A negative total. Not an expense; refunds are not supported yet. */
  RefundNotSupported = 'refund_not_supported',
  /** A name in the paid-by or split cells that is not one of the people. */
  UnknownPerson = 'unknown_person',
  /** Shares or exact amounts that do not total the cost. */
  SplitDoesNotAddUp = 'split_does_not_add_up',
  /** Percentages that do not total 100. */
  PercentNot100 = 'percent_not_100',
  TooManyRows = 'too_many_rows',
  FileTooLarge = 'file_too_large',
  /** The bytes were not valid UTF-8, so some characters may have been misread. */
  EncodingLost = 'encoding_lost',
  /** An expense that looks like one already in the group. */
  LikelyDuplicate = 'likely_duplicate',
  /** A value read from a picture that the reader was not sure about. */
  LowConfidence = 'low_confidence',
  /** A line that is a total, a balance or a heading rather than an expense. */
  NotAnExpense = 'not_an_expense',
  /** Several payers with no amounts, so the cost was split between them equally. */
  PayerEstimated = 'payer_estimated',
  /** A Splitwise "Payment" that is not one person paying one other. */
  UnexpectedSettlement = 'unexpected_settlement',
}

export interface ImportProblem {
  readonly kind: ImportProblemKind;
  /** 1-based row in the file, as a spreadsheet would number it. Null for file-level problems. */
  readonly row: number | null;
  readonly message: string;
}
