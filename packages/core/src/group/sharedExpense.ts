/**
 * Whether a group takes ordinary shared expenses, settlements and recurring
 * rules. A company group does not: the server refuses them (trigger
 * `company_expense_guard`), its money lives in company entries. Every picker
 * that can write one of those asks here, so the app never sends what the
 * server would refuse.
 */
export interface SharedExpenseTarget {
  readonly type?: string | null;
  readonly archived_at?: string | null;
}

export function canAddSharedExpense(group: SharedExpenseTarget | null | undefined): boolean {
  return !!group && group.type !== 'company' && !group.archived_at;
}
