/**
 * Pure rules for "Split with friends…": turning a saved Personal expense into one
 * group expense (same amount, currency, date, note, category; equal split, the
 * viewer paid) and finishing the move by deleting the Personal original through
 * the normal synced delete once the server has accepted the group expense.
 */

import { computeShares, isPoolGroup, type SplitParams } from '@waves/core';

import { serialiseExpense } from '@/data/serialiseExpense';
import { isViewer, type GroupRow } from '@/data/types';
import type { PendingMove } from '@/lib/pendingMoves';
import { canMoveInto } from '@/lib/voiceSpace';

export interface MoveEntry {
  readonly id: string;
  readonly amount: bigint;
  readonly currency: string;
  readonly date: string;
  readonly note: string | null;
  readonly category: string | null;
  /** The Personal bill photo's key, carried to the group expense. */
  readonly receiptKey?: string | null;
}

export interface MemberLite {
  readonly id: string;
  readonly group_id: string;
  readonly profile_id: string | null;
  readonly role?: string | null;
  readonly left_at?: string | null;
}

export interface MoveParties {
  payerId: string;
  participantIds: string[];
}

const EQUAL: SplitParams = { kind: 'equal' };

/** Groups the entry can be added to: the viewer is in, may add, and the currency fits. */
export function movableGroups<G extends GroupRow>(
  groups: readonly G[],
  members: readonly MemberLite[],
  viewerId: string | null,
  currency: string,
): G[] {
  return groups.filter((group) => {
    if (group.archived_at || group.type === 'company') return false;
    const me = members.find((m) => m.group_id === group.id && !m.left_at && isViewer(m, viewerId));
    return canMoveInto(group, me?.role ?? null, currency);
  });
}

/**
 * Who pays and who shares in an existing group: the viewer pays, everyone still
 * in it shares equally (a pooled household has nobody owing anybody, so only the
 * viewer). Null when the viewer is not an active member.
 */
export function partiesFor(
  group: { id: string; ledger_mode?: string | null },
  members: readonly MemberLite[],
  viewerId: string | null,
): MoveParties | null {
  const live = members.filter((m) => m.group_id === group.id && !m.left_at);
  const me = live.find((m) => isViewer(m, viewerId));
  if (!me) return null;
  if (isPoolGroup(group)) return { payerId: me.id, participantIds: [me.id] };
  return {
    payerId: me.id,
    participantIds: [me.id, ...live.filter((m) => m !== me).map((m) => m.id)],
  };
}

/** The ExpenseCreate payload: the entry's own facts, split equally, the payer covering all of it. */
export function personalMoveWrite(
  entry: MoveEntry,
  parties: MoveParties,
  expenseId: string,
): Record<string, unknown> {
  const shares = computeShares({
    amount: entry.amount,
    currency: entry.currency,
    params: EQUAL,
    participants: parties.participantIds,
    seed: expenseId,
  });
  return {
    ...serialiseExpense({
      description: entry.note ?? '',
      category: entry.category,
      expenseDate: entry.date,
      currency: entry.currency,
      amount: entry.amount,
      splitParams: EQUAL,
      participants: parties.participantIds,
      payers: { [parties.payerId]: entry.amount },
      expectedShares: Object.fromEntries(shares),
    }),
    expenseId,
  };
}

/**
 * What the cleanup tracks so the Personal original is deleted (synced) only after
 * the group expense is accepted, and its bill photo is carried across first.
 */
export function pendingMoveFor(
  cmid: string,
  entry: MoveEntry,
  groupId: string,
  expenseId: string,
): PendingMove {
  return {
    cmid,
    personalId: entry.id,
    ...(entry.receiptKey ? { receiptKey: entry.receiptKey, groupId, expenseId } : {}),
  };
}

/**
 * Friends the entry can be split with 1:1: the other person in each 1:1 space that is offered as a
 * target. Read from the spaces themselves, not from balances, so a friend you also share a trip
 * with (balance spread over two groups) or are square with is still here.
 */
export function friendChoices(
  signatures: readonly { groupId: string; names: readonly string[] }[],
  oneToOne: ReadonlySet<string>,
  allowed?: ReadonlySet<string>,
): { personKey: string; name: string; groupId: string }[] {
  return signatures
    .filter(
      (sig) =>
        oneToOne.has(sig.groupId) &&
        sig.names.length === 1 &&
        (!allowed || allowed.has(sig.groupId)),
    )
    .map((sig) => ({ personKey: sig.groupId, name: sig.names[0]!, groupId: sig.groupId }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
