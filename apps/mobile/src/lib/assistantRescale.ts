/**
 * A group expense write re-based on a corrected amount, currency or description.
 * Pure: the split is rebuilt with the same rules the add-expense form uses, so a
 * correction never leaves shares that do not add up to the new total.
 */

import { computeShares, type SplitParams } from '@waves/core';

import type { AgentExpenseWrite } from '@/lib/voiceAgentPlan';

/** `amounts` scaled to `to` in whole minor units; the rounding remainder goes to the largest. */
export function scaleAmounts(
  amounts: Readonly<Record<string, bigint>>,
  from: bigint,
  to: bigint,
): Record<string, bigint> {
  const entries = Object.entries(amounts);
  if (entries.length === 0 || from <= 0n) return { ...amounts };
  const scaled = entries.map(([id, value]) => [id, (value * to) / from] as const);
  const drift = to - scaled.reduce((sum, [, value]) => sum + value, 0n);
  let largest = 0;
  scaled.forEach(([, value], index) => {
    if (value > (scaled[largest]?.[1] ?? 0n)) largest = index;
  });
  return Object.fromEntries(
    scaled.map(([id, value], index) => [id, index === largest ? value + drift : value]),
  );
}

function splitFor(params: SplitParams, from: bigint, to: bigint): SplitParams {
  // Percent and weights are ratios, so they keep their meaning at any total;
  // exact amounts are money and must be scaled to add up again.
  return params.kind === 'exact'
    ? { kind: 'exact', amounts: scaleAmounts(params.amounts, from, to) }
    : params;
}

export function rescaleWrite<W extends AgentExpenseWrite>(
  base: W,
  to: {
    amount: bigint;
    currency: string;
    description: string;
    /** Who shares it now; a different set becomes an equal split among them. */
    participants?: readonly string[];
  },
): W {
  const description = to.description.trim() || base.description;
  const participants = to.participants?.length ? [...new Set(to.participants)] : base.participants;
  const sameParticipants =
    participants.length === base.participants.length &&
    participants.every((id) => base.participants.includes(id));
  if (to.amount === base.amount && to.currency === base.currency && sameParticipants) {
    return description === base.description ? base : { ...base, description };
  }
  const splitParams: SplitParams = sameParticipants
    ? splitFor(base.splitParams, base.amount, to.amount)
    : { kind: 'equal' };
  const payers = scaleAmounts(base.payers, base.amount, to.amount);
  const shares = computeShares({
    amount: to.amount,
    currency: to.currency,
    params: splitParams,
    participants,
    seed: base.expenseId,
  });
  return {
    ...base,
    description,
    participants,
    amount: to.amount,
    currency: to.currency,
    splitParams,
    payers,
    expectedShares: Object.fromEntries(shares),
  };
}
