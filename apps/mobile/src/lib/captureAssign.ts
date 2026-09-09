/**
 * Where a capture goes when it is assigned to a group: the add-expense form,
 * prefilled from the capture and carrying its id so saving there closes the
 * capture (useAssignCapture) rather than leaving a duplicate behind.
 *
 * One place builds this href so the two callers that assign — the inbox's group
 * picker and the "New group" flow that creates a group then drops the capture
 * into it — hand the form exactly the same params. The caller chooses how to
 * navigate: the picker pushes (back returns to the inbox), the new-group flow
 * replaces (back must not return to the half-made group screen).
 */

import type { PaymentMethod } from '@waves/core';

import { type CaptureRow } from '@/data/types';

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

export function assignCaptureHref(capture: CaptureRow, groupId: string) {
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
