/**
 * Where a capture goes when it is assigned to a group: the add-expense form,
 * prefilled from the capture and carrying its id so saving there closes the
 * capture (useAssignCapture) rather than leaving a duplicate behind.
 *
 * One place builds this href so the three callers that assign — the inbox's
 * group picker, the "New group" flow that creates a group then drops the
 * capture into it, and the capture screen's own group row (picking a real
 * group there now means "finish this as a group expense", not merely tagging
 * a destination) — hand the form exactly the same params. The caller chooses
 * how to navigate: the inbox picker and the capture screen push (back returns
 * to where they were), the new-group flow replaces (back must not return to
 * the half-made group screen).
 */

import type { CategoryMeta, ExpenseLocation, PaymentMethod } from '@waves/core';

/**
 * The fields the hand-off needs, independent of whether they live on a row the
 * server has already seen. A saved `CaptureRow` satisfies this shape as-is
 * (structural typing, and it is what the inbox and "New group" flows already
 * pass); `captureDraftFields` below builds the same shape from a capture that
 * is still being typed and has never been saved at all — the capture screen's
 * own hand-off, which fires before Save, not after.
 */
export interface CaptureAssignFields {
  id: string;
  description: string;
  amount: string;
  category: string | null;
  category_meta: CategoryMeta | null;
  location: ExpenseLocation | null;
  payment_method: string | null;
  expense_date: string;
}

/** The methods the ledger knows (`PaymentMethod`), as a runtime guard. */
const PAYMENT_METHODS: readonly string[] = ['cash', 'upi', 'credit', 'debit', 'forex'];

/**
 * How a draft says it was paid, as the expense form's own value.
 *
 * A capture stores this as free text from an older build's picker, so it is
 * narrowed here rather than cast: anything the ledger does not know falls back
 * to the form's default. One place answers it, because both routes out of the
 * inbox — the form and the batch write — must agree, or the same draft would
 * become a different expense depending on which one a person took.
 */
export function capturePaymentMethod(value: string | null | undefined): PaymentMethod {
  return PAYMENT_METHODS.includes(value ?? '') ? (value as PaymentMethod) : 'cash';
}

function fold(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase();
}

export function matchesAssignGroupQuery(label: string, query: string): boolean {
  const needle = fold(query.trim());
  return !needle || fold(label).includes(needle);
}

export function assignCaptureHref(capture: CaptureAssignFields, groupId: string) {
  return {
    pathname: '/group/[id]/add-expense' as const,
    params: {
      id: groupId,
      captureId: capture.id,
      description: capture.description,
      // The amount travels as the same minor-unit string the row stores.
      amount: capture.amount,
      category: capture.category ?? '',
      // A custom tag rides along as JSON so the assigned expense keeps it,
      // rather than dropping to a built-in (extends TDR §8).
      ...(capture.category_meta ? { categoryMeta: JSON.stringify(capture.category_meta) } : {}),
      // The place the capture recorded, so the assigned expense keeps it (A43).
      ...(capture.location ? { location: JSON.stringify(capture.location) } : {}),
      // How the draft says it was paid. It used not to travel at all, so a
      // draft recorded as "credit card" became a cash expense the moment it was
      // assigned — a field the person had filled in, dropped in the handoff.
      ...(capture.payment_method
        ? { paymentMethod: capturePaymentMethod(capture.payment_method) }
        : {}),
      expenseDate: capture.expense_date,
    },
  };
}

/**
 * A capture still being typed, as the shape `assignCaptureHref` needs.
 *
 * The capture screen mints its `captureId` up front (before anything is
 * saved, so a photo can be uploaded under it) whether this is a brand-new
 * draft or an existing one being edited. Handing off on that id before Save
 * is pressed is safe either way: on a fresh draft no capture row exists yet,
 * so the `capture.assign` the add-expense form fires on save matches nothing
 * server-side and is a silent no-op (the sync edge function's assign only
 * flips a row that is there); on an existing draft the id is real, so the
 * same assign closes it exactly as the inbox's own picker would.
 */
export function captureDraftFields(draft: {
  captureId: string;
  description: string;
  amount: bigint;
  category: string | null;
  categoryMeta: CategoryMeta | null;
  location: ExpenseLocation | null;
  paymentMethod: PaymentMethod | null;
  date: string;
}): CaptureAssignFields {
  return {
    id: draft.captureId,
    description: draft.description.trim(),
    amount: draft.amount.toString(),
    category: draft.category,
    category_meta: draft.categoryMeta,
    location: draft.location,
    payment_method: draft.paymentMethod,
    expense_date: draft.date,
  };
}
