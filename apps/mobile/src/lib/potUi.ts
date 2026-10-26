import { showsVendorTools } from './eventOrganizer';
import { normalisePotUtr, SettlementStatus, type PotInput, type PotSettlement } from '@waves/core';
import type { PotWithContributions } from '@waves/api-client';

export function potInput(pot: PotWithContributions, memberIds: readonly string[]): PotInput {
  return {
    id: pot.id,
    currency: pot.currency,
    perHeadMinor: BigInt(pot.per_head_minor),
    treasurerMemberId: pot.treasurer_member_id,
    memberIds,
  };
}
export function potSettlements(pot: PotWithContributions): PotSettlement[] {
  return (pot.contributions ?? []).map((row) => ({
    id: row.id,
    potId: row.pot_id,
    from: row.from_member_id,
    to: row.to_member_id,
    amount: BigInt(row.amount),
    currency: row.currency,
    status: row.status as SettlementStatus,
    at: row.initiated_at,
  }));
}
export function optionalPotUtr(value: string): { valid: boolean; reference: string | null } {
  if (!value.trim()) return { valid: true, reference: null };
  const reference = normalisePotUtr(value);
  return { valid: reference !== null, reference };
}
/** A callback can fill a text box; it cannot change a payment's status. */
export function upiReference(
  result: { utr?: string | null; txnRef?: string | null } | null,
): string {
  return result?.utr?.trim() || result?.txnRef?.trim() || '';
}

/** Join online pot tags to older mirror projections before any netting. */
export function tagPotLedger<
  E extends { id: string; potId?: string | null },
  S extends { id: string; potId?: string | null },
>(
  pots:
    | readonly (Pick<PotWithContributions, 'id'> &
        Partial<Pick<PotWithContributions, 'contributions'>>)[]
    | null
    | undefined,
  expenseTags: Readonly<Record<string, string>>,
  expenses: readonly E[],
  settlements: readonly S[],
) {
  const settlementTags = new Map(
    (pots ?? []).flatMap((pot) =>
      (pot.contributions ?? []).map((row) => [row.id, pot.id] as const),
    ),
  );
  return {
    expenses: expenses.map((row) => ({ ...row, potId: expenseTags[row.id] ?? row.potId })),
    settlements: settlements.map((row) => ({
      ...row,
      potId: row.potId ?? settlementTags.get(row.id),
    })),
  };
}

/** Existing pots stay accessible after a group changes type. */
export function potVisibility(
  group: { type: string | null } | null | undefined,
  pots: readonly unknown[] | null | undefined,
): { canStart: boolean; show: boolean } {
  const canStart = showsVendorTools(group?.type);
  return { canStart, show: canStart || (pots?.length ?? 0) > 0 };
}
