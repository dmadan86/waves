/**
 * The stepper's arithmetic.
 *
 * Two properties carry this whole control. The step has to be a number a
 * person would say out loud at every size of bill — one rupee on a chai, ten on
 * a dinner, a hundred on a flight — and the result has to land on round
 * figures, because a tap that turns 1,305 into 1,315 is a tap that made the
 * number worse. Both are pinned here in integer minor units, which is what the
 * ledger stores.
 */
import { describe, expect, it } from 'vitest';

import {
  majorUnit,
  nudge,
  POINTS_PER_STEP,
  quickAdds,
  scrub,
  stepFor,
} from '../src/lib/amountStep';

/** ₹, to the minor unit: 130000 is ₹1,300.00. */
const INR = 'INR';
/** No minor unit at all — one dong is one dong. */
const VND = 'VND';

describe('the size of a step', () => {
  it('is one major unit on a small amount', () => {
    expect(stepFor(2000n, INR)).toBe(100n); // ₹20 steps by ₹1
  });

  it('is ten major units on a mid-sized one', () => {
    expect(stepFor(130000n, INR)).toBe(1000n); // ₹1,300 steps by ₹10
  });

  it('is a hundred on a large one', () => {
    expect(stepFor(4750000n, INR)).toBe(10000n); // ₹47,500 steps by ₹100
  });

  it('never drops below one major unit, even at zero', () => {
    // The control has to do something on a fresh sheet, where the amount is
    // nothing and a hundredth of nothing is nothing.
    expect(stepFor(0n, INR)).toBe(100n);
    expect(stepFor(50n, INR)).toBe(100n);
  });

  it('follows the currency rather than a table of special cases', () => {
    // A currency with no minor unit: the major unit *is* the minor one, so the
    // same rule gives ₫10,000 on a ₫1,300,000 bill without knowing about dong.
    expect(majorUnit(VND)).toBe(1n);
    expect(stepFor(1300000n, VND)).toBe(10000n);
  });
});

describe('a tap of the stepper', () => {
  it('rounds up onto the grid rather than adding to an odd figure', () => {
    // ₹1,305 + a ₹10 step is ₹1,310 — not ₹1,315.
    expect(nudge(130500n, 1, INR)).toBe(131000n);
  });

  it('rounds down onto the grid', () => {
    expect(nudge(130500n, -1, INR)).toBe(130000n);
  });

  it('moves a whole step when the figure is already round', () => {
    expect(nudge(130000n, 1, INR)).toBe(131000n);
    expect(nudge(130000n, -1, INR)).toBe(129000n);
  });

  it('will not drive the amount below nothing', () => {
    // A sheet whose figure can go negative is a sheet that can save a negative
    // expense, and nothing downstream is expecting one.
    expect(nudge(0n, -1, INR)).toBe(0n);
    expect(nudge(50n, -1, INR)).toBe(0n);
  });

  it('starts a fresh sheet at one major unit', () => {
    expect(nudge(0n, 1, INR)).toBe(100n);
  });
});

describe('dragging the amount', () => {
  it('does nothing until the finger has travelled far enough to mean it', () => {
    expect(scrub(130000n, POINTS_PER_STEP - 1, INR)).toBe(130000n);
  });

  it('moves one step per travel unit', () => {
    expect(scrub(130000n, POINTS_PER_STEP * 3, INR)).toBe(133000n);
  });

  it('goes back down the way it came', () => {
    expect(scrub(130000n, -POINTS_PER_STEP * 2, INR)).toBe(128000n);
  });

  it('lands exactly where it began when the finger returns', () => {
    // Reckoned from the start of the drag, not accumulated frame by frame: an
    // accumulating version drifts, and a drifted amount is a wrong number with
    // nobody to blame for it.
    const start = 130000n;
    const out = scrub(start, POINTS_PER_STEP * 5, INR);
    expect(out).not.toBe(start);
    expect(scrub(start, 0, INR)).toBe(start);
  });

  it('keeps the step the amount started with, so it cannot change under the finger', () => {
    // ₹1,300 steps by ₹10. Dragging far enough to pass ₹10,000 must not switch
    // to ₹100 mid-gesture, or the finger's distance stops meaning one thing.
    expect(scrub(130000n, POINTS_PER_STEP * 900, INR)).toBe(130000n + 900n * 1000n);
  });

  it('will not drag below nothing', () => {
    expect(scrub(1000n, -POINTS_PER_STEP * 50, INR)).toBe(0n);
  });
});

describe('the quick-add chips', () => {
  it('scale with the figure rather than being a fixed menu', () => {
    // A ₹9 chai steps by ₹1, so the chips are +₹5 / +₹10 / +₹50.
    expect(quickAdds(900n, INR)).toEqual([500n, 1000n, 5000n]);
    // A ₹1,300 dinner steps by ₹10, so they become +₹50 / +₹100 / +₹500.
    expect(quickAdds(130000n, INR)).toEqual([5000n, 10000n, 50000n]);
  });

  it('offers something on an empty sheet', () => {
    // Nothing typed yet still steps by one major unit, so the chips are the
    // small ones rather than nothing at all.
    expect(quickAdds(0n, INR)).toEqual([500n, 1000n, 5000n]);
  });

  it('follows the currency, not the number', () => {
    // ₫1,300,000 steps by ₫10,000 — the chips are three orders of magnitude
    // larger than the rupee ones and no table said so.
    expect(quickAdds(1300000n, VND)).toEqual([50000n, 100000n, 500000n]);
  });
});
