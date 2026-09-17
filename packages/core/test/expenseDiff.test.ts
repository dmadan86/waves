/**
 * What counts as a change to an expense.
 *
 * These rules are now read by two clients, so the cases that matter are the
 * ones where a naive comparison says "nothing happened" about an edit somebody
 * really made: money moved between payers without the total changing, a
 * participant swapped for another, a pin renamed, a bill re-denominated.
 */

import { describe, expect, it } from 'vitest';

import { diffExpenseVersions, type DiffVersion } from '../src/expense/diff';

const ASHA = '11111111-1111-1111-1111-111111111111';
const RAVI = '22222222-2222-2222-2222-222222222222';
const MEERA = '33333333-3333-3333-3333-333333333333';

function version(over: Partial<DiffVersion> = {}): DiffVersion {
  return {
    amount: '100000',
    currency: 'INR',
    description: 'Dinner',
    category: 'food',
    category_meta: null,
    split_type: 'equal',
    expense_date: '2026-09-01',
    location: null,
    payers: [{ member_id: ASHA, amount: '100000' }],
    shares: [
      { member_id: ASHA, amount: '50000' },
      { member_id: RAVI, amount: '50000' },
    ],
    ...over,
  };
}

/** The fields a diff touched, in order. */
const fields = (changes: ReturnType<typeof diffExpenseVersions>) =>
  changes.map((change) => change.field);

describe('diffExpenseVersions', () => {
  it('says nothing about two identical versions', () => {
    expect(diffExpenseVersions(version(), version(), ASHA)).toEqual([]);
  });

  it('leads with the reader own stake, then the bill', () => {
    const before = version();
    const after = version({
      amount: '200000',
      shares: [
        { member_id: ASHA, amount: '100000' },
        { member_id: RAVI, amount: '100000' },
      ],
      payers: [{ member_id: ASHA, amount: '200000' }],
    });

    expect(fields(diffExpenseVersions(before, after, ASHA))).toEqual(['stake', 'amount', 'payers']);
  });

  it('leaves the stake line out for somebody the bill does not involve', () => {
    const before = version();
    const after = version({ amount: '200000', payers: [{ member_id: ASHA, amount: '200000' }] });

    // Meera is on neither side, so there is no "your share" to report — and a
    // zero would read as "square on this one", which is a different sentence.
    expect(fields(diffExpenseVersions(before, after, MEERA))).not.toContain('stake');
    expect(fields(diffExpenseVersions(before, after, null))).not.toContain('stake');
  });

  it('counts a re-denomination as a change to both the amount and the stake', () => {
    const before = version();
    const after = version({ currency: 'USD' });

    // Same minor units, different money. Comparing the numbers alone would call
    // ₹1,000 becoming $1,000 no change at all.
    const changes = diffExpenseVersions(before, after, ASHA);
    expect(fields(changes)).toEqual(['stake', 'amount']);
    const amount = changes.find((change) => change.field === 'amount');
    expect(amount).toMatchObject({ oldCurrency: 'INR', newCurrency: 'USD' });
  });

  it('does not hand a re-denomination to somebody with no stake in it', () => {
    const changes = diffExpenseVersions(version(), version({ currency: 'USD' }), MEERA);
    expect(fields(changes)).toEqual(['amount']);
  });

  it('notices money moving between payers on an unchanged total', () => {
    const before = version();
    const after = version({
      payers: [
        { member_id: ASHA, amount: '60000' },
        { member_id: RAVI, amount: '40000' },
      ],
    });

    // The total never moves, and for Asha the stake does — but the payer line
    // is the one that records what actually happened.
    expect(fields(diffExpenseVersions(before, after, MEERA))).toEqual(['payers']);
  });

  it('notices one participant swapped for another', () => {
    const before = version();
    const after = version({
      shares: [
        { member_id: ASHA, amount: '50000' },
        { member_id: MEERA, amount: '50000' },
      ],
    });

    // The count is the same on both sides; only the names changed.
    expect(fields(diffExpenseVersions(before, after, ASHA))).toEqual(['participants']);
  });

  it('trims a description before comparing it', () => {
    expect(diffExpenseVersions(version(), version({ description: '  Dinner  ' }), ASHA)).toEqual(
      [],
    );
    expect(fields(diffExpenseVersions(version(), version({ description: 'Lunch' }), ASHA))).toEqual(
      ['description'],
    );
  });

  it('treats an emptied description as a change, carrying the empty end', () => {
    const changes = diffExpenseVersions(version(), version({ description: '' }), ASHA);
    expect(changes).toEqual([
      { field: 'description', kind: 'text', oldText: 'Dinner', newText: '' },
    ]);
  });

  it('notices a custom tag renamed under an unchanged code', () => {
    const before = version({ category: 'tag:1', category_meta: { label: 'Chai' } });
    const after = version({ category: 'tag:1', category_meta: { label: 'Coffee' } });

    expect(diffExpenseVersions(before, after, ASHA)).toEqual([
      {
        field: 'category',
        kind: 'category',
        oldCategory: 'tag:1',
        newCategory: 'tag:1',
        oldLabel: 'Chai',
        newLabel: 'Coffee',
      },
    ]);
  });

  it('notices a pin renamed where it did not move', () => {
    const before = version({ location: { lat: 12.97, lng: 77.59, name: 'Koshy' } });
    const after = version({ location: { lat: 12.97, lng: 77.59, name: "Koshy's" } });

    expect(fields(diffExpenseVersions(before, after, ASHA))).toEqual(['location']);
  });

  it('notices a pin moved under an unchanged name, and one removed', () => {
    const koshy = version({ location: { lat: 12.97, lng: 77.59, name: 'Koshy' } });
    const elsewhere = version({ location: { lat: 13.01, lng: 77.6, name: 'Koshy' } });

    expect(fields(diffExpenseVersions(koshy, elsewhere, ASHA))).toEqual(['location']);
    expect(diffExpenseVersions(koshy, version(), ASHA)).toEqual([
      {
        field: 'location',
        kind: 'location',
        oldLocation: { lat: 12.97, lng: 77.59, name: 'Koshy' },
        newLocation: null,
      },
    ]);
  });

  it('reads an amount whether it arrives as a string or a bigint', () => {
    expect(diffExpenseVersions(version(), version({ amount: 100000n }), MEERA)).toEqual([]);
  });

  it('reports the split method changing on its own', () => {
    expect(fields(diffExpenseVersions(version(), version({ split_type: 'exact' }), ASHA))).toEqual([
      'split',
    ]);
  });

  it('reports the expense date changing', () => {
    expect(
      fields(diffExpenseVersions(version(), version({ expense_date: '2026-08-30' }), ASHA)),
    ).toEqual(['date']);
  });
});
