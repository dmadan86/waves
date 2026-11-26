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

/** The words beside a member's balance, from the viewer's side ("owes you", "you owe", "you are owed"). */
export function balanceWord(
  balance: bigint,
  isViewerRow: boolean,
  words: {
    youAreOwed: string;
    youOwe: string;
    owesYou: string;
    youOweThem: string;
    allSquare: string;
  },
): string {
  const direction = directionForViewer(balance, isViewerRow);
  if (direction === BalanceDirection.OwedToYou)
    return isViewerRow ? words.youAreOwed : words.owesYou;
  if (direction === BalanceDirection.YouOwe) return isViewerRow ? words.youOwe : words.youOweThem;
  return words.allSquare;
}
