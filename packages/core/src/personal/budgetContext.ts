/**
 * The two figures the budget editor needs that the ledger does not already
 * carry: what this category has actually cost over a recent window, and how big
 * a nudge the − / + buttons beside the amount should make.
 *
 * **Why a history at all.** A monthly cap typed into an empty field is a guess.
 * The one thing that turns it into a decision is what the last few months
 * actually cost, so the sheet says it out loud under the amount. Six months is
 * the window because it is long enough to survive one unusual month (a wedding,
 * a hospital visit) and short enough that a person still recognises it as their
 * own recent life.
 *
 * **Why the window ends at the browsed month rather than the month before it.**
 * The anchor month is usually part-way through, so counting it drags the
 * average a little low early in a month. Excluding it was tried in the design
 * and rejected: it lets the sheet say "you haven't spent anything in this
 * category in the last six months" directly beneath a progress bar showing this
 * month's spend, which reads as a bug and destroys trust in both numbers. A
 * slightly conservative average is a much cheaper price than a line that
 * contradicts the one above it.
 *
 * **Why the filter is spelled out again here instead of reusing
 * `personalBudgetProgress` per month.** It is the same filter — expense only, in
 * the budget's currency, matching its category, loan repayments excluded — and
 * it has to stay the same filter, or the six-month line disagrees with the bar
 * it sits under. It is written as one pass over the ledger rather than six
 * passes through a function that also computes a ratio and a remainder nobody
 * here wants; the shared rule is the comment, and the test pins the two together.
 *
 * Pure, like everything else in `personal/compute` — the month is passed in,
 * never read from the clock.
 */

import { minorUnitScale, type CurrencyCode } from '../money/currency';
import { monthKey, recentMonths } from './compute';
import type { PersonalTxn } from './types';

/** What a budget caps: a category (or null for an overall cap) in one currency. */
export interface BudgetScope {
  readonly category: string | null;
  readonly currency: CurrencyCode;
}

export interface PersonalSpendWindow {
  /** Everyday spend across the whole window, in minor units. */
  readonly total: bigint;
  /** How many month keys were read — the window's length, not its activity. */
  readonly months: number;
  /** How many of those months had any spend at all. Zero means the window is
   *  genuinely empty and the caller should say so in words; one means there is
   *  a total worth showing but no honest average to draw from it. */
  readonly monthsWithSpend: number;
  /** `total` spread over every month in the window, truncated to minor units.
   *  Divided by the window's length rather than by the months that happened to
   *  have spend: a category used twice a year costs what it costs *per month*,
   *  and averaging only the months it appeared in would quietly turn an
   *  occasional expense into a monthly one. */
  readonly average: bigint;
}

/**
 * Everyday spend in one budget's scope over the `months` months ending at (and
 * including) `month`. The per-month figures are not returned, only what the
 * sheet says out loud: the total, the window's length, how much of it was used,
 * and the average.
 *
 * Loan repayments are excluded, exactly as `personalBudgetProgress` excludes
 * them: a budget is about spending, not about paying down a debt.
 */
export function budgetSpendWindow(
  txns: readonly PersonalTxn[],
  scope: BudgetScope,
  month: string,
  months = 6,
): PersonalSpendWindow {
  const window = recentMonths(month, months);
  const keys = new Set(window);
  const spentIn = new Map<string, bigint>();

  let total = 0n;
  for (const txn of txns) {
    if (txn.kind !== 'expense') continue;
    if (txn.loanId !== null) continue;
    if (txn.currency !== scope.currency) continue;
    if (scope.category !== null && txn.category !== scope.category) continue;
    const key = monthKey(txn.date);
    if (!keys.has(key)) continue;
    // A zero-amount entry is not a month with spend in it, so the tally counts
    // money rather than rows.
    if (txn.amount === 0n) continue;
    spentIn.set(key, (spentIn.get(key) ?? 0n) + txn.amount);
    total += txn.amount;
  }

  const count = window.length;
  return {
    total,
    months: count,
    monthsWithSpend: spentIn.size,
    average: count > 0 ? total / BigInt(count) : 0n,
  };
}

/**
 * How much one tap of − or + beside an amount should move it.
 *
 * A fixed step is useless at both ends of the range: one rupee at a time is a
 * hundred taps to move a ₹5,000 cap, and ₹500 at a time cannot express a ₹200
 * one. So the step is read off the amount itself — roughly a tenth of it,
 * rounded *down* onto the 1-2-5 ladder every price list in the world already
 * uses, so the figure that lands is one somebody would have typed: ₹5,000 steps
 * by ₹500, ₹1,200 by ₹100, ₹80 by ₹5.
 *
 * Two floors. Below one whole major unit the ladder stops — nobody caps a
 * monthly budget in paise — and an amount of zero opens at ten major units, so
 * the first tap on a fresh budget lands on a round figure rather than on 1.
 *
 * The ladder is in the currency's own major units, not in anything converted:
 * this package has no rate to hand and a budget sheet is the wrong place to
 * start fetching one, so a ¥ step and a ₹ step are the same *number* rather
 * than the same value. That is wrong in the abstract and right in practice —
 * the step is a nudge on a figure the person can always type instead, and a
 * currency's own round numbers are the ones its speakers think in.
 */
export function budgetStep(amount: bigint, currency: CurrencyCode): bigint {
  const unit = minorUnitScale(currency);
  if (amount <= 0n) return unit * 10n;

  const target = amount / 10n;
  if (target < unit) return unit;

  let best = unit;
  for (let decade = unit; decade <= target; decade *= 10n) {
    for (const rung of [1n, 2n, 5n]) {
      const candidate = decade * rung;
      if (candidate <= target) best = candidate;
    }
  }
  return best;
}
