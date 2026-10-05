/**
 * Expense rows to {@link VendorCandidate}s, shared by the Vendors tab and the
 * Plan screen so the two read the same data the same way. A deposit with no
 * description is named by its sub-event, else its category (see
 * `vendorDisplayName`).
 */

import type { ExpenseRow } from '@/data/types';
import type { VendorCandidate } from '@/lib/eventVendors';

export function vendorCandidates(
  rows: readonly ExpenseRow[],
  labels: {
    /** "emoji Label" for a sub-event id. */
    subEvent: (id: string) => string;
    /** Display label for a built-in category id. */
    category: (id: string) => string | null;
  },
): VendorCandidate[] {
  return rows
    .filter((expense) => expense.currentVersion && !expense.deleted_at)
    .map((expense) => {
      const v = expense.currentVersion!;
      const lead = v.payers.reduce<{ id: string; amount: bigint } | null>((best, row) => {
        const amount = BigInt(row.amount);
        return best === null || amount > best.amount ? { id: row.member_id, amount } : best;
      }, null);
      const subEventId = v.sub_event_id ?? null;
      const categoryLabel =
        v.category_meta?.label ?? (v.category ? labels.category(v.category) : null);
      return {
        expenseId: expense.id,
        description: v.description,
        fallbackName: (subEventId ? labels.subEvent(subEventId) : null) || categoryLabel || null,
        currency: v.currency,
        amountMinor: BigInt(v.amount),
        isDeposit: v.is_deposit ?? false,
        balanceDueMinor: v.balance_due_minor == null ? null : BigInt(v.balance_due_minor),
        balanceDueDate: v.balance_due_date ?? null,
        subEventId,
        payerMemberId: lead?.id ?? null,
        expenseDate: v.expense_date,
      };
    });
}
