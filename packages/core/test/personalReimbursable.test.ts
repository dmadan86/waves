import { describe, expect, it } from 'vitest';

import { decodeTxn, encodeTxn } from '../src/personal/types';

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
    expect('reimbursable' in plain).toBe(false);
    expect('place' in plain).toBe(false);
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
  it('is written only when set and round-trips', () => {
    expect('receiptKey' in encodeTxn(base)).toBe(false);
    expect('receiptKey' in encodeTxn({ ...base, receiptKey: null })).toBe(false);
    const data = encodeTxn({ ...base, receiptKey: key });
    expect(data.receiptKey).toBe(key);
    expect(decodeTxn('t', data).receiptKey).toBe(key);
    expect(decodeTxn('t', encodeTxn(base)).receiptKey).toBeUndefined();
  });
  it('survives an edit that rebuilds the blob, and clears when removed', () => {
    const decoded = decodeTxn('t', encodeTxn({ ...base, receiptKey: key }));
    expect(encodeTxn({ ...decoded, note: 'edited' }).receiptKey).toBe(key);
    expect('receiptKey' in encodeTxn({ ...decoded, receiptKey: null })).toBe(false);
    expect(decoded.carried).toBeUndefined();
  });
  it('an older app that does not know the field keeps it through carried', () => {
    const blob = { ...encodeTxn(base), receiptKey: key, futureField: 1 };
    const decoded = decodeTxn('t', blob);
    expect(decoded.carried).toEqual({ futureField: 1 });
  });
});
