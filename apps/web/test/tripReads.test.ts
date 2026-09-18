/**
 * What the two trip screens select out of the ledger.
 *
 * The recap's arithmetic is core's and tested there. What is tested here is the
 * selection, because that is where a trip screen goes wrong without looking
 * wrong: a deleted bill still counted, or "fronted the most" answered from the
 * shares instead of the payers — which names a real person and a real figure,
 * just not the one the screen claims to be showing.
 *
 * So the recap assertions run the real `recap` over what this module hands it,
 * rather than checking the intermediate shape: the question is what ends up on
 * the screen.
 */

import { describe, expect, it } from 'vitest';

import { recap } from '@waves/core';

import { placesOf, recapExpenses, type TripExpense } from '../src/lib/tripReads';

const ASHA = 'asha';
const RAVI = 'ravi';

/** One bill: who fronted it, and — when it has one — where. */
function bill(
  id: string,
  expense_date: string,
  amount: string,
  payers: [string, string][],
  extra: {
    deleted?: boolean;
    location?: { lat: number; lng: number; name?: string | null } | null;
    description?: string;
    category?: string | null;
    currency?: string;
  } = {},
): TripExpense {
  return {
    id,
    deleted_at: extra.deleted ? '2026-09-20T00:00:00Z' : null,
    currentVersion: {
      description: extra.description ?? id,
      category: extra.category ?? 'food',
      expense_date,
      amount,
      currency: extra.currency ?? 'INR',
      location: extra.location ?? null,
      payers: payers.map(([member_id, paid]) => ({ member_id, amount: paid })),
    },
  };
}

describe('recapExpenses', () => {
  it('reads who fronted the money, not who owes for it', () => {
    // Asha put in the whole 10,000. Were this read off the shares — which sum
    // to the same 10,000 — Ravi would tie her, and the tie-break would hand
    // "fronted the most" to whoever sorts first.
    const rows = recapExpenses([bill('a', '2026-09-03', '10000', [[ASHA, '10000']])]);
    const block = recap({ expenses: rows }).byCurrency[0]!;
    expect(block.topPayer).toEqual({ member: ASHA, paidMinor: 10000n });
  });

  it('adds every hand on a bill, not just the first', () => {
    const rows = recapExpenses([
      bill('a', '2026-09-03', '10000', [
        [ASHA, '4000'],
        [RAVI, '6000'],
      ]),
      bill('b', '2026-09-04', '3000', [[ASHA, '3000']]),
    ]);
    const block = recap({ expenses: rows }).byCurrency[0]!;
    // 7,000 to Ravi's 6,000 — only true if the second payer on bill 'a' counted.
    expect(block.topPayer).toEqual({ member: ASHA, paidMinor: 7000n });
    expect(block.totalMinor).toBe(13000n);
  });

  it('leaves out a deleted bill and one with no current version', () => {
    const rows = recapExpenses([
      bill('a', '2026-09-03', '10000', [[ASHA, '10000']]),
      bill('gone', '2026-09-03', '90000', [[RAVI, '90000']], { deleted: true }),
      { id: 'headless', deleted_at: null, currentVersion: null },
    ]);
    expect(rows.map((row) => row.id)).toEqual(['a']);
    expect(recap({ expenses: rows }).byCurrency[0]!.totalMinor).toBe(10000n);
  });

  it('keeps currencies apart, the way the ledger does', () => {
    const rows = recapExpenses([
      bill('a', '2026-09-03', '10000', [[ASHA, '10000']]),
      bill('b', '2026-09-04', '7000', [[RAVI, '7000']], { currency: 'THB' }),
    ]);
    const summary = recap({ expenses: rows });
    expect(summary.byCurrency.map((block) => block.currency)).toEqual(['INR', 'THB']);
    expect(summary.byCurrency.map((block) => block.totalMinor)).toEqual([10000n, 7000n]);
  });

  it('takes the day off the date string, so no timezone can move it', () => {
    const rows = recapExpenses([
      bill('a', '2026-09-01T23:30:00Z', '1000', [[ASHA, '1000']]),
      bill('b', '2026-09-05', '1000', [[ASHA, '1000']]),
    ]);
    const summary = recap({ expenses: rows });
    expect(summary.firstDay).toBe('2026-09-01');
    expect(summary.lastDay).toBe('2026-09-05');
  });
});

describe('placesOf', () => {
  const hotel = { lat: 15.2993, lng: 74.124, name: 'Hotel' };
  const beach = { lat: 15.55, lng: 73.75, name: null };

  it('keeps only what carries a location, newest day first', () => {
    const places = placesOf([
      bill('early', '2026-09-03', '10000', [[ASHA, '10000']], { location: hotel }),
      bill('nowhere', '2026-09-04', '2000', [[ASHA, '2000']]),
      bill('late', '2026-09-21', '3000', [[RAVI, '3000']], { location: beach }),
    ]);
    expect(places.map((place) => place.id)).toEqual(['late', 'early']);
    expect(places[0]!.location).toBe(beach);
    expect(places[0]!.amountMinor).toBe(3000n);
  });

  it('drops a deleted bill, so a place nobody went to is not listed', () => {
    const places = placesOf([
      bill('gone', '2026-09-03', '10000', [[ASHA, '10000']], { location: hotel, deleted: true }),
    ]);
    expect(places).toEqual([]);
  });

  it('orders by the stored date string rather than a parsed one', () => {
    // Two days either side of a month boundary: a reader east of the line
    // parsing these would flip them.
    const places = placesOf([
      bill('a', '2026-08-31', '1000', [[ASHA, '1000']], { location: hotel }),
      bill('b', '2026-09-01', '1000', [[ASHA, '1000']], { location: beach }),
    ]);
    expect(places.map((place) => place.id)).toEqual(['b', 'a']);
  });
});
