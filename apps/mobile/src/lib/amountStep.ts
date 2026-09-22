/**
 * Nudging an amount up and down — the arithmetic behind the quick sheet's
 * stepper and its drag.
 *
 * A stepper on money has a problem a stepper on seats does not: there is no
 * single right increment. One rupee is the obvious unit and it is useless on a
 * bill of ₹1,300 — you would tap forty times to round it up. A hundred is right
 * there and absurd on a ₹20 chai. And a step that is right for rupees is wrong
 * by two orders of magnitude for dong.
 *
 * So the step is read off the amount itself: the largest power of ten that is
 * still no more than a hundredth of it, and never less than one major unit.
 *
 *     ₹20        → ₹1        ₹1,300  → ₹10
 *     ₹47,500    → ₹100      ₫1,300,000 → ₫10,000
 *
 * The effect is that a tap always moves the figure by something you would say
 * out loud, whatever the size of the bill, and the same code says it for every
 * currency without a table of special cases.
 *
 * **Snapping matters as much as the size.** Stepping 1,305 by ten gives 1,310,
 * not 1,315: the value lands on the step's own grid. Without that, one tap on a
 * typed figure leaves a number that is neither what you typed nor round, which
 * is the thing that makes a stepper feel broken rather than helpful.
 *
 * Everything here is in integer minor units, like the rest of the ledger, and
 * everything is pure — the taps and the repeating hold on top are only ways of
 * calling it.
 */

import { minorUnitExponent, type CurrencyCode } from '@waves/core';

/** One major unit in minor units: 100 paise, 100 cents, 1 yen, 1 dong. */
export function majorUnit(currency: CurrencyCode): bigint {
  return 10n ** BigInt(minorUnitExponent(currency));
}

/**
 * How much one tap moves this amount.
 *
 * Exported because the control says it out loud — a stepper whose step changes
 * with the figure has to show what it is about to do, or it is a button that
 * does something different every time you look at it.
 */
export function stepFor(value: bigint, currency: CurrencyCode): bigint {
  const unit = majorUnit(currency);
  const hundredth = value / 100n;
  if (hundredth <= unit) return unit;
  // The largest power of ten at or below a hundredth of the amount. Counted
  // rather than log'd: these are bigints, and floating point has no business
  // anywhere near a ledger amount.
  let step = unit;
  while (step * 10n <= hundredth) step *= 10n;
  return step;
}

/**
 * The amount one tap of the stepper produces.
 *
 * Up rounds onto the next multiple of the step; down onto the previous one. A
 * figure already on the grid moves a whole step, which is the case that has to
 * feel like a step at all.
 */
export function nudge(value: bigint, direction: 1 | -1, currency: CurrencyCode): bigint {
  const step = stepFor(value, currency);
  if (direction === 1) return (value / step + 1n) * step;
  if (value <= 0n) return 0n;
  // Already on the grid: go down a whole one. Off it: fall back to the grid.
  const floor = (value / step) * step;
  const next = floor === value ? floor - step : floor;
  // An amount cannot go below nothing, and a sheet whose figure can be driven
  // negative is a sheet that can save a negative expense.
  return next < 0n ? 0n : next;
}

/**
 * The chips under the figure: bigger jumps than a single step, and they move
 * with the amount rather than being a fixed menu.
 *
 * A fixed set — ₹100, ₹500, ₹1,000 — is right for exactly one size of bill and
 * silly for every other; offering "+₹500" on a ₹9 chai is the same mistake as
 * a ₹1 stepper on a flight, in the other direction. These are multiples of the
 * step the amount already earned, so they say +₹5/+₹10/+₹50 on a small figure
 * and +₹50/+₹100/+₹500 on a large one, and they change under your thumb as the
 * figure grows.
 *
 * Additive rather than absolute, because on an expense you are topping up a
 * number you already have — the tip, the extra round — where an investing app's
 * quick amounts replace it.
 */
export const QUICK_MULTIPLES = [5n, 10n, 50n] as const;

export function quickAdds(value: bigint, currency: CurrencyCode): readonly bigint[] {
  const step = stepFor(value, currency);
  return QUICK_MULTIPLES.map((multiple) => step * multiple);
}
