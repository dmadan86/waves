/**
 * Household "Share it" mode. A group is either `split` (track who paid and who
 * owes) or `pool` (one household pot: nobody owes anybody). Old apps never send
 * or read `ledger_mode`; a missing value reads as `split`.
 */
import type { SplitParams } from '../split/types';

export const LEDGER_MODES = ['split', 'pool'] as const;
export type LedgerMode = (typeof LEDGER_MODES)[number];

/** Types that are asked "Split it or Share it" when created. */
export const POOLABLE_GROUP_TYPES: readonly string[] = ['couple', 'home', 'other'];

export function ledgerModeOf(
  group: { ledger_mode?: string | null } | null | undefined,
): LedgerMode {
  return group?.ledger_mode === 'pool' ? 'pool' : 'split';
}

export function isPoolGroup(group: { ledger_mode?: string | null } | null | undefined): boolean {
  return ledgerModeOf(group) === 'pool';
}

/** Only an admin switches; either direction is allowed with open balances. */
export function canSwitchLedgerMode(isAdmin: boolean, from: LedgerMode, to: LedgerMode): boolean {
  return isAdmin && from !== to;
}

/** True when switching leaves balances that nobody has settled ("stay until settled"). */
export function switchKeepsOpenBalances(openBalanceCount: number): boolean {
  return openBalanceCount > 0;
}

/**
 * Nobody owes anyone: each payer's share is exactly what they paid, so net
 * balances are zero. `participants` are the payers.
 */
export function poolSplit(payers: Readonly<Record<string, bigint>>): {
  splitParams: SplitParams;
  participants: string[];
} {
  const amounts: Record<string, bigint> = {};
  for (const [member, paid] of Object.entries(payers)) if (paid > 0n) amounts[member] = paid;
  return { splitParams: { kind: 'exact', amounts }, participants: Object.keys(amounts) };
}

/**
 * The pooled reading of an expense-create wire payload: an `equal` split becomes
 * the pool split unless the writer asked to split this one. Anything the person
 * chose explicitly (exact, percent, ...) is left alone, as is a payload with no
 * payers. Pure; returns the same object when nothing changes.
 */
export function poolExpensePayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload.splitThisOne === true) {
    const { splitThisOne: _drop, ...rest } = payload;
    return rest;
  }
  const split = payload.splitParams as { kind?: string } | null | undefined;
  const payers = payload.payers as Record<string, string> | undefined;
  if (split?.kind !== 'equal' || !payers) return payload;
  const amounts: Record<string, string> = {};
  for (const [member, paid] of Object.entries(payers))
    if (BigInt(paid) > 0n) amounts[member] = paid;
  if (Object.keys(amounts).length === 0) return payload;
  const { expectedShares: _e, ...rest } = payload;
  return { ...rest, splitParams: { kind: 'exact', amounts }, participants: Object.keys(amounts) };
}
