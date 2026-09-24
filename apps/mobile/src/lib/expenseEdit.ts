/**
 * An expense edit, as data: what a saved version opens as, and what an edit of
 * it writes.
 *
 * Two screens change a saved bill. The full editor (`group/[id]/add-expense`)
 * changes anything; the expense screen's pop-ups change one field at a time —
 * the day, the note, who paid, the split. Both must write *the same thing* for
 * the same change, or a version written from a pop-up would differ from the one
 * the editor would have written: a dropped receipt link, a lost note, a missing
 * `baseVersionNo` (so no concurrent-edit check), or an `expectedShares` seeded
 * with a different id than the server's (a SHARE_MISMATCH, ADR-009). So the
 * seeding, the split params, the preview and the queued payload all live here,
 * and both screens call them.
 *
 * Pure and React-Native-free, so it is tested directly (test/expenseEdit.test.ts).
 * Money is bigint minor units throughout; nothing here converts currencies — an
 * edit keeps the currency the bill was paid in (ADR-003/004).
 */

import {
  computeShares,
  format,
  formatMinorInput,
  money,
  PayerProblemCode,
  serialisePayers,
  validatePayers,
  type CategoryMeta,
  type CurrencyCode,
  type ExpenseLocation,
  type FxRecord,
  type MemberId,
  type PayerMap,
  type PaymentMethod,
  type SplitParams,
} from '@waves/core';

import type { ExpenseVersionRow } from '../data/types';
import {
  entryValues,
  exactRemainder,
  exactValues,
  formatEntry,
  parseEntry,
  SplitKind,
  splitProblem,
  type SplitEntries,
} from './split';

/** Everything an expense write is made from, in the units the ledger keeps. */
export interface ExpenseEditState {
  amount: bigint;
  description: string;
  category: string | null;
  categoryMeta: CategoryMeta | null;
  /** ISO day (YYYY-MM-DD) the bill is filed under. */
  expenseDate: string;
  /** The currency the bill was paid in — never converted by an edit. */
  currency: string;
  fx: FxRecord | null;
  splitKind: SplitKind;
  participants: MemberId[];
  /** What was typed per member, kept apart per kind (see add-expense). */
  weights: SplitEntries;
  percents: SplitEntries;
  exacts: SplitEntries;
  /** Who paid what, in minor units. */
  payers: PayerMap;
  paymentMethod: PaymentMethod;
  location: ExpenseLocation | null;
}

/** The split kind a saved `split_type` reopens as. Itemized and adjustment
 *  splits have no editor of their own and reopen as equal, as they always have. */
export function splitKindOf(splitType: SplitParams['kind']): SplitKind {
  return splitType === 'percent'
    ? SplitKind.Percent
    : splitType === 'shares'
      ? SplitKind.Shares
      : splitType === 'exact'
        ? SplitKind.Exact
        : SplitKind.Equal;
}

/** A saved split's integers, back as the text somebody would have typed. */
export function textEntries(
  values: Readonly<Record<string, number>>,
  kind: 'shares' | 'percent',
): SplitEntries {
  return Object.fromEntries(
    Object.entries(values).map(([memberId, value]) => [memberId, formatEntry(kind, value)]),
  );
}

/**
 * The saved version as an edit starts from it.
 *
 * Every payer the bill records, not just the first — flattening a several-payer
 * bill to one on open, then saving, would silently rewrite who put money in.
 * The typed split figures come back in the fields they were typed into. A bill
 * with no payer row (never written by this app, but the type allows it) falls
 * back to `fallbackPayer` holding the whole amount, as the editor does.
 */
export function editStateFromVersion(
  version: ExpenseVersionRow,
  fallbackPayer: MemberId | null,
): ExpenseEditState {
  const amount = BigInt(version.amount);
  const payers: PayerMap =
    version.payers.length > 0
      ? new Map(version.payers.map((row) => [row.member_id, BigInt(row.amount)]))
      : fallbackPayer
        ? new Map([[fallbackPayer, amount]])
        : new Map();
  const params = version.split_params;
  return {
    amount,
    description: version.description,
    category: version.category ?? null,
    categoryMeta: (version.category_meta as CategoryMeta | null) ?? null,
    expenseDate: version.expense_date,
    currency: version.currency,
    fx: (version.fx as FxRecord | null | undefined) ?? null,
    splitKind: splitKindOf(version.split_type),
    participants: version.shares.map((share) => share.member_id),
    weights: params.kind === 'shares' ? textEntries(params.weights, 'shares') : {},
    percents: params.kind === 'percent' ? textEntries(params.basisPoints, 'percent') : {},
    exacts:
      params.kind === 'exact'
        ? Object.fromEntries(
            Object.entries(params.amounts).map(([memberId, minor]) => [
              memberId,
              formatMinorInput(BigInt(minor), version.currency as CurrencyCode),
            ]),
          )
        : {},
    payers,
    paymentMethod: (version.payment_method as PaymentMethod | null) ?? 'cash',
    location: version.location ?? null,
  };
}

/** The typed split, as the integers `@waves/core` takes. */
export function splitParamsFor(
  state: Pick<
    ExpenseEditState,
    'splitKind' | 'weights' | 'percents' | 'exacts' | 'participants' | 'currency'
  >,
): SplitParams {
  if (state.splitKind === SplitKind.Shares) {
    return { kind: 'shares', weights: entryValues('shares', state.weights, state.participants) };
  }
  if (state.splitKind === SplitKind.Percent) {
    return {
      kind: 'percent',
      basisPoints: entryValues('percent', state.percents, state.participants),
    };
  }
  if (state.splitKind === SplitKind.Exact) {
    return {
      kind: 'exact',
      amounts: exactValues(state.exacts, state.participants, state.currency),
    };
  }
  return { kind: 'equal' };
}

/**
 * The shares the ledger will compute, with the same engine the server uses and
 * seeded with the expense id (ADR-009) — so the odd paisa lands on the same
 * person here as there. Null while the split cannot be computed yet.
 */
export function previewShares(input: {
  amount: bigint;
  currency: string;
  params: SplitParams;
  participants: readonly MemberId[];
  seed: string;
}): Map<MemberId, bigint> | null {
  if (input.participants.length === 0 || input.amount === 0n) return null;
  try {
    return computeShares({
      amount: input.amount,
      currency: input.currency,
      params: input.params,
      participants: [...input.participants],
      seed: input.seed,
    });
  } catch {
    return null;
  }
}

/** The entries of whichever weighted/exact kind is in force. */
export function entriesFor(
  state: Pick<ExpenseEditState, 'splitKind' | 'weights' | 'percents' | 'exacts'>,
): SplitEntries {
  return state.splitKind === SplitKind.Shares
    ? state.weights
    : state.splitKind === SplitKind.Exact
      ? state.exacts
      : state.percents;
}

/**
 * What one person is down for as their figure changes: the ledger's own preview
 * when it exists, else — for a percent split still short of 100 — this line's
 * own share of the total, so the number being typed towards is never blank.
 */
export function lineAmountFor(
  memberId: MemberId,
  preview: ReadonlyMap<MemberId, bigint> | null,
  state: Pick<ExpenseEditState, 'splitKind' | 'percents' | 'amount'>,
): bigint {
  const previewed = preview?.get(memberId);
  if (previewed !== undefined) return previewed;
  if (state.splitKind !== SplitKind.Percent) return 0n;
  const basisPoints = parseEntry('percent', state.percents[memberId] ?? '') ?? 0;
  return (state.amount * BigInt(basisPoints)) / 10000n;
}

/** The sentences the two checks below speak in (from `t.expense`). */
export interface EditIssueStrings {
  paidLeftToAssign: string;
  paidOverAssigned: string;
  chooseWhoPaid: string;
}

/**
 * Why the split does not add up, as the editor says it — an exact split's
 * money left over (or over-assigned) first, then the weighted check. Null when
 * the split is fine.
 */
export function splitIssueFor(
  state: Pick<
    ExpenseEditState,
    'splitKind' | 'weights' | 'percents' | 'exacts' | 'participants' | 'currency' | 'amount'
  >,
  strings: EditIssueStrings,
  locale: string,
): string | null {
  if (state.splitKind === SplitKind.Exact && state.amount > 0n && state.participants.length > 0) {
    const left = exactRemainder(state.exacts, state.participants, state.currency, state.amount);
    if (left !== 0n) {
      return (left > 0n ? strings.paidLeftToAssign : strings.paidOverAssigned).replace(
        '{amount}',
        format(money(left < 0n ? -left : left, state.currency), { locale }),
      );
    }
  }
  return splitProblem(state.splitKind, entriesFor(state), state.participants);
}

/** Why the payers do not add up to the total, in money; null when they do. */
export function payerIssueFor(
  state: Pick<ExpenseEditState, 'amount' | 'payers' | 'currency'>,
  strings: EditIssueStrings,
  locale: string,
): string | null {
  const problem = validatePayers(state.amount, state.payers);
  if (problem === null) return null;
  if (problem.code === PayerProblemCode.NoPayers || problem.code === PayerProblemCode.Negative) {
    return strings.chooseWhoPaid;
  }
  return (
    problem.code === PayerProblemCode.Short ? strings.paidLeftToAssign : strings.paidOverAssigned
  ).replace(
    '{amount}',
    format(money(problem.delta < 0n ? -problem.delta : problem.delta, state.currency), {
      locale,
    }),
  );
}

/**
 * The payload an expense write queues — the one object the full editor and the
 * pop-ups both hand to `mutate(ExpenseUpdate | ExpenseCreate, …)`.
 *
 * `editing` is the version being replaced, or null for a new bill. Fields the
 * forms do not show (the note, the receipt link) are carried through from it:
 * the write nulls every field it is not given, so leaving them out would clear
 * them. `baseVersionNo` lets the server tell a concurrent edit from a normal one
 * (TDR §4.4).
 */
export function expenseWritePayload(input: {
  expenseId: string;
  state: ExpenseEditState;
  editing: ExpenseVersionRow | null | undefined;
}): Record<string, unknown> {
  const { expenseId, state, editing } = input;
  const splitParams = splitParamsFor(state);
  const preview = previewShares({
    amount: state.amount,
    currency: state.currency,
    params: splitParams,
    participants: state.participants,
    seed: expenseId,
  });
  return {
    expenseId,
    // Blank stays blank — no word nobody typed goes into the ledger.
    description: state.description.trim(),
    category: state.category,
    categoryMeta: state.categoryMeta,
    expenseDate: state.expenseDate,
    currency: state.currency,
    amount: state.amount.toString(),
    fx: state.fx,
    splitParams,
    participants: state.participants,
    // Every payer, with anybody down for nothing left out.
    payers: serialisePayers(state.payers),
    paymentMethod: state.paymentMethod,
    location: state.location,
    notes: editing?.notes ?? undefined,
    receiptId: editing?.receipt_id ?? undefined,
    receiptShareUrl: editing?.receipt_share_url ?? undefined,
    expectedShares: preview
      ? Object.fromEntries([...preview].map(([id, share]) => [id, share.toString()]))
      : undefined,
    baseVersionNo: editing?.version_no ?? null,
  };
}

/**
 * The first reason this edit cannot be saved, or null when it can — the same
 * gate as the editor's Save button: a total, somebody to split with, a split
 * that adds up, and payers that add up to the total.
 */
export function editBlocker(
  state: ExpenseEditState,
  strings: EditIssueStrings & { saveNeedsAmount: string; saveNeedsWho: string },
  locale: string,
): string | null {
  if (state.amount <= 0n) return strings.saveNeedsAmount;
  if (state.participants.length === 0) return strings.saveNeedsWho;
  return splitIssueFor(state, strings, locale) ?? payerIssueFor(state, strings, locale);
}

/**
 * Whether a saved split can be changed one field at a time.
 *
 * Only the four kinds the editor has controls for. An itemized or adjusted
 * split has no editor of its own — the state above reopens it as equal — so a
 * pop-up changing the day of an itemized bill would quietly re-split it evenly
 * on save. Those bills stay read-only on the expense screen; the pencil is the
 * way in, as it always was.
 */
/**
 * Whether the amount alone can be changed in a pop-up. Not on an exact split
 * (the typed amounts would stop adding up) nor on a bill several people paid
 * (their figures would): the amount pop-up has no controls for either, so the
 * change belongs on the full editor.
 */
export function amountEditsInline(
  version: Pick<ExpenseVersionRow, 'split_type' | 'payers'>,
): boolean {
  return (
    canEditInline(version.split_type) &&
    version.split_type !== 'exact' &&
    version.payers.length <= 1
  );
}

export function canEditInline(splitType: SplitParams['kind']): boolean {
  return (
    splitType === 'equal' ||
    splitType === 'shares' ||
    splitType === 'percent' ||
    splitType === 'exact'
  );
}
