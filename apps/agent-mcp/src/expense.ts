/**
 * The expense-write payload the MCP server sends to the same edge function the
 * app uses. Kept pure so the assistant-facing tool contract can be tested
 * without a Supabase project or an MCP transport.
 */

export type AgentSplit =
  | { readonly kind: 'equal' }
  | { readonly kind: 'exact'; readonly amounts: Record<string, string> }
  | { readonly kind: 'shares'; readonly weights: Record<string, number> };

export interface AgentExpenseInput {
  readonly groupId: string;
  readonly description: string;
  readonly amount: string;
  readonly currency?: string;
  readonly paidBy: string;
  readonly participants: readonly string[];
  readonly split?: AgentSplit;
  readonly expenseDate?: string;
  readonly category?: string;
  readonly notes?: string;
}

export interface ExpenseWriteDefaults {
  readonly expenseId: string;
  readonly clientMutationId: string;
  readonly today: string;
  readonly groupCurrency: string;
}

export interface ExpenseWriteBody {
  readonly groupId: string;
  readonly expenseId: string;
  readonly description: string;
  readonly category: string | null;
  readonly expenseDate: string;
  readonly currency: string;
  readonly amount: string;
  readonly splitParams: AgentSplit;
  readonly participants: readonly string[];
  readonly payers: Record<string, string>;
  readonly notes: string | null;
  readonly paymentMethod: null;
  readonly receiptShareUrl: null;
  readonly fx: null;
  readonly clientMutationId: string;
}

export function splitParamsFor(split: AgentSplit | undefined): AgentSplit {
  if (!split || split.kind === 'equal') return { kind: 'equal' };
  if (split.kind === 'exact') return { kind: 'exact', amounts: split.amounts };
  return { kind: 'shares', weights: split.weights };
}

export function buildExpenseWriteBody(
  input: AgentExpenseInput,
  defaults: ExpenseWriteDefaults,
): ExpenseWriteBody {
  return {
    groupId: input.groupId,
    expenseId: defaults.expenseId,
    description: input.description,
    category: input.category ?? null,
    expenseDate: input.expenseDate ?? defaults.today,
    currency: (input.currency ?? defaults.groupCurrency).toUpperCase(),
    amount: input.amount,
    splitParams: splitParamsFor(input.split),
    participants: input.participants,
    payers: { [input.paidBy]: input.amount },
    // expectedShares omitted on purpose: the edge function is the source
    // of truth for the split, and sending nothing lets it compute freely.
    notes: input.notes ?? null,
    paymentMethod: null,
    receiptShareUrl: null,
    fx: null,
    clientMutationId: defaults.clientMutationId,
  };
}

/**
 * Everyone an expense is split between, with the payer always among them.
 *
 * Told "split it with Raj and Priya", a request names two people and means
 * three. Leaving the payer out of their own expense does not produce a smaller
 * split — it produces one where they lent the entire bill and are owed all of
 * it, which is a wrong number in a shared ledger rather than a missing one.
 *
 * Duplicates collapse: the same person named twice, or named and also passed as
 * a member id, is one participant. `computeShares` refuses a repeated member
 * outright (DUPLICATE_PARTICIPANT), so this is what keeps an ordinary way of
 * speaking from becoming an error.
 */
export function expenseParticipants(
  paidBy: string,
  memberIds: readonly string[],
): readonly string[] {
  const party = new Set(memberIds);
  party.add(paidBy);
  return [...party];
}
