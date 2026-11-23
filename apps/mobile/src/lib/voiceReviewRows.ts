import { computeShares, validatePayers, type SplitParams } from '@waves/core';

import { scaleAmounts } from '@/lib/assistantRescale';

/** Templates with `{count}`: the Split row's mode and head count, never names. */
export interface SplitRowWords {
  equally: string;
  shares: string;
  percent: string;
  amounts: string;
}

export function splitRowValue(params: SplitParams, count: number, words: SplitRowWords): string {
  const template =
    params.kind === 'exact'
      ? words.amounts
      : params.kind === 'percent'
        ? words.percent
        : params.kind === 'shares'
          ? words.shares
          : words.equally;
  return template.replace('{count}', String(count));
}

/** 'You', one name, or 'N people' (`several` is the `{count}` template). */
export function payerRowValue(
  payers: readonly { name: string; isYou?: boolean }[],
  you: string,
  several: string,
): string {
  if (payers.length > 1) return several.replace('{count}', String(payers.length));
  return payers[0]?.isYou ? you : payers[0]?.name || you;
}

/**
 * One reviewed expense's payers and shares, from the payers and split set for the
 * whole review. The payers are scaled to this expense's total, then both sides
 * are checked the way Add expense checks them: payers sum to the total, shares
 * sum to the total. Throws rather than writing a bill that does not add up.
 */
export function voiceExpenseAmounts(input: {
  expenseId: string;
  amount: bigint;
  currency: string;
  params: SplitParams;
  participants: readonly string[];
  /** Who paid and how much, against any one total of the review. */
  payers: Readonly<Record<string, bigint>>;
}): { payers: Record<string, bigint>; expectedShares: Record<string, bigint> } {
  const { expenseId, amount, currency, params, participants } = input;
  const paid = Object.values(input.payers).reduce((sum, value) => sum + value, 0n);
  const payers = paid === amount ? { ...input.payers } : scaleAmounts(input.payers, paid, amount);
  if (validatePayers(amount, new Map(Object.entries(payers))) !== null)
    throw new Error('payers do not add up to the total');
  const shares = computeShares({ amount, currency, params, participants, seed: expenseId });
  let total = 0n;
  for (const value of shares.values()) total += value;
  if (total !== amount) throw new Error('shares do not add up to the total');
  return { payers, expectedShares: Object.fromEntries(shares) };
}
