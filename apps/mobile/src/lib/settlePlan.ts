/**
 * The settle plan, cut the way a person reads it: who owes me, whom I owe, and
 * everything else. Presentation only — the transfers come from the ledger
 * (`useGroupLedger`) untouched; nothing here recomputes a balance.
 */

export interface PlanTransfer {
  readonly from: string;
  readonly to: string;
  readonly currency: string;
  readonly amount: bigint;
}

export interface SettlePlanSplit {
  /** Transfers where somebody pays me. */
  readonly owesMe: readonly PlanTransfer[];
  /** Transfers where I pay somebody. */
  readonly iOwe: readonly PlanTransfer[];
  /** Transfers between two other members. */
  readonly others: readonly PlanTransfer[];
}

/**
 * The key a pending (initiated, unconfirmed) payment is matched to a plan
 * line by: payer, payee and currency. `partyOf` widens a member to the party
 * they settle as — their family in the Families lens — so a payment one
 * family member has already marked counts against the family's line for
 * everyone in it, rather than only for the exact pair who recorded it.
 */
export function pendingPairKey(
  from: string,
  to: string,
  currency: string,
  partyOf: (memberId: string) => string = (memberId) => memberId,
): string {
  return `${partyOf(from)}>${partyOf(to)}>${currency}`;
}

/** Zero-amount transfers are noise and are dropped. Order is preserved. */
export function splitSettlePlan(
  transfers: readonly PlanTransfer[],
  myMemberId: string | null,
): SettlePlanSplit {
  const owesMe: PlanTransfer[] = [];
  const iOwe: PlanTransfer[] = [];
  const others: PlanTransfer[] = [];
  for (const transfer of transfers) {
    if (transfer.amount <= 0n) continue;
    if (myMemberId && transfer.to === myMemberId) owesMe.push(transfer);
    else if (myMemberId && transfer.from === myMemberId) iOwe.push(transfer);
    else others.push(transfer);
  }
  return { owesMe, iOwe, others };
}
