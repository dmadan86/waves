import { describe, expect, it } from 'vitest';

import { decodeTxn, encodeTxn } from '../src/personal/types';
import { adoptUnstampedEdits, mergeFields, stampFields } from '../src/sync/lww';

const base = {
  kind: 'expense' as const,
  amount: 5000n,
  currency: 'INR',
  category: 'travel',
  note: 'train',
  date: '2026-10-19',
  loanId: null,
  recurringId: null,
};

describe('personal txn: reimbursable and place', () => {
  it('round-trips, and is absent from an entry that never had them', () => {
    const plain = encodeTxn(base);
    expect(plain.reimbursable).toBe(false);
    expect(plain.place).toBeNull();
    const full = decodeTxn('t', encodeTxn({ ...base, reimbursable: true, place: 'Taj' }));
    expect(full).toMatchObject({ reimbursable: true, place: 'Taj' });
    expect(decodeTxn('t', plain).reimbursable).toBeUndefined();
  });
  it('an older app keeps them through carried', () => {
    const data = encodeTxn({ ...base, reimbursable: true, place: 'Taj' });
    const edited = encodeTxn({ ...decodeTxn('t', data), note: 'edited' });
    expect(edited.reimbursable).toBe(true);
    expect(edited.place).toBe('Taj');
  });
});

describe('personal txn: receiptKey', () => {
  const key = 'personal/user-1/t.jpg';
  it('writes null when cleared and round-trips', () => {
    expect(encodeTxn(base).receiptKey).toBeNull();
    expect(encodeTxn({ ...base, receiptKey: null }).receiptKey).toBeNull();
    const data = encodeTxn({ ...base, receiptKey: key });
    expect(data.receiptKey).toBe(key);
    expect(decodeTxn('t', data).receiptKey).toBe(key);
    expect(decodeTxn('t', encodeTxn(base)).receiptKey).toBeUndefined();
  });
  it('survives an edit that rebuilds the blob, and clears when removed', () => {
    const decoded = decodeTxn('t', encodeTxn({ ...base, receiptKey: key }));
    expect(encodeTxn({ ...decoded, note: 'edited' }).receiptKey).toBe(key);
    expect(encodeTxn({ ...decoded, receiptKey: null }).receiptKey).toBeNull();
    expect(decoded.carried).toBeUndefined();
  });
  it('an older app that does not know the field keeps it through carried', () => {
    const blob = { ...encodeTxn(base), receiptKey: key, futureField: 1 };
    const decoded = decodeTxn('t', blob);
    expect(decoded.carried).toEqual({ futureField: 1 });
  });
});

it('clears optional fields through encoding and the server merge', () => {
  const stored = stampFields(
    null,
    encodeTxn({
      ...base,
      place: 'Taj',
      paymentMethod: 'upi',
      reimbursable: true,
      receiptKey: 'old',
    }),
    { now: 100, deviceId: 'server' },
  );
  const incoming = encodeTxn({
    ...decodeTxn('t', stored),
    place: null,
    paymentMethod: null,
    reimbursable: false,
    receiptKey: null,
  });
  const adopted = adoptUnstampedEdits(stored, incoming, { now: 200, deviceId: 'server' });
  const merged = mergeFields(stored, adopted, { now: 200 });
  expect(merged).toMatchObject({
    place: null,
    paymentMethod: null,
    reimbursable: false,
    receiptKey: null,
  });
  const decoded = decodeTxn('t', merged);
  for (const field of ['place', 'paymentMethod', 'reimbursable', 'receiptKey'] as const)
    expect(decoded[field]).toBeUndefined();
});
