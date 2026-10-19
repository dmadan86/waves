import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  claimAll,
  claimsRecord,
  computeShares,
  draftToItemizedParams,
  hasSplittableItems,
  receiptToItemDraft,
  sumShares,
  unclaimedIndexes,
  type ParsedReceipt,
} from '../src/index.js';

const line = (label: string, total: number) => ({
  label,
  qty: 1,
  unitPrice: null,
  total,
  confidence: 0.95,
});

const receipt = (over: Partial<ParsedReceipt> = {}): ParsedReceipt => ({
  merchant: 'Beach Shack',
  date: '2026-10-01',
  currency: 'INR',
  items: [line('Fish', 30000), line('Rice', 30000)],
  subtotal: 60000,
  taxes: [{ label: 'GST', amount: 6000 }],
  serviceCharge: null,
  tip: null,
  discounts: [],
  grandTotal: 66000,
  ...over,
});

const shares = (r: ReturnType<typeof computeShares>) =>
  Object.fromEntries([...r.entries()].sort(([a], [b]) => a.localeCompare(b)));

describe('receipt to item draft', () => {
  it('lists priced lines, charges and reconciles with the printed total', () => {
    const draft = receiptToItemDraft(receipt());
    expect(draft.items.map((i) => i.total)).toEqual([30000n, 30000n]);
    expect(draft.taxes).toBe(6000n);
    expect(draft.total).toBe(66000n);
    expect(draft.reconciles).toBe(true);
    expect(unclaimedIndexes(draft.items)).toEqual([0, 1]);
  });

  it('offers a split only when there is a priced line', () => {
    expect(hasSplittableItems(receipt())).toBe(true);
    expect(hasSplittableItems(receipt({ items: [] }))).toBe(false);
    expect(hasSplittableItems(receipt({ items: [line('Free', 0)] }))).toBe(false);
    expect(hasSplittableItems(null)).toBe(false);
  });

  it('turns a negative printed line into a discount and flags a mismatch', () => {
    const draft = receiptToItemDraft(
      receipt({
        items: [line('Fish', 30000), line('Coupon', -5000)],
        taxes: [],
        grandTotal: 25000,
      }),
    );
    expect(draft.items).toHaveLength(1);
    expect(draft.discounts).toBe(5000n);
    expect(draft.reconciles).toBe(true);
    expect(receiptToItemDraft(receipt({ grandTotal: 1 })).reconciles).toBe(false);
  });

  it('keeps service charge and tip separate and ignores fractional amounts', () => {
    const draft = receiptToItemDraft(
      receipt({ serviceCharge: 500, tip: 250, items: [line('A', 100), line('B', 10.5)] }),
    );
    expect(draft.items).toHaveLength(1);
    expect(draft.serviceCharge).toBe(500n);
    expect(draft.tip).toBe(250n);
  });

  it('splits a claimed draft exactly (claimAll then compute)', () => {
    const draft = claimAll(receiptToItemDraft(receipt()), ['a', 'b']);
    const result = computeShares({
      amount: draft.total,
      currency: 'INR',
      params: draftToItemizedParams(draft),
      participants: ['a', 'b'],
      seed: 'x',
    });
    expect(shares(result)).toEqual({ a: 33000n, b: 33000n });
    expect(claimsRecord(draft.items)[0]).toEqual(['a', 'b']);
  });
});

const split = (amount: bigint, participants: string[], currency = 'INR', seed = 'e1') =>
  computeShares({ amount, currency, params: { kind: 'equal' }, participants, seed });

describe('IS itemised split rounding', () => {
  it('IS-01 100.00 across 3 equal sums to the total with one extra minor', () => {
    const r = split(10000n, ['a', 'b', 'c']);
    expect(sumShares(r)).toBe(10000n);
    expect([...r.values()].sort()).toEqual([3333n, 3333n, 3334n]);
  });

  it('IS-02 0.01 across 3 gives 1/0/0', () => {
    const r = split(1n, ['a', 'b', 'c']);
    expect([...r.values()].sort()).toEqual([0n, 0n, 1n]);
  });

  it('IS-03 JPY 100 across 3 gives 34/33/33', () => {
    const r = split(100n, ['a', 'b', 'c'], 'JPY');
    expect([...r.values()].sort()).toEqual([33n, 33n, 34n]);
  });

  it('IS-04 two 300 items and shared tax 60 split proportionally', () => {
    const r = computeShares({
      amount: 660n,
      currency: 'INR',
      participants: ['a', 'b'],
      seed: 's',
      params: {
        kind: 'itemized',
        items: [{ total: 300n }, { total: 300n }],
        claims: { 0: ['a'], 1: ['b'] },
        taxes: 60n,
      },
    });
    expect(shares(r)).toEqual({ a: 330n, b: 330n });
  });

  it('IS-05 an unclaimed item is an error, never silently the payer', () => {
    expect(() =>
      computeShares({
        amount: 100n,
        currency: 'INR',
        participants: ['a'],
        seed: 's',
        params: { kind: 'itemized', items: [{ total: 100n }], claims: {} },
      }),
    ).toThrow(/unclaimed/);
  });

  it('IS-06 an item claimed by two splits in halves, odd minor deterministic', () => {
    const run = () =>
      computeShares({
        amount: 101n,
        currency: 'INR',
        participants: ['b', 'a'],
        seed: 'same',
        params: { kind: 'itemized', items: [{ total: 101n }], claims: { 0: ['b', 'a'] } },
      });
    const first = shares(run());
    expect(first).toEqual(shares(run()));
    expect(Object.values(first).sort()).toEqual([50n, 51n]);
    const even = computeShares({
      amount: 100n,
      currency: 'INR',
      participants: ['a', 'b'],
      seed: 'same',
      params: { kind: 'itemized', items: [{ total: 100n }], claims: { 0: ['a', 'b'] } },
    });
    expect(shares(even)).toEqual({ a: 50n, b: 50n });
  });

  it('IS-07 tip of 10 percent on 999 distributes 100 minor with sum invariant', () => {
    const r = computeShares({
      amount: 1099n,
      currency: 'INR',
      participants: ['a', 'b', 'c'],
      seed: 's',
      params: {
        kind: 'itemized',
        items: [{ total: 333n }, { total: 333n }, { total: 333n }],
        claims: { 0: ['a'], 1: ['b'], 2: ['c'] },
        tip: 100n,
      },
    });
    expect(sumShares(r)).toBe(1099n);
    expect([...r.values()].every((v) => v >= 333n)).toBe(true);
  });

  it('IS-08 a discount of 50 is taken proportionally', () => {
    const r = computeShares({
      amount: 550n,
      currency: 'INR',
      participants: ['a', 'b'],
      seed: 's',
      params: {
        kind: 'itemized',
        items: [{ total: 200n }, { total: 400n }],
        claims: { 0: ['a'], 1: ['b'] },
        discounts: 50n,
      },
    });
    expect(sumShares(r)).toBe(550n);
    const got = shares(r);
    // exact 183.33 / 366.67: within one minor unit, never a different person's discount
    expect(Number(got.a)).toBeGreaterThanOrEqual(183);
    expect(Number(got.a)).toBeLessThanOrEqual(184);
  });

  it('IS-09 shares sum to the total, are non-negative and within one minor of exact', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5_000_000 }),
        fc.integer({ min: 1, max: 9 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        (total, n, seed) => {
          const members = Array.from({ length: n }, (_, i) => `m${i}`);
          const r = split(BigInt(total), members, 'INR', seed);
          expect(sumShares(r)).toBe(BigInt(total));
          for (const v of r.values()) {
            expect(v >= 0n).toBe(true);
            const diff = Number(v) - total / n;
            expect(Math.abs(diff)).toBeLessThan(1);
          }
        },
      ),
    );
  });

  it('IS-10 percent 33.33/33.33/33.34 sums to the total', () => {
    const r = computeShares({
      amount: 10001n,
      currency: 'INR',
      participants: ['a', 'b', 'c'],
      seed: 's',
      params: { kind: 'percent', basisPoints: { a: 3333, b: 3333, c: 3334 } },
    });
    expect(sumShares(r)).toBe(10001n);
  });

  it('IS-11 shares 1:2:3 on 600 and on 601 (remainder rotation)', () => {
    const run = (amount: bigint) =>
      computeShares({
        amount,
        currency: 'INR',
        participants: ['a', 'b', 'c'],
        seed: 's',
        params: { kind: 'shares', weights: { a: 1, b: 2, c: 3 } },
      });
    expect(shares(run(600n))).toEqual({ a: 100n, b: 200n, c: 300n });
    const odd = shares(run(601n));
    // the engine rotates the odd minor by seed (ADR-009), so assert the invariant
    expect(sumShares(run(601n))).toBe(601n);
    expect(odd.a).toBe(100n);
    expect([odd.b, odd.c]).toContainEqual(expect.any(BigInt));
    expect(Number(odd.b) - 200).toBeLessThanOrEqual(1);
    expect(Number(odd.c) - 300).toBeLessThanOrEqual(1);
    expect(shares(run(601n))).toEqual(odd);
  });

  it('IS-12 exact mode must sum to the total', () => {
    expect(() =>
      computeShares({
        amount: 100n,
        currency: 'INR',
        participants: ['a', 'b'],
        seed: 's',
        params: { kind: 'exact', amounts: { a: 60n, b: 30n } },
      }),
    ).toThrow();
  });

  it('IS-13 recomputing for a new participant list keeps the total and the payer whole', () => {
    const before = split(9000n, ['a', 'b', 'c']);
    const after = split(9000n, ['a', 'b']);
    expect(sumShares(before)).toBe(9000n);
    expect(shares(after)).toEqual({ a: 4500n, b: 4500n });
  });

  it('IS-14 a zero line is ignored by the draft and a negative line is refused by the split', () => {
    const draft = receiptToItemDraft(
      receipt({ items: [line('Zero', 0), line('Fish', 500)], taxes: [], grandTotal: 500 }),
    );
    expect(draft.items.map((i) => i.label)).toEqual(['Fish']);
    expect(() =>
      computeShares({
        amount: 100n,
        currency: 'INR',
        participants: ['a'],
        seed: 's',
        params: { kind: 'itemized', items: [{ total: -100n }], claims: { 0: ['a'] } },
      }),
    ).toThrow(/negative/);
  });
});
