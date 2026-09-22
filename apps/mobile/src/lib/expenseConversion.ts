/**
 * What a foreign expense came to in the group's own money.
 *
 * A group counts in one currency. A bill paid in another is stored in the
 * currency it was paid in — the ledger never rewrites the number somebody
 * actually handed over — with the rate it was written at kept beside it on the
 * version (ADR-003). So the row has both halves and can say both: what was
 * paid, and what that is here.
 *
 * Only ever from the rate the expense carries. It would be easy to convert a
 * rate-less expense with whatever the group has pinned today and show that,
 * and it would be wrong in the way that matters: the balance does not use that
 * number, so the row and the balance would disagree about the same expense.
 * An expense with no rate is genuinely not counted in the group's currency
 * yet — it stands in its own — and the cure is to give it one (the rate card
 * on the expense, or the bulk action in group settings), not to draw a figure
 * the ledger does not hold.
 */

import { convertWithRecord, money, type CurrencyCode, type Money } from '@waves/core';

import type { ExpenseVersionRow } from '@/data/types';

/**
 * The version's total in `groupCurrency`, or null when there is nothing to
 * say — the expense is already in that currency, or carries no rate.
 *
 * `fx` is absent rather than null on a row mirrored before the pull asked for
 * the column, which reads the same way here: no rate to convert with.
 */
export function convertedTotal(
  version: Pick<ExpenseVersionRow, 'currency' | 'amount' | 'fx'>,
  groupCurrency: string,
): Money | null {
  if (version.currency === groupCurrency) return null;
  const record = version.fx;
  if (!record) return null;
  // A rate for the wrong pair converts nothing: it is not a worse answer, it
  // is a different question, and `resolveFxRate` skips those for the same
  // reason. Guarded here because a stored rate outlives edits to the currency
  // it was stored against.
  if (record.from !== version.currency || record.to !== groupCurrency) return null;
  try {
    return convertWithRecord(
      money(BigInt(version.amount), version.currency as CurrencyCode),
      record,
    );
  } catch {
    // A malformed rate is an expense with no usable rate, never a crash on the
    // ledger row that has to draw the rest of the month anyway.
    return null;
  }
}
