import { BalanceDirection, balanceDirection } from '@waves/core';

import type { PersonDebts } from './debtsByPerson';
import type { PlanTransfer } from './settlePlan';

/** Amount order comes from the ledger's currency-aware grouping; never sum currencies. */
export function sortPeopleDebts(
  people: readonly PersonDebts[],
  sort: 'amount' | 'amountLow' | 'name',
  nameOf: (id: string) => string,
  locale: string,
): PersonDebts[] {
  if (sort === 'amount') return [...people];
  // Low-first is the same grouped order read backwards.
  if (sort === 'amountLow') return [...people].reverse();
  return [...people].sort((a, b) => nameOf(a.memberId).localeCompare(nameOf(b.memberId), locale));
}

export function filterOtherTransfers(
  transfers: readonly PlanTransfer[],
  memberId: string | null,
): PlanTransfer[] {
  return transfers.filter(
    (transfer) => !memberId || transfer.from === memberId || transfer.to === memberId,
  );
}

export function memberBalanceStatus(balance: bigint, viewer: boolean, owesViewer: boolean) {
  if (balance === 0n) return 'balanceSettled' as const;
  if (balance > 0n) return 'balanceIsOwed' as const;
  return owesViewer && !viewer ? ('balanceOwesYou' as const) : ('balanceOwes' as const);
}

/**
 * Which way a member's balance runs for the person looking. A member's balance
 * is theirs (positive = they are owed), but `BalanceDirection` is the viewer's
 * ("owed to you"), so another person's row is read flipped.
 */
export function directionForViewer(balance: bigint, isViewerRow: boolean): BalanceDirection {
  return balanceDirection(isViewerRow ? balance : -balance);
}

/**
 * The words beside a member's balance. Your own row speaks to you ("you are owed"
 * / "you owe"); somebody else's says what is true of them ("is owed" / "owes"),
 * because their balance is with the whole group, not necessarily with you, so
 * "you owe" on their row would claim a debt that may not exist.
 */
export function balanceWord(
  balance: bigint,
  isViewerRow: boolean,
  words: {
    youAreOwed: string;
    youOwe: string;
    isOwed: string;
    owes: string;
    allSquare: string;
  },
): string {
  if (balance === 0n) return words.allSquare;
  if (isViewerRow) return balance > 0n ? words.youAreOwed : words.youOwe;
  return balance > 0n ? words.isOwed : words.owes;
}

/**
 * What a screen reader says for a balance row. Your own row speaks to you
 * (`own`, the viewer-direction sentence); somebody else's says what is true of
 * them ("Ravi is owed ₹300"), never "you owe", because their balance is with the
 * whole group, not necessarily with the viewer.
 */
export function spokenRowBalance(
  balance: bigint,
  isViewerRow: boolean,
  name: string,
  amountText: string,
  words: { own: string; isOwed: string; owes: string; square: string },
): string {
  if (isViewerRow) return words.own;
  const fill = (template: string) =>
    template.replace('{name}', name).replace('{amount}', amountText);
  if (balance === 0n) return fill(words.square);
  return fill(balance > 0n ? words.isOwed : words.owes);
}
