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

export type SettleSummaryKind = 'settled' | 'owed' | 'owe' | 'both';

export interface SettleSummary {
  readonly kind: SettleSummaryKind;
  /** What I am owed, in `currency`. */
  readonly owed: bigint;
  /** What I owe, in `currency`. */
  readonly owe: bigint;
  /** The net of the two; the headline sign. */
  readonly net: bigint;
}

/**
 * The one-line headline. Sums only the group's own currency when a plan mixes
 * currencies, so two different units are never added together; rows in other
 * currencies still list below it.
 */
export function summariseSettlePlan(split: SettlePlanSplit, currency: string): SettleSummary {
  const sum = (rows: readonly PlanTransfer[]): bigint =>
    rows.reduce((total, row) => (row.currency === currency ? total + row.amount : total), 0n);
  const owed = sum(split.owesMe);
  const owe = sum(split.iOwe);
  const net = owed - owe;
  const anyRows = split.owesMe.length > 0 || split.iOwe.length > 0;
  if (!anyRows) return { kind: 'settled', owed, owe, net };
  if (owed > 0n && owe > 0n) return { kind: 'both', owed, owe, net };
  if (owe > 0n) return { kind: 'owe', owed, owe, net };
  return { kind: 'owed', owed, owe, net };
}

export type SettleHeroTone = 'owe' | 'owed' | 'settled';

export interface SettleHero {
  readonly tone: SettleHeroTone;
  /** The amount the card leads with, always positive, in the group's currency. */
  readonly amount: bigint;
  /** How many payments make that amount up (rows in the group's currency). */
  readonly count: number;
}

/**
 * What the summary card says: the side the net falls on, how much, and across
 * how many payments. A net of zero (or no rows) is "settled" whatever rows sit
 * below it. Presentation only, built from the split and summary above.
 */
export function settleHero(
  split: SettlePlanSplit,
  summary: SettleSummary,
  currency: string,
): SettleHero {
  const countIn = (rows: readonly PlanTransfer[]): number =>
    rows.filter((row) => row.currency === currency).length;
  if (summary.net < 0n) return { tone: 'owe', amount: -summary.net, count: countIn(split.iOwe) };
  if (summary.net > 0n) return { tone: 'owed', amount: summary.net, count: countIn(split.owesMe) };
  return { tone: 'settled', amount: 0n, count: 0 };
}
