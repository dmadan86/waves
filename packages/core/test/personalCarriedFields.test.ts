/**
 * Forward compatibility of the personal-ledger codecs.
 *
 * The scenario every test here is really about: the same ledger open on two
 * phones, one of them a version behind. The old phone must be able to read,
 * edit and write back a record written by the new one WITHOUT deleting the
 * fields it has never heard of — because that deletion would be silent, would
 * reach every device, and would be caused by nothing worse than somebody not
 * having updated.
 *
 * `carried` is what makes that true, and these pin it.
 */

import { describe, expect, it } from 'vitest';

import {
  decodeBudget,
  decodeLoan,
  decodeRecurring,
  decodeTxn,
  encodeBudget,
  encodeLoan,
  encodeRecurring,
  encodeTxn,
} from '../src/personal/types';

/** A blob as a NEWER version of the app would have written it: everything this
 *  version knows, plus two fields it does not. */
const futureTxn = {
  kind: 'expense',
  amount: '649.00',
  currency: 'INR',
  category: 'entertainment',
  note: 'Netflix',
  date: '2026-09-22',
  loanId: null,
  recurringId: 'r1',
  // From a version that has not shipped here yet.
  subscriptionKind: 'subscription',
  merchantId: 'svc.netflix',
};

describe('carried fields', () => {
  it('keeps what it does not recognise', () => {
    const decoded = decodeTxn('t1', futureTxn);
    expect(decoded.carried).toEqual({
      subscriptionKind: 'subscription',
      merchantId: 'svc.netflix',
    });
  });

  it('writes the unrecognised fields back out', () => {
    const decoded = decodeTxn('t1', futureTxn);
    const reencoded = encodeTxn(decoded);
    expect(reencoded.subscriptionKind).toBe('subscription');
    expect(reencoded.merchantId).toBe('svc.netflix');
  });

  it('survives an edit made by the older version', () => {
    // The whole point: an old app opens a new record, changes one thing it DOES
    // understand, and saves. Nothing else may move.
    const decoded = decodeTxn('t1', futureTxn);
    const edited = { ...decoded, note: 'Netflix — shared with Ana' };
    const reencoded = encodeTxn(edited);

    expect(reencoded.note).toBe('Netflix — shared with Ana');
    expect(reencoded.subscriptionKind).toBe('subscription');
    expect(reencoded.merchantId).toBe('svc.netflix');
  });

  it('never lets a carried value shadow a field this version owns', () => {
    // A blob whose carried bag somehow holds a key the encoder also writes must
    // lose to the encoder. Carried-last would let stale data overwrite the edit
    // the person just made — the same bug arriving from the other direction.
    const decoded = decodeTxn('t1', futureTxn);
    const tampered = { ...decoded, carried: { ...decoded.carried, note: 'stale' } };
    expect(encodeTxn(tampered).note).toBe('Netflix');
  });

  it('adds nothing when there is nothing to carry', () => {
    const decoded = decodeTxn('t1', {
      kind: 'expense',
      amount: '10.00',
      currency: 'INR',
      date: '2026-09-22',
    });
    expect(decoded.carried).toBeUndefined();
    expect('carried' in encodeTxn(decoded)).toBe(false);
  });

  it('does not carry the row id back into the blob', () => {
    // `id` addresses the row, not the record. A copy inside `data` would be a
    // second, divergent id that nothing reads and everything could confuse.
    const decoded = decodeTxn('t1', { ...futureTxn, id: 'not-the-row-id' });
    expect(decoded.carried).not.toHaveProperty('id');
  });

  it('holds for every record kind, not just txns', () => {
    const extra = { somethingNew: 42 };

    const rule = decodeRecurring('r1', {
      txnKind: 'expense',
      amount: '649.00',
      cadence: 'monthly',
      anchorDate: '2026-01-22',
      ...extra,
    });
    expect(encodeRecurring(rule).somethingNew).toBe(42);

    const loan = decodeLoan('l1', {
      direction: 'lent',
      counterpart: 'Ana',
      principal: '5000.00',
      startDate: '2026-01-01',
      ...extra,
    });
    expect(encodeLoan(loan).somethingNew).toBe(42);

    const budget = decodeBudget('b1', { category: 'food', limit: '8000.00', ...extra });
    expect(encodeBudget(budget).somethingNew).toBe(42);
  });

  it('round-trips repeatedly without drift', () => {
    // Three hops between versions must be identical to one. If carrying were
    // lossy or additive this is where it would show.
    let blob: Record<string, unknown> = futureTxn;
    for (let i = 0; i < 3; i += 1) blob = encodeTxn(decodeTxn('t1', blob));
    expect(blob).toEqual(encodeTxn(decodeTxn('t1', futureTxn)));
  });
});
