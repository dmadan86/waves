/**
 * The edit form for a repeating group expense, as plain data.
 *
 * The form is the expense form's own pieces (the split chips, the participant
 * list, the amount field) driven by the same `ExpenseEditState` an expense edit
 * uses. These two functions are the seam: a rule becomes that state to open the
 * form, and the state (plus the schedule) becomes the template the core
 * validates and diffs into a patch. Kept free of React so it is tested as data.
 */

import { rescalePayers, type GroupRecurringRule, type GroupRecurringTemplate } from '@waves/core';

import type { ExpenseVersionRow } from '@/data/types';
import { editStateFromVersion, splitParamsFor, type ExpenseEditState } from '@/lib/expenseEdit';

/** Splits the form has controls for. An adjusted or itemised split has none, so
 *  the form keeps the saved one rather than quietly turning it into an equal one. */
export function splitIsEditable(rule: Pick<GroupRecurringRule, 'splitParams'>): boolean {
  const kind = rule.splitParams.kind;
  return kind === 'equal' || kind === 'shares' || kind === 'percent' || kind === 'exact';
}

/** The expense form's state for a rule. */
export function editStateFromRule(rule: GroupRecurringRule): ExpenseEditState {
  // The rule has the same facts a saved version does; only the fields the form
  // never reads are left empty.
  const version = {
    id: rule.id,
    version_no: 1,
    description: rule.description,
    category: rule.category,
    category_meta: null,
    expense_date: rule.nextDate,
    currency: rule.currency,
    amount: rule.amount.toString(),
    split_type: rule.splitParams.kind,
    split_params: rule.splitParams,
    author_member_id: rule.createdBy,
    notes: rule.notes,
    payment_method: null,
    receipt_share_url: null,
    location: null,
    fx: null,
    payers: Object.entries(rule.payers).map(([member_id, amount]) => ({
      member_id,
      amount: amount.toString(),
    })),
    shares: rule.participants.map((member_id) => ({ member_id, amount: '0' })),
  } as unknown as ExpenseVersionRow;
  return editStateFromVersion(version, rule.createdBy);
}

/**
 * The template the form describes. Several payers keep their proportions when the
 * amount moves; one payer follows it. An uneditable split is kept as saved.
 */
export function templateFromState(
  state: ExpenseEditState,
  rule: GroupRecurringRule,
  notes: string,
): GroupRecurringTemplate {
  const payers = Object.fromEntries(state.payers);
  return {
    description: state.description,
    category: state.category,
    currency: rule.currency,
    amount: state.amount,
    splitParams: splitIsEditable(rule) ? splitParamsFor(state) : rule.splitParams,
    participants: state.participants,
    payers:
      state.amount !== rule.amount && state.payers.size > 1
        ? rescalePayers(payers, state.amount)
        : payers,
    notes,
  };
}
