import {
  computeShares,
  pairwiseForExpense,
  parseSplitParams,
  serialiseSplitParams,
  toLedgerSnapshots,
  type CurrencyCode,
  type SplitParams,
  fallbackCurrency,
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

/** Everyone who has left or been removed, so none of them is offered a share. */
export const departedIds = (members: readonly { id: string; left_at?: string | null }[] = []) =>
  new Set(members.filter((m) => m.left_at).map((m) => m.id));

/** Own comment, an admin, or anyone still in the group when the author has left (matches waves_delete_expense_comment). */
export const canDeleteComment = (mine: boolean, iAmAdmin: boolean, authorGone: boolean) =>
  mine || iAmAdmin || authorGone;

/** Deleted expenses and zero shares never offer a change. Payers take precedence. */
export function classifyDepartedExpenses(
  expenses: readonly Expense[],
  memberId: string,
  viewerMemberId?: string,
  // Everyone else who has left or been removed: they can never receive a share.
  gone: ReadonlySet<string> = new Set(),
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
      .filter(([id, amount]) => id !== memberId && !gone.has(id) && amount > 0n)
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

export type ResplitMode = 'keep' | 'share_equally' | 'proportional' | 'equal';
export const RESPLIT_MODES: readonly ResplitMode[] = [
  'keep',
  'share_equally',
  'proportional',
  'equal',
];

/**
 * keep: no write. share_equally: only their part, equally among the rest.
 * proportional: their part follows the rest's existing ratio; percent and shares
 * bills stay percent and shares. equal: the whole bill equally among the rest.
 * All amounts come from computeShares, so they always add up to the bill.
 */
export function buildResplitItem(
  candidate: Candidate,
  memberId: string,
  mode: ResplitMode = 'share_equally',
): ResplitItem | null {
  if (mode === 'keep' || candidate.noneRemaining) return null;
  const { expense, remainingParticipants } = candidate;
  const v = expense.currentVersion!;
  const original = computed(expense);
  const base = {
    amount: BigInt(v.amount),
    currency: v.currency as CurrencyCode,
    participants: remainingParticipants,
    seed: expense.id,
  };
  const params = parseSplitParams(v.split_params);
  let next: SplitParams;
  let amounts: Map<string, bigint>;
  if (v.split_type === 'equal' || mode === 'equal') {
    next = { kind: 'equal' };
    amounts = computeShares({ ...base, params: next });
  } else if (mode === 'share_equally') {
    const extra = computeShares({
      ...base,
      amount: original.get(memberId) ?? 0n,
      params: { kind: 'equal' },
    });
    amounts = new Map(
      remainingParticipants.map((id) => [id, (original.get(id) ?? 0n) + (extra.get(id) ?? 0n)]),
    );
    next = { kind: 'exact', amounts: Object.fromEntries(amounts) };
  } else {
    const weights = (from: Readonly<Record<string, number | bigint>>) =>
      Object.fromEntries(remainingParticipants.map((id) => [id, Number(from[id] ?? 0)]));
    if (params.kind === 'percent') {
      const bp = computeShares({
        ...base,
        amount: 10000n,
        params: { kind: 'shares', weights: weights(params.basisPoints) },
      });
      next = {
        kind: 'percent',
        basisPoints: Object.fromEntries([...bp].map(([id, n]) => [id, Number(n)])),
      };
    } else if (params.kind === 'shares') {
      next = { kind: 'shares', weights: weights(params.weights) };
    } else {
      next = { kind: 'shares', weights: weights(Object.fromEntries(original)) };
    }
    amounts = computeShares({ ...base, params: next });
    // Anything but percent or shares was a fixed amount, and stays one.
    if (next.kind === 'shares' && params.kind !== 'shares')
      next = { kind: 'exact', amounts: Object.fromEntries(amounts) };
  }
  const kept = [...amounts].filter(([, amount]) => amount !== 0n);
  return {
    expense_id: expense.id,
    base_version_no: v.version_no,
    split_type: next.kind as ResplitItem['split_type'],
    split_params: serialiseSplitParams(next),
    shares: kept.map(([member_id, amount]) => ({ member_id, amount_minor: String(amount) })),
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
  const currency = group?.default_currency ?? totals.keys().next().value ?? fallbackCurrency();
  return { totals, count, currency, amount: totals.get(currency) ?? 0n };
}

export type DepartedSort = 'newest' | 'oldest' | 'amount';

export function selectedDepartedCandidates(
  candidates: readonly Candidate[],
  ids: ReadonlySet<string>,
) {
  return candidates.filter(
    (candidate) => !candidate.noneRemaining && ids.has(candidate.expense.id),
  );
}

export function departedCategoryCounts(expenses: readonly Expense[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const expense of expenses) {
    if (expense.deleted_at || !expense.currentVersion) continue;
    const category = expense.currentVersion.category ?? 'other';
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return counts;
}

export function sortDepartedExpenses(expenses: readonly Expense[], sort: DepartedSort): Expense[] {
  return expenses
    .filter((expense) => !expense.deleted_at && expense.currentVersion)
    .sort((a, b) => {
      const av = a.currentVersion!;
      const bv = b.currentVersion!;
      if (sort === 'amount') {
        // Amounts in unrelated currencies cannot be compared.
        const currency = av.currency.localeCompare(bv.currency);
        if (currency) return currency;
        const aa = BigInt(av.amount);
        const ba = BigInt(bv.amount);
        if (aa !== ba) return aa > ba ? -1 : 1;
      }
      return (
        (sort === 'oldest' ? 1 : -1) * av.expense_date.localeCompare(bv.expense_date) ||
        a.id.localeCompare(b.id)
      );
    });
}

/** Gross pair directions across these bills, before settlements; currencies follow group FX. */
export function departedPairSummary(
  expenses: readonly Expense[],
  memberId: string,
  viewerId: string,
  group?: { default_currency: string; convert_to_group_currency?: boolean } | null,
) {
  const lent = { totals: new Map<string, bigint>(), count: 0 };
  const owe = { totals: new Map<string, bigint>(), count: 0 };
  const net = new Map<string, bigint>();
  for (const row of toLedgerSnapshots(expenses.map(toExpenseSnapshot), group)) {
    if (row.deletedAt) continue;
    const debt = (row.shares[memberId] ?? 0n) - (row.payers[memberId] ?? 0n);
    net.set(row.currency, (net.get(row.currency) ?? 0n) + debt);
    for (const edge of pairwiseForExpense(row)) {
      const side =
        edge.from === memberId && edge.to === viewerId
          ? lent
          : edge.from === viewerId && edge.to === memberId
            ? owe
            : null;
      if (!side) continue;
      side.totals.set(row.currency, (side.totals.get(row.currency) ?? 0n) + edge.amount);
      side.count += 1;
    }
  }
  return { lent, owe, net };
}

/**
 * What this person still owes (positive) or is owed (negative) per currency, from
 * the ledger's own settlement-aware balances: the same figure the Balances tab
 * shows, not the gross of the bills listed here.
 */
export function departedOpenBalance(
  net: ReadonlyMap<string, ReadonlyMap<string, bigint>>,
  memberId: string,
): Map<string, bigint> {
  const open = new Map<string, bigint>();
  for (const [currency, perMember] of net) {
    const balance = perMember.get(memberId) ?? 0n;
    if (balance !== 0n) open.set(currency, -balance);
  }
  return open;
}

export function departedExpenseTotals(
  expenses: readonly Expense[],
  group?: { default_currency: string; convert_to_group_currency?: boolean } | null,
): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const row of toLedgerSnapshots(expenses.map(toExpenseSnapshot), group)) {
    if (row.deletedAt) continue;
    totals.set(row.currency, (totals.get(row.currency) ?? 0n) + row.amount);
  }
  return totals;
}
