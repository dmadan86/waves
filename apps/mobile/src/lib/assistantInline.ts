/**
 * The assistant's follow-ups and answers, done on the voice screen itself.
 *
 * The owner's rule: the voice flow stays on ONE screen. A follow-up that used to
 * push the add-expense, itemize, loans or settle screen now opens a sheet over
 * the panel, or expands inside the card, and writes through the same hooks those
 * screens use. This module is the pure half of that: the plans, the guards and
 * the small flows (with their writes passed in), so each can be tested without a
 * renderer. The sheets in `components/assistant/inline` are thin views over it.
 *
 * Three rules hold everywhere here:
 *   • a write that is already running is never started twice (`runOnce`);
 *   • a personal entry is deleted only AFTER the group save went through (D7),
 *     which is what `runMove` already does;
 *   • every write that changes where the money lives leaves an undo step.
 */

import {
  allocateSettlement,
  cleanCounterpart,
  computeShares,
  receiptToItemDraft,
  type ItemizedParams,
  type ExpenseSnapshot,
  type ParsedReceipt,
  type PersonalLoan,
  type PersonalTxn,
  type Receivable,
} from '@waves/core';

import { planMove, type MovePlan } from '@/lib/assistantCorrections';
import { toGroupWrite, type SavedState } from '@/lib/followUpApply';
import type { AgentExpenseWrite, AgentLocalData } from '@/lib/voiceAgentPlan';

/* ──────────────────────────────── no double writes ──────────────────────────────── */

/** A flag in a ref: true while a write started from a tap is still running. */
export interface Lock {
  current: boolean;
}

export type Once<T> = { readonly ran: false } | { readonly ran: true; readonly value: T };

/**
 * Run `fn` unless a run is already in flight. A second tap while the first
 * write is pending returns `{ ran: false }` and does nothing; the lock is
 * released when `fn` settles, whether it resolved or threw (the throw is passed
 * on, so the caller can show the failure and offer Retry).
 */
export async function runOnce<T>(lock: Lock, fn: () => Promise<T>): Promise<Once<T>> {
  if (lock.current) return { ran: false };
  lock.current = true;
  try {
    return { ran: true, value: await fn() };
  } finally {
    lock.current = false;
  }
}

/* ──────────────────────────────── a receipt, in place ──────────────────────────────── */

export type AttachResult = 'attached' | 'failed' | 'busy';

/**
 * Upload the picked photo to the expense it belongs to. The photo stays held by
 * the caller until this says `attached`, so a failure is retried with the very
 * same image rather than asking for another.
 */
export async function attachReceipt(
  lock: Lock,
  upload: () => Promise<unknown>,
): Promise<AttachResult> {
  try {
    const out = await runOnce(lock, upload);
    return out.ran ? 'attached' : 'busy';
  } catch {
    return 'failed';
  }
}

/* ──────────────────────────────── people and groups ──────────────────────────────── */

export interface PersonChoice {
  readonly id: string;
  readonly name: string;
  readonly isViewer: boolean;
}

/** The groups a sheet may offer: any group the viewer is in, the current one first. */
export function groupChoices(
  local: AgentLocalData,
  currentGroupId: string | null,
): { id: string; name: string }[] {
  return local.groups
    .filter((g) => g.members.some((m) => m.isViewer))
    .map((g) => ({ id: g.id, name: g.name }))
    .sort((a, b) => Number(b.id === currentGroupId) - Number(a.id === currentGroupId));
}

export function peopleIn(local: AgentLocalData, groupId: string): PersonChoice[] {
  const group = local.groups.find((g) => g.id === groupId);
  if (!group) return [];
  return group.members.map((m) => ({ id: m.id, name: m.name, isViewer: m.isViewer }));
}

/** Add or remove one person from a selection; you cannot drop yourself from a split you made (`lockSelf`). */
export function togglePerson(
  selected: readonly string[],
  id: string,
  people: readonly PersonChoice[],
  lockSelf = true,
): string[] {
  const mine = people.find((p) => p.isViewer)?.id;
  if (lockSelf && id === mine) return [...selected];
  return selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
}

/* ───────────────────────── split with / move to trip / who was there ───────────────────────── */

/**
 * The move to a group with these people: an equal split among them and you, you
 * paying. Null when the target is the same group, unknown or has no you in it.
 * The caller runs it with `runMove`, so the entry is deleted only after the
 * group save, and the move is a single undo step.
 */
export function planSplitMove(
  state: SavedState,
  local: AgentLocalData,
  groupId: string,
  memberIds: readonly string[],
  newId: string,
): MovePlan | null {
  return planMove(state, groupId, local, newId, memberIds);
}

/** Who was there, on a group expense that stays where it is: the new set, or null if nothing changes. */
export function planAttendance(state: SavedState, memberIds: readonly string[]): SavedState | null {
  const next = [...new Set(memberIds)];
  if (next.length === 0 || state.kind !== 'group') return null;
  const same =
    next.length === state.participants.length &&
    next.every((id) => state.participants.includes(id));
  return same ? null : { ...state, participants: next };
}

/* ───────────────────────────────────── split by item ───────────────────────────────────── */

export interface ItemizeLine {
  readonly label: string;
  readonly total: bigint;
}

export interface ItemizeDraft {
  readonly items: readonly ItemizeLine[];
  /** Tax, service and tip net of discounts: what the lines do not cover, prorated by what each person had. */
  readonly charges: bigint;
}

export type ItemizeStart =
  | { readonly ok: true; readonly draft: ItemizeDraft }
  | { readonly ok: false; readonly reason: 'noItems' | 'mismatch' };

/**
 * The lines of a scanned bill for a saved total. The expense keeps the total the
 * person said; whatever the lines do not cover becomes tax, and a bill whose lines
 * add up to MORE than the total cannot be split by item.
 */
export function itemizeDraftFor(parsed: ParsedReceipt, amount: bigint): ItemizeStart {
  const draft = receiptToItemDraft(parsed);
  if (draft.items.length === 0) return { ok: false, reason: 'noItems' };
  const lines = draft.items.reduce((sum, item) => sum + item.total, 0n);
  const charges = amount - lines;
  if (charges < 0n) return { ok: false, reason: 'mismatch' };
  return {
    ok: true,
    draft: { items: draft.items.map((i) => ({ label: i.label, total: i.total })), charges },
  };
}

/** line index -> the people who had it. */
export type Claims = Readonly<Record<number, readonly string[]>>;

export function toggleClaim(claims: Claims, line: number, id: string): Claims {
  const now = claims[line] ?? [];
  return {
    ...claims,
    [line]: now.includes(id) ? now.filter((c) => c !== id) : [...now, id],
  };
}

export function unclaimedCount(draft: ItemizeDraft, claims: Claims): number {
  return draft.items.filter((_, index) => (claims[index] ?? []).length === 0).length;
}

function itemizedParams(draft: ItemizeDraft, claims: Claims): ItemizedParams {
  return {
    kind: 'itemized',
    items: draft.items.map((i) => ({ label: i.label, total: i.total })),
    claims,
    taxes: draft.charges,
  };
}

export function claimants(claims: Claims, draft: ItemizeDraft): string[] {
  return [...new Set(draft.items.flatMap((_, index) => claims[index] ?? []))];
}

/**
 * Live totals: what each person owes, as the ledger's own split would write it.
 * Null while a line is unclaimed (nothing to total yet) or the maths cannot run.
 */
export function itemizeTotals(
  draft: ItemizeDraft,
  claims: Claims,
  amount: bigint,
  currency: string,
  seed: string,
): Map<string, bigint> | null {
  if (unclaimedCount(draft, claims) > 0) return null;
  const participants = claimants(claims, draft);
  if (participants.length === 0) return null;
  try {
    return computeShares({
      amount,
      currency,
      params: itemizedParams(draft, claims),
      participants,
      seed,
    });
  } catch {
    return null;
  }
}

/**
 * Replace the voice-saved group expense with the itemised one: the same group, a
 * new expense that carries the bill, and (through `runMove`) the old one removed
 * only after the new one is written. Null when a line is unclaimed or you are not
 * in the group.
 */
export function planItemize(
  state: SavedState,
  draft: ItemizeDraft,
  claims: Claims,
  local: AgentLocalData,
  receiptId: string,
  newId: string,
): (MovePlan & { kind: 'toGroup' }) | null {
  if (state.kind !== 'group' || !state.groupId) return null;
  const group = local.groups.find((g) => g.id === state.groupId);
  const me = group?.members.find((m) => m.isViewer);
  if (!group || !me) return null;
  const shares = itemizeTotals(draft, claims, state.amount, state.currency, newId);
  if (!shares) return null;
  const participants = claimants(claims, draft);
  const payers = state.payers ? { ...state.payers } : { [me.id]: state.amount };
  const base: AgentExpenseWrite = {
    expenseId: newId,
    description: state.description,
    category: state.category,
    expenseDate: state.date,
    currency: state.currency,
    amount: state.amount,
    splitParams: itemizedParams(draft, claims),
    participants,
    payers,
    expectedShares: Object.fromEntries(shares),
  };
  const next: SavedState = { ...state, id: newId, participants, payers, hasReceipt: true };
  const write = { ...toGroupWrite(base, next), receiptId };
  return { kind: 'toGroup', groupId: state.groupId, write, next };
}

/* ───────────────────────────────────── share a loan ───────────────────────────────────── */

/** The loan the lend answer just wrote, in the shape the share write wants. */
export function lentLoan(input: {
  id: string;
  person: string;
  saved: Pick<SavedState, 'amount' | 'currency' | 'date'>;
}): PersonalLoan {
  return {
    id: input.id,
    direction: 'lent',
    counterpart: cleanCounterpart(input.person),
    principal: input.saved.amount,
    currency: input.saved.currency as PersonalLoan['currency'],
    note: null,
    startDate: input.saved.date,
    status: 'active',
  };
}

export type ShareOutcome = 'shared' | 'failed' | 'busy';

/** Share the loan; a failure keeps the loan and can be retried with the same call. */
export async function shareLoanInline(
  lock: Lock,
  share: () => Promise<unknown>,
): Promise<ShareOutcome> {
  try {
    const out = await runOnce(lock, share);
    return out.ran ? 'shared' : 'busy';
  } catch {
    return 'failed';
  }
}

/* ───────────────────────────────────── settle up ───────────────────────────────────── */

/** What `payer` still owes `payee` in `currency`, bill by bill (the payment is applied oldest first). */
export function receivablesFor(
  snapshots: readonly ExpenseSnapshot[],
  fromId: string,
  toId: string,
  currency: string,
): Receivable[] {
  return snapshots
    .filter((s) => !s.deletedAt && s.currency === currency)
    .map((s) => {
      const owes = BigInt(s.shares[fromId] ?? 0n);
      const paidByOther = BigInt(s.payers[toId] ?? 0n);
      const portion = owes > 0n && paidByOther > 0n ? (owes * paidByOther) / s.amount : 0n;
      return { expenseId: s.id, date: s.date, amount: portion };
    })
    .filter((r) => r.amount > 0n);
}

export interface SettlementWrite {
  readonly groupId: string;
  readonly fromMemberId: string;
  readonly toMemberId: string;
  readonly amount: bigint;
  readonly rail: string;
  readonly currency: string;
  readonly allocations: ReturnType<typeof allocateSettlement>['allocations'];
}

/** The write for one transfer of the plan, exactly as the Settle up screen records it. */
export function settlementFor(
  groupId: string,
  transfer: { from: string; to: string; currency: string; amount: bigint },
  receivables: readonly Receivable[],
  rail: string,
): SettlementWrite | null {
  if (transfer.amount <= 0n) return null;
  const allocation =
    receivables.length > 0
      ? allocateSettlement({ amount: transfer.amount }, receivables)
      : { allocations: [], unallocated: transfer.amount };
  return {
    groupId,
    fromMemberId: transfer.from,
    toMemberId: transfer.to,
    amount: transfer.amount,
    rail,
    currency: transfer.currency,
    allocations: allocation.allocations,
  };
}

export type RecordOutcome = 'recorded' | 'failed' | 'busy';

export async function recordInline(
  lock: Lock,
  record: () => Promise<unknown>,
): Promise<RecordOutcome> {
  try {
    const out = await runOnce(lock, record);
    return out.ran ? 'recorded' : 'busy';
  } catch {
    return 'failed';
  }
}

/* ───────────────────────────────── "Show in Spending", inline ───────────────────────────────── */

/** Rows shown before "Show all". */
export const MATCH_PREVIEW = 5;

export interface MatchQuery {
  readonly kind?: string;
  readonly from?: string;
  readonly to?: string;
  readonly category?: string;
}

/**
 * The personal entries a "Show in Spending" link would have opened: the same
 * filter the Spending screen applies to the link's params (kind, date range,
 * category), newest first.
 */
export function matchingTransactions(
  txns: readonly PersonalTxn[],
  query: MatchQuery,
): PersonalTxn[] {
  return txns
    .filter(
      (txn) =>
        (!query.kind || txn.kind === query.kind) &&
        (!query.from || txn.date >= query.from) &&
        (!query.to || txn.date <= query.to) &&
        (!query.category || txn.category === query.category),
    )
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}

export function visibleMatches<T>(rows: readonly T[], showAll: boolean): T[] {
  return showAll ? [...rows] : rows.slice(0, MATCH_PREVIEW);
}
