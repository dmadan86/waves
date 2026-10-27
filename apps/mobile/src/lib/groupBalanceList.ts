import type { PersonDebts } from './debtsByPerson';
import type { PlanTransfer } from './settlePlan';

/** Amount order comes from the ledger's currency-aware grouping; never sum currencies. */
export function sortPeopleDebts(
  people: readonly PersonDebts[],
  sort: 'amount' | 'name',
  nameOf: (id: string) => string,
  locale: string,
): PersonDebts[] {
  return sort === 'amount'
    ? [...people]
    : [...people].sort((a, b) => nameOf(a.memberId).localeCompare(nameOf(b.memberId), locale));
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
