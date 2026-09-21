/**
 * Where a person's own month went — the three-way split behind the Spending
 * screen (A48).
 *
 * The Me tab already answers "income, expense, net". That is true and nearly
 * useless for deciding anything, because it folds the rent into the restaurants.
 * A month in which £900 of rent and £180 of groceries left the account reads as
 * £1,080 spent, sits beside a month with no rent in it, and invites the wrong
 * conclusion about the groceries. So a month is split three ways instead:
 *
 *     Income        what came in
 *     Bills & subs  what was always going to leave, whatever you did
 *     Spending      what was actually decided this month
 *     Left over     income − bills − spending
 *
 * **"Left over", never "saved".** The app cannot see a savings account. All it
 * knows is that some money was not spent by the last day of the month; whether
 * it was moved somewhere, or is still sitting there waiting to be, is not
 * something this ledger can witness. Naming the row "saved" would be the ledger
 * asserting a fact about the world, which is the one thing it must never do.
 *
 * WHAT MAKES SOMETHING A BILL, AND WHY THIS FILE DOES NOT DECIDE.
 *
 * A bill is a *recurring rule* of a bill-like kind — rent, a subscription, a
 * loan instalment — and the rule's kind is not a field these functions can read.
 * Rather than guess (a category named "rent"? any rule at all? a threshold on
 * the amount?), the classification is injected: the caller passes `isBillLike`,
 * which answers for one recurring id. Every guess considered here had the same
 * flaw — it would be right most of the time and silently wrong for somebody,
 * and a wrong number on this screen looks like a fact about their life.
 *
 * The default answers "no rule is bill-like", so with nothing passed the Bills
 * row reads zero, everything lands under Spending, and the totals still add up
 * to exactly what the Me tab shows. That is deliberate: the screen works today,
 * before the `kind` field exists, and starts telling a richer story the day a
 * classifier is handed in — with no change here.
 *
 * MONEY THAT IS NOT IN ONE CURRENCY. Nothing is converted, ever (ADR-003), so
 * each of these takes a single `currency` and reads only the entries in it. The
 * group side made the same call and lets the screen draw one chart per currency;
 * `personalSpendingCurrencies` is the personal twin of `spendingCurrencies`, so
 * the UI can name what it is leaving out rather than quietly adding rupees to
 * pounds.
 *
 * All pure and deterministic — no clock, no locale, no formatting. A month is a
 * 'YYYY-MM' key sliced off the date string, never parsed into a `Date`, because
 * parsing applies the phone's timezone and files a 1st-of-month entry under the
 * previous month for anybody east of UTC.
 */

import type { CurrencyCode } from '../money/currency';
import { monthKey, type CategorySpend } from './compute';
import type { PersonalTxn } from './types';

/**
 * How a caller tells these functions which recurring rules are bills.
 *
 * One predicate rather than a set, because the caller usually holds the rules
 * already and a set would make it build a second structure to answer a question
 * it can answer directly. A `ReadonlySet<string>` satisfies this in one line:
 * `{ isBillLike: (id) => billIds.has(id) }`.
 */
export interface PersonalSpendingOptions {
  /**
   * True when the recurring rule with this id is a bill or a subscription —
   * money that leaves whatever the month is like. Absent means "none of them
   * are", which is the honest answer until something can classify them.
   */
  readonly isBillLike?: (recurringId: string) => boolean;
}

/** One month, split the way the screen shows it. All in minor units. */
export interface PersonalMonthSplit {
  /** 'YYYY-MM'. */
  readonly month: string;
  /** Everything that came in. */
  readonly income: bigint;
  /** Expense entries owed to a bill-like recurring rule. */
  readonly bills: bigint;
  /** Every other expense — what was actually decided this month. */
  readonly spending: bigint;
  /** income − bills − spending. Negative when the month ran past its income. */
  readonly leftOver: bigint;
}

/** Whether one entry is a bill under this classification. */
function isBill(txn: PersonalTxn, options: PersonalSpendingOptions): boolean {
  return txn.recurringId !== null && (options.isBillLike?.(txn.recurringId) ?? false);
}

/**
 * One month split into income, bills, spending and what was left.
 *
 * Every entry in the currency counts exactly once, so `income − bills −
 * spending` is the same figure `monthlySummary` calls `net` and the two screens
 * can never disagree. That includes the awkward ones, on purpose:
 *
 * - A loan repayment is spending. It left the wallet; a screen that hid it
 *   would show money left over that is not there.
 * - Money arriving to repay a loan you made is income, for the same reason. It
 *   flatters the month, and it is genuinely what landed in the account — the
 *   loans screen is where the principal is tracked, not here.
 */
export function computePersonalSpending(
  txns: readonly PersonalTxn[],
  month: string,
  currency: CurrencyCode,
  options: PersonalSpendingOptions = {},
): PersonalMonthSplit {
  let income = 0n;
  let bills = 0n;
  let spending = 0n;

  for (const txn of txns) {
    if (txn.currency !== currency) continue;
    if (monthKey(txn.date) !== month) continue;
    if (txn.kind === 'income') income += txn.amount;
    else if (isBill(txn, options)) bills += txn.amount;
    else spending += txn.amount;
  }

  return { month, income, bills, spending, leftOver: income - bills - spending };
}

/**
 * The same split for each of `months`, in the order given — what the month chart
 * reads.
 *
 * It returns all four figures rather than the "earned and spent" pair the chart
 * draws, because the screen has a switch for whether bills belong in the spent
 * column and the answer must not cost a second pass over the ledger. A month
 * where the rent landed looks catastrophic beside one where it did not, and
 * being able to take the bills out is the difference between a chart that
 * accuses and one that informs.
 *
 * Months with nothing in them come back as zeroes rather than being dropped: a
 * gap in a chart is data ("you spent nothing in June"), and silently shortening
 * the axis would move the remaining columns around under somebody's finger.
 */
export function personalSpendingTrend(
  txns: readonly PersonalTxn[],
  months: readonly string[],
  currency: CurrencyCode,
  options: PersonalSpendingOptions = {},
): PersonalMonthSplit[] {
  return months.map((month) => computePersonalSpending(txns, month, currency, options));
}

/**
 * What one split shows in the chart's spent column.
 *
 * A one-liner, and it is here rather than in the screen so the "Include bills"
 * switch means the same thing everywhere it is offered — the month chart today,
 * the budget sheet later.
 */
export function spentInMonth(split: PersonalMonthSplit, includeBills: boolean): bigint {
  return includeBills ? split.bills + split.spending : split.spending;
}

/**
 * Spend per category across several months, biggest first — the half-year view a
 * budget is actually set from.
 *
 * One month is too short to set a cap against: a quarterly insurance payment
 * makes one month's "insurance" enormous and the next two zero, and a person
 * reading either would pick the wrong number. Summing a window and sorting it is
 * what turns that into a figure worth arguing with.
 *
 * `share` is each category's fraction of the window's total, 0–1, for a bar
 * width; the integer division happens on the money in bigint and only the final
 * ratio is a float, so no rounding ever reaches an amount. Ties break on the
 * category key so the order is stable between renders. Uncategorised entries
 * keep their own `null` row rather than being folded into "other" — the UI
 * resolves the name, and only it knows which custom tags exist.
 *
 * Bills are in by default, because "where does it all go" includes the rent.
 * Pass `includeBills: false` with a classifier to ask the narrower question.
 */
export function personalCategoryTotals(
  txns: readonly PersonalTxn[],
  months: readonly string[],
  currency: CurrencyCode,
  options: PersonalSpendingOptions & { readonly includeBills?: boolean } = {},
): CategorySpend[] {
  const includeBills = options.includeBills ?? true;
  const window = new Set(months);
  const totals = new Map<string | null, bigint>();
  let total = 0n;

  for (const txn of txns) {
    if (txn.kind !== 'expense') continue;
    if (txn.currency !== currency) continue;
    if (!window.has(monthKey(txn.date))) continue;
    if (!includeBills && isBill(txn, options)) continue;
    totals.set(txn.category, (totals.get(txn.category) ?? 0n) + txn.amount);
    total += txn.amount;
  }

  return [...totals]
    .sort((a, b) => (b[1] === a[1] ? categoryOrder(a[0], b[0]) : b[1] > a[1] ? 1 : -1))
    .map(([category, spent]) => ({
      category,
      spent,
      // Integer maths first, then one divide — no float ever touches the money.
      share: total > 0n ? Number((spent * 10_000n) / total) / 10_000 : 0,
    }));
}

/** Stable order for two category keys, the uncategorised row last. */
function categoryOrder(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/**
 * Every currency the ledger holds an entry in, the preferred one first and the
 * rest alphabetical — the personal twin of `spendingCurrencies`.
 *
 * Nothing here converts anything, so a screen that shows one currency is hiding
 * the others. This is how it finds out it is doing that, and can say so. Putting
 * the preferred currency first stops one holiday's worth of foreign entries
 * becoming the headline above the ledger somebody actually reads.
 *
 * The preferred currency is always first in the list even when no entry uses it
 * — a person with an empty ledger still has a currency, and a screen that has to
 * special-case an empty array would draw nothing rather than an empty month.
 */
export function personalSpendingCurrencies(
  txns: readonly PersonalTxn[],
  preferred: CurrencyCode,
): CurrencyCode[] {
  const present = new Set<CurrencyCode>(txns.map((txn) => txn.currency));
  present.add(preferred);
  return [...present].sort((a, b) =>
    a === preferred ? -1 : b === preferred ? 1 : a.localeCompare(b),
  );
}
