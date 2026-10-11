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

  it('leaves a doubled bill to the amount line rather than restating it', () => {
    const before = version();
    const after = version({
      amount: '200000',
      payers: [{ member_id: ASHA, amount: '200000' }],
      shares: [
        { member_id: ASHA, amount: '100000' },
        { member_id: RAVI, amount: '100000' },
      ],
    });

    // Every share moves when the total does, on an equal split. Saying so again
    // under "split between" only repeats the amount line in more words.
    expect(fields(diffExpenseVersions(before, after, MEERA))).toEqual(['amount', 'payers']);
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

  it('notices a reallocation between the same participants', () => {
    const before = version();
    const after = version({
      shares: [
        { member_id: ASHA, amount: '60000' },
        { member_id: RAVI, amount: '40000' },
      ],
    });

    // The total is untouched, so there is no amount line, and the set of names
    // is untouched, so comparing names alone found nothing at all. For Meera,
    // who is on neither side of this bill, that left the audit empty about
    // somebody's share moving by ₹100.
    const changes = diffExpenseVersions(before, after, MEERA);
    expect(fields(changes)).toEqual(['participants']);
    expect(changes[0]).toMatchObject({
      membersChanged: false,
      oldShares: [
        { member_id: ASHA, amount: '50000' },
        { member_id: RAVI, amount: '50000' },
      ],
      newShares: [
        { member_id: ASHA, amount: '60000' },
        { member_id: RAVI, amount: '40000' },
      ],
    });
  });

  it('separates a changed set of people from a changed allocation', () => {
    const swapped = version({
      shares: [
        { member_id: ASHA, amount: '50000' },
        { member_id: MEERA, amount: '50000' },
      ],
    });

    // Both are edits to the split, but they read differently: one is a list of
    // names, the other is only legible with the figures beside them.
    const changes = diffExpenseVersions(version(), swapped, ASHA);
    expect(changes.find((change) => change.field === 'participants')).toMatchObject({
      membersChanged: true,
    });
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
  describe('columns the audit used to ignore', () => {
    it('produces no new lines for a version without the optional fields', () => {
      // The browser reads a narrower projection; absent must mean "not asked",
      // never "changed to nothing".
      expect(diffExpenseVersions(version(), version({ description: 'Dinner' }), ASHA)).toEqual([]);
      expect(
        diffExpenseVersions(version(), version({ notes: 'hello', payment_method: 'cash' }), ASHA),
      ).toEqual([]);
    });

    it('reports notes changing, trimmed', () => {
      const changes = diffExpenseVersions(
        version({ notes: null }),
        version({ notes: ' Birthday ' }),
        ASHA,
      );
      expect(changes).toEqual([{ field: 'notes', kind: 'text', oldText: '', newText: 'Birthday' }]);
      expect(diffExpenseVersions(version({ notes: '' }), version({ notes: null }), ASHA)).toEqual(
        [],
      );
    });

    it('reports "Paid to" being set, changed and cleared, and only when both sides carry it', () => {
      expect(
        diffExpenseVersions(version({ payee: null }), version({ payee: ' Car rental ' }), ASHA),
      ).toEqual([{ field: 'payee', kind: 'text', oldText: '', newText: 'Car rental' }]);
      expect(
        fields(
          diffExpenseVersions(version({ payee: 'Landlord' }), version({ payee: 'Maid' }), ASHA),
        ),
      ).toEqual(['payee']);
      expect(
        diffExpenseVersions(version({ payee: 'Landlord' }), version({ payee: null }), ASHA),
      ).toEqual([{ field: 'payee', kind: 'text', oldText: 'Landlord', newText: '' }]);
      // Blank and null are the same "none"; extra spaces are not an edit.
      expect(diffExpenseVersions(version({ payee: '' }), version({ payee: null }), ASHA)).toEqual(
        [],
      );
      expect(
        diffExpenseVersions(
          version({ payee: 'Car  rental' }),
          version({ payee: 'Car rental' }),
          ASHA,
        ),
      ).toEqual([]);
      // A projection that never read the column says nothing about it.
      expect(diffExpenseVersions(version(), version({ payee: 'Landlord' }), ASHA)).toEqual([]);
    });

    it('reports the payment method changing', () => {
      expect(
        diffExpenseVersions(
          version({ payment_method: null }),
          version({ payment_method: 'upi' }),
          ASHA,
        ),
      ).toEqual([
        { field: 'paymentMethod', kind: 'paymentMethod', oldMethod: null, newMethod: 'upi' },
      ]);
    });

    it('treats null -> cash as the editor default, not a change', () => {
      expect(
        diffExpenseVersions(
          version({ payment_method: null }),
          version({ payment_method: 'cash' }),
          ASHA,
        ),
      ).toEqual([]);
      expect(
        fields(
          diffExpenseVersions(
            version({ payment_method: 'cash' }),
            version({ payment_method: null }),
            ASHA,
          ),
        ),
      ).toEqual(['paymentMethod']);
    });

    it('does not report a time change when only the date moved', () => {
      expect(
        diffExpenseVersions(
          version({ occurred_at: '2026-09-01T14:00:00Z' }),
          version({ occurred_at: '2026-09-03T14:00:00Z' }),
          ASHA,
        ),
      ).toEqual([]);
    });

    it('carries each side currency on a deposit change', () => {
      const dep = { is_deposit: true, balance_due_minor: '500000', balance_due_date: null };
      const changes = diffExpenseVersions(
        version({ ...dep, currency: 'INR' }),
        version({ ...dep, currency: 'USD', amount: '1000' }),
        ASHA,
      );
      const change = changes.find((c) => c.field === 'deposit');
      expect(change).toBeUndefined();
      const moved = diffExpenseVersions(
        version({ ...dep, currency: 'INR' }),
        version({ ...dep, currency: 'USD', balance_due_minor: '600000' }),
        ASHA,
      ).find((c) => c.field === 'deposit');
      expect(moved).toMatchObject({ oldCurrency: 'INR', newCurrency: 'USD' });
    });

    it('reports the time of day, ignoring how the same instant is spelled', () => {
      const a = version({ occurred_at: '2026-09-01T12:00:00+00:00' });
      expect(
        diffExpenseVersions(a, version({ occurred_at: '2026-09-01T12:00:00.000Z' }), ASHA),
      ).toEqual([]);
      expect(
        diffExpenseVersions(a, version({ occurred_at: '2026-09-01T19:30:00Z' }), ASHA),
      ).toEqual([
        {
          field: 'time',
          kind: 'time',
          oldIso: '2026-09-01T12:00:00+00:00',
          newIso: '2026-09-01T19:30:00Z',
        },
      ]);
    });

    it('reports a receipt added, removed and replaced', () => {
      const none = version({ receipt_id: null });
      const one = version({ receipt_id: 'r1' });
      const two = version({ receipt_id: 'r2' });
      expect(diffExpenseVersions(none, one, ASHA)).toEqual([
        {
          field: 'receipt',
          kind: 'receipt',
          oldHasReceipt: false,
          newHasReceipt: true,
          replaced: false,
        },
      ]);
      expect(diffExpenseVersions(one, none, ASHA)).toEqual([
        {
          field: 'receipt',
          kind: 'receipt',
          oldHasReceipt: true,
          newHasReceipt: false,
          replaced: false,
        },
      ]);
      expect(diffExpenseVersions(one, two, ASHA)).toEqual([
        {
          field: 'receipt',
          kind: 'receipt',
          oldHasReceipt: true,
          newHasReceipt: true,
          replaced: true,
        },
      ]);
      expect(diffExpenseVersions(one, one, ASHA)).toEqual([]);
    });

    it('reports deposit flag, balance and due date as one change', () => {
      const before = version({
        is_deposit: false,
        balance_due_minor: null,
        balance_due_date: null,
      });
      const after = version({
        is_deposit: true,
        balance_due_minor: '500000',
        balance_due_date: '2026-11-01',
      });
      expect(diffExpenseVersions(before, after, ASHA)).toEqual([
        {
          field: 'deposit',
          kind: 'deposit',
          oldDeposit: { isDeposit: false, balanceDueMinor: null, balanceDueDate: null },
          newDeposit: { isDeposit: true, balanceDueMinor: 500000n, balanceDueDate: '2026-11-01' },
          oldCurrency: 'INR',
          newCurrency: 'INR',
        },
      ]);
      // Only the date moving is still the one change.
      expect(
        fields(diffExpenseVersions(after, { ...after, balance_due_date: '2026-12-01' }, ASHA)),
      ).toEqual(['deposit']);
    });

    it('reports the sub-event changing', () => {
      expect(
        diffExpenseVersions(
          version({ sub_event_id: null }),
          version({ sub_event_id: 'sangeet' }),
          ASHA,
        ),
      ).toEqual([{ field: 'subEvent', kind: 'subEvent', oldId: null, newId: 'sangeet' }]);
    });

    it('reports split details moving while type and shares held still', () => {
      const before = version({ split_type: 'percent', split_params: { a: 50, b: 50 } });
      // Key order differs but the content is the same: not a change.
      expect(
        diffExpenseVersions(
          before,
          version({ split_type: 'percent', split_params: { b: 50, a: 50 } }),
          ASHA,
        ),
      ).toEqual([]);
      expect(
        diffExpenseVersions(
          before,
          version({ split_type: 'percent', split_params: { a: 50.0001, b: 49.9999 } }),
          ASHA,
        ),
      ).toEqual([{ field: 'splitDetails', kind: 'splitDetails' }]);
    });

    it('treats 5000 and "5000" split params as the same', () => {
      const before = version({ split_type: 'exact', split_params: { a: 5000, b: '2500' } });
      const after = version({ split_type: 'exact', split_params: { a: '5000', b: 2500 } });
      expect(diffExpenseVersions(before, after, ASHA)).toEqual([]);
    });

    it('does not repeat split details when the shares already show the edit', () => {
      const before = version({ split_type: 'percent', split_params: { a: 50, b: 50 } });
      const after = version({
        split_type: 'percent',
        split_params: { a: 60, b: 40 },
        shares: [
          { member_id: ASHA, amount: '60000' },
          { member_id: RAVI, amount: '40000' },
        ],
      });
      expect(fields(diffExpenseVersions(before, after, MEERA))).toEqual(['participants']);
    });
  });
});
