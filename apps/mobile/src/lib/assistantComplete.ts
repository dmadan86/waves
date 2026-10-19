/**
 * "Complete this expense": rebuilds the assistant's picture of a bill that
 * already exists, so the same follow-up questions can finish it later.
 *
 * A voice-added expense is asked about right after it is saved. One added any
 * other way (or one whose questions were skipped) can be completed from its
 * detail screen: the row appears when the place, the way it was paid or a
 * receipt is missing, and opens `VoiceFollowUps` over the saved facts.
 *
 * Pure: it only reads the version row it is given. The write it builds carries
 * every field the serialised expense carries (payee, receipt link, rate, tag),
 * because a write that leaves one out clears it. It deliberately leaves out
 * `baseVersionNo`: the follow-ups may write the same bill several times as
 * questions are answered, and a base that went stale after the first would be
 * logged as a conflict with ourselves.
 */

import type { SplitParams } from '@waves/core';

import type { ExpenseVersionRow } from '@/data/types';
import type { SavedState } from '@/lib/followUpApply';
import type { AgentExpenseWrite } from '@/lib/voiceAgentPlan';

export type CompleteGap = 'place' | 'payment' | 'receipt';

/** Whether the bill has a receipt kept in any of the ways one can be. */
export function rowHasReceipt(
  version: Pick<ExpenseVersionRow, 'receipt_id' | 'receipt_share_url'>,
  hasLegacyReceipt: boolean,
): boolean {
  return Boolean(version.receipt_id || version.receipt_share_url || hasLegacyReceipt);
}

/** What the assistant could still ask about, in the order it would. */
export function completeGaps(
  version: Pick<
    ExpenseVersionRow,
    'location' | 'payment_method' | 'receipt_id' | 'receipt_share_url'
  >,
  hasLegacyReceipt: boolean,
): CompleteGap[] {
  const gaps: CompleteGap[] = [];
  if (!version.location) gaps.push('place');
  if (!version.payment_method) gaps.push('payment');
  if (!rowHasReceipt(version, hasLegacyReceipt)) gaps.push('receipt');
  return gaps;
}

function sharesOf(version: Pick<ExpenseVersionRow, 'shares'>): string[] {
  return version.shares.filter((share) => BigInt(share.amount) > 0n).map((s) => s.member_id);
}

/** The state of a saved group expense, from its current version. */
export function savedStateFromRow(input: {
  groupId: string;
  expenseId: string;
  version: ExpenseVersionRow;
  hasLegacyReceipt: boolean;
}): SavedState {
  const { version } = input;
  return {
    kind: 'group',
    id: input.expenseId,
    groupId: input.groupId,
    description: version.description,
    amount: BigInt(version.amount),
    currency: version.currency,
    category: version.category,
    categoryStated: Boolean(version.category),
    date: version.expense_date,
    notes: version.notes,
    place: version.location?.name?.trim() || null,
    location: version.location,
    paymentMethod: version.payment_method,
    payers: Object.fromEntries(version.payers.map((p) => [p.member_id, BigInt(p.amount)])),
    hasReceipt: rowHasReceipt(version, input.hasLegacyReceipt),
    reimbursable: false,
    participants: sharesOf(version),
  };
}

/**
 * The group write that re-saves the bill as it is (an edit on top of the
 * current version), for the follow-up answers to change. The split is the
 * stored one, so nothing is re-divided.
 */
export function groupWriteFromRow(input: {
  expenseId: string;
  version: ExpenseVersionRow;
}): AgentExpenseWrite & {
  payee?: string | null;
  categoryMeta?: ExpenseVersionRow['category_meta'];
  receiptId?: string | null;
  receiptShareUrl?: string | null;
  fx?: ExpenseVersionRow['fx'];
} {
  const { version } = input;
  return {
    expenseId: input.expenseId,
    description: version.description,
    category: version.category,
    expenseDate: version.expense_date,
    currency: version.currency,
    amount: BigInt(version.amount),
    splitParams: version.split_params as SplitParams,
    participants: version.shares.map((s) => s.member_id),
    payers: Object.fromEntries(version.payers.map((p) => [p.member_id, BigInt(p.amount)])),
    expectedShares: Object.fromEntries(version.shares.map((s) => [s.member_id, BigInt(s.amount)])),
    payee: version.payee ?? undefined,
    categoryMeta: version.category_meta,
    receiptId: version.receipt_id ?? null,
    receiptShareUrl: version.receipt_share_url,
    fx: version.fx ?? null,
  };
}
