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
