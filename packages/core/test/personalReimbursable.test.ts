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
