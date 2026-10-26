import {
  computeShares,
  parseSplitParams,
  serialiseSplitParams,
  toLedgerSnapshots,
  type CurrencyCode,
} from '@waves/core';
import type { ExpenseRow, ExpenseVersionRow } from '../data/types';
import type { ResplitItem } from '../data/api';

// A structural subset lets both full mirror rows and lean expense reads use the helper.
export type Expense = Pick<ExpenseRow, 'id' | 'group_id' | 'deleted_at' | 'created_at'> & {
  currentVersion:
    | (Pick<
        ExpenseVersionRow,
        | 'id'
        | 'version_no'
        | 'description'
        | 'category'
        | 'expense_date'
        | 'currency'
        | 'amount'
        | 'split_params'
        | 'payers'
        | 'shares'
        | 'fx'
      > & {
        split_type: string;
      })
    | null;
};

function toExpenseSnapshot(expense: Expense) {
  const v = expense.currentVersion;
  return v
    ? {
        id: expense.id,
        currency: v.currency as CurrencyCode,
        amount: BigInt(v.amount),
        payers: Object.fromEntries(v.payers.map((p) => [p.member_id, BigInt(p.amount)])),
        shares: Object.fromEntries(v.shares.map((p) => [p.member_id, BigInt(p.amount)])),
        date: v.expense_date,
        deletedAt: expense.deleted_at,
        fx: v.fx ?? null,
      }
    : null;
}

export interface Candidate {
  expense: Expense;
  memberShare: bigint;
  remainingParticipants: string[];
  perEach: bigint;
  noneRemaining: boolean;
  onlyViewerRemains: boolean;
}

/** Deleted expenses and zero shares never offer a change. Payers take precedence. */
export function classifyDepartedExpenses(
  expenses: readonly Expense[],
  memberId: string,
  viewerMemberId?: string,
): { equal: Candidate[]; custom: Candidate[]; paid: Expense[] } {
  const equal: Candidate[] = [];
  const custom: Candidate[] = [];
  const paid: Expense[] = [];
  for (const expense of expenses) {
    const version = expense.currentVersion;
    if (expense.deleted_at || !version) continue;
    if (version.payers.some((p) => p.member_id === memberId && BigInt(p.amount) > 0n)) {
      paid.push(expense);
      continue;
    }
    const shares = computed(expense);
    const memberShare = shares.get(memberId) ?? 0n;
    if (memberShare === 0n) continue;
    const remainingParticipants = [...shares]
      .filter(([id, amount]) => id !== memberId && amount > 0n)
      .map(([id]) => id);
    const noneRemaining = remainingParticipants.length === 0;
    const candidate: Candidate = {
      expense,
      memberShare,
      remainingParticipants,
      noneRemaining,
      perEach: noneRemaining ? 0n : memberShare / BigInt(remainingParticipants.length),
      onlyViewerRemains:
        remainingParticipants.length === 1 && remainingParticipants[0] === viewerMemberId,
    };
    (version.split_type === 'equal' && !noneRemaining ? equal : custom).push(candidate);
  }
  return { equal, custom, paid };
}

function computed(expense: Expense): Map<string, bigint> {
  const v = expense.currentVersion!;
  return computeShares({
    amount: BigInt(v.amount),
    currency: v.currency as CurrencyCode,
    params: parseSplitParams(v.split_params),
    participants: v.shares.map((s) => s.member_id),
    seed: expense.id,
  });
}

/** Keep produces no write. Custom shares retain their original amounts plus the rotated extra. */
export function buildResplitItem(
  candidate: Candidate,
  memberId: string,
  mode: 'keep' | 'equal' | 'share_equally' = 'equal',
): ResplitItem | null {
  if (mode === 'keep' || candidate.noneRemaining) return null;
  const { expense, remainingParticipants } = candidate;
  const v = expense.currentVersion!;
  const original = computed(expense);
  const equal = v.split_type === 'equal';
  const extra = computeShares({
    amount: equal ? BigInt(v.amount) : (original.get(memberId) ?? 0n),
    currency: v.currency as CurrencyCode,
    params: { kind: 'equal' },
    participants: remainingParticipants,
    seed: expense.id,
  });
  const amounts = Object.fromEntries(
    remainingParticipants
      .map((id): [string, bigint] => [
        id,
        (equal ? 0n : (original.get(id) ?? 0n)) + (extra.get(id) ?? 0n),
      ])
      .filter(([, amount]) => amount !== 0n),
  );
  return {
    expense_id: expense.id,
    base_version_no: v.version_no,
    split_type: equal ? 'equal' : 'exact',
    split_params: serialiseSplitParams(equal ? { kind: 'equal' } : { kind: 'exact', amounts }),
    shares: Object.entries(amounts).map(([member_id, amount]) => ({
      member_id,
      amount_minor: String(amount),
    })),
  };
}

/** The same stored-FX conversion as group balances; unrelated currencies never add together. */
export function summarizeDepartedExpenses(
  expenses: readonly Expense[],
  memberId: string,
  group?: { default_currency: string; convert_to_group_currency?: boolean } | null,
): { totals: Map<string, bigint>; count: number; currency: string; amount: bigint } {
  const totals = new Map<string, bigint>();
  let count = 0;
  for (const row of toLedgerSnapshots(expenses.map(toExpenseSnapshot), group)) {
    if (row.deletedAt) continue;
    const share = row.shares[memberId] ?? 0n;
    if (share <= 0n) continue;
    count += 1;
    totals.set(row.currency, (totals.get(row.currency) ?? 0n) + share);
  }
  const currency = group?.default_currency ?? totals.keys().next().value ?? 'INR';
  return { totals, count, currency, amount: totals.get(currency) ?? 0n };
}
