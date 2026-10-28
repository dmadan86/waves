import { COMPANY_EXPENSE_CATEGORIES } from '../company';

import { MutationKind, type MutationEnvelope } from './protocol';

/**
 * A refused "expense in a company group" has an obvious equivalent: the
 * author's company expense. This builds it, or returns null when it is not
 * obvious (several payers, another currency than the group's books, a payload
 * we cannot read) and the person has to look at it instead.
 *
 * The id is derived from the refused mutation's, so converting twice cannot
 * produce two entries.
 */
export function companyEntryFromRefusedExpense(
  refused: MutationEnvelope,
  groupCurrency: string | null,
): MutationEnvelope | null {
  if (refused.kind !== MutationKind.ExpenseCreate) return null;
  const p = refused.payload as {
    expenseId?: string;
    description?: string;
    category?: string | null;
    expenseDate?: string;
    currency?: string;
    amount?: string;
    payers?: Record<string, string>;
  } | null;
  const payers = Object.keys(p?.payers ?? {});
  if (
    !p?.expenseId ||
    !p.amount ||
    !p.expenseDate ||
    payers.length !== 1 ||
    !groupCurrency ||
    p.currency !== groupCurrency
  ) {
    return null;
  }
  const category = (COMPANY_EXPENSE_CATEGORIES as readonly string[]).includes(p.category ?? '')
    ? p.category
    : null;
  return {
    clientMutationId: `${refused.clientMutationId}:company`,
    kind: MutationKind.CompanyEntryCreate,
    groupId: refused.groupId,
    clientCreatedAt: refused.clientCreatedAt,
    payload: {
      entryId: p.expenseId,
      memberId: payers[0]!,
      entryKind: 'expense',
      data: {
        amount: p.amount,
        category,
        occurredOn: p.expenseDate.slice(0, 10),
        note: p.description?.slice(0, 200) || null,
      },
    },
  };
}
