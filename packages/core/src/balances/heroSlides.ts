/**
 * Which figures the dashboard's balance deck is worth swiping through.
 *
 * The deck was a fixed three: your net standing, the gross total owed to you,
 * and this month's spend. But `net` and `owed` are the same arithmetic whenever
 * you owe nobody — `net = owed − owing`, so with `owing` at zero the first two
 * slides print one number under two labels ("Net receivable ₹500", then
 * "Receivables ₹500"). That is the common case for anybody who only ever
 * fronts money, and two labels over one number reads as a bug, not as two facts.
 *
 * A net figure only conceals something when money is moving both ways. So the
 * gross slide earns its place exactly then, and it carries the side the
 * headline is *not* already showing: what you still owe when you are up
 * overall, what is still coming to you when you are down.
 *
 * This decides slides, never amounts — the amounts are `CurrencyTotals`, one
 * currency at a time, because there is no total across currencies (ADR-004).
 * It lives in @waves/core so the phone and the web dashboard cannot disagree
 * about which of their own numbers are worth showing (TDR §1).
 */

import type { CurrencyTotals } from './totals';

/**
 * A slide in the deck: where you stand, the gross owed to you, the gross you
 * owe, and what you have spent this month.
 */
export type BalanceSlide = 'net' | 'owed' | 'owing' | 'month';

/**
 * The deck for one currency's totals, in swipe order.
 *
 * Two slides when your money runs one way, three when it runs both. The month's
 * spend is a different quantity from the balance entirely — money you are on
 * the hook for, whoever has paid — so it is always there to swipe to.
 *
 * What this rules out is the pair that was equal *by construction*, on every
 * launch, for a whole class of users. Two slides can still land on the same
 * amount by arithmetic accident (owed ₹400 against owing ₹200 nets to ₹200),
 * and that is a coincidence between two genuinely different facts rather than
 * the same fact told twice.
 */
export function balanceDeckSlides(totals: CurrencyTotals): readonly BalanceSlide[] {
  // One-sided: the net *is* the gross, and the empty side is a zero that needs
  // no slide of its own — "Payables ₹0" is already what "Net receivable" said.
  if (totals.owed === 0n || totals.owing === 0n) return ['net', 'month'];
  // Two-sided: show the side the net nets away. A net of exactly zero belongs
  // here too — it is the one headline that says nothing at all about the sums
  // standing behind it, so the gross beside it is the whole story.
  return ['net', totals.net > 0n ? 'owing' : 'owed', 'month'];
}
