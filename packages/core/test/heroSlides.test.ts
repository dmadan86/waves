/**
 * The dashboard hero's balance deck (`balanceDeckSlides`).
 *
 * Reported as "the net receivable number is the same as the receivable number
 * — why do we show both?". It was: with nothing owing, `net = owed − 0 = owed`,
 * so the first two slides were one figure under two labels. These tests pin the
 * rule that replaced the fixed deck — a gross slide only when the net is
 * actually hiding one — and pin it against `totalsByCurrency`, so the inputs
 * are the same shape the home screen really feeds it.
 */

import { describe, expect, it } from 'vitest';

import { balanceDeckSlides, totalsByCurrency, type CurrencyTotals } from '../src/index.js';

const INR = 'INR';

/** The totals for one currency, built the way `useHomeSummary` builds them. */
function totalsOf(...groupBalances: bigint[]): CurrencyTotals {
  const totals = totalsByCurrency(groupBalances.map((balance) => [INR, balance] as const));
  return totals[0] ?? { currency: INR, net: 0n, owed: 0n, owing: 0n };
}

describe('balanceDeckSlides', () => {
  it('drops the gross slide when you are only ever owed — the reported duplicate', () => {
    // Two groups, both in your favour: ₹500 and ₹300.
    const totals = totalsOf(50000n, 30000n);
    // The duplication itself: with nothing owing, the two figures are one figure.
    expect(totals.owed).toBe(80000n);
    expect(totals.owing).toBe(0n);
    expect(totals.net).toBe(totals.owed);

    expect(balanceDeckSlides(totals)).toEqual(['net', 'month']);
  });

  it('drops it just the same when you only ever owe', () => {
    const totals = totalsOf(-20000n, -5000n);
    expect(totals.net).toBe(-totals.owing);
    expect(balanceDeckSlides(totals)).toEqual(['net', 'month']);
  });

  it('someone with no groups at all gets the plain two', () => {
    expect(balanceDeckSlides(totalsOf())).toEqual(['net', 'month']);
  });

  it('up overall but still owing somebody: the deck shows what you owe', () => {
    // Owed ₹500 in one group, owing ₹200 in another → net ₹300. The headline
    // alone would never mention the ₹200.
    const totals = totalsOf(50000n, -20000n);
    expect(totals).toMatchObject({ net: 30000n, owed: 50000n, owing: 20000n });
    expect(balanceDeckSlides(totals)).toEqual(['net', 'owing', 'month']);
  });

  it('down overall but still owed: the deck shows what is coming to you', () => {
    const totals = totalsOf(30000n, -50000n);
    expect(totals).toMatchObject({ net: -20000n, owed: 30000n, owing: 50000n });
    expect(balanceDeckSlides(totals)).toEqual(['net', 'owed', 'month']);
  });

  it('a net of zero with money moving both ways still gets a gross slide', () => {
    // "All settled ₹0" is true and tells you nothing: ₹500 is owed to you and
    // ₹500 by you. The gross beside it is the only thing that says so.
    const totals = totalsOf(50000n, -50000n);
    expect(totals).toMatchObject({ net: 0n, owed: 50000n, owing: 50000n });
    expect(balanceDeckSlides(totals)).toEqual(['net', 'owed', 'month']);
  });

  it('never puts the same figure on the net and gross slides by construction', () => {
    // The one guarantee: over every arrangement of a lender and a borrower, a
    // gross slide appears only where it is the side the net omits — so the pair
    // can only ever coincide by arithmetic accident (owed ₹400 over owing ₹200),
    // never because one is defined as the other.
    for (let owed = 0; owed <= 6; owed += 1) {
      for (let owing = 0; owing <= 6; owing += 1) {
        const totals = totalsOf(BigInt(owed) * 100n, -BigInt(owing) * 100n);
        const deck = balanceDeckSlides(totals);
        const gross = deck.find((slide) => slide === 'owed' || slide === 'owing');
        if (gross === undefined) {
          // No gross slide means one side is empty — i.e. the net already is it.
          expect(totals.owed === 0n || totals.owing === 0n).toBe(true);
          continue;
        }
        // The slide shown is the side the net figure hides, never the side it
        // already leads with.
        expect(gross).toBe(totals.net > 0n ? 'owing' : 'owed');
        const shown = gross === 'owed' ? totals.owed : totals.owing;
        expect(shown).toBeGreaterThan(0n);
      }
    }
  });

  it('reads one currency, never a mixture (ADR-004)', () => {
    // Rupees in your favour, dollars against you. `totalsByCurrency` keeps them
    // apart, so each currency's deck is decided on its own totals — the INR
    // headline must not sprout a gross slide because of a USD debt.
    const totals = totalsByCurrency([
      ['INR', 50000n],
      ['USD', -4000n],
    ] as const);
    const inr = totals.find((entry) => entry.currency === 'INR');
    const usd = totals.find((entry) => entry.currency === 'USD');
    expect(inr && balanceDeckSlides(inr)).toEqual(['net', 'month']);
    expect(usd && balanceDeckSlides(usd)).toEqual(['net', 'month']);
  });
});
