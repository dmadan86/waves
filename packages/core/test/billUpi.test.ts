import { describe, expect, it } from 'vitest';

import { billUpiLink, invalidDetailKeys, cleanDetails, isValidVpa } from '../src/company/index.js';

const base = {
  vpa: 'acme.shop@okhdfc',
  payeeName: 'Acme & Sons',
  totalMinor: 123450n,
  paidMinor: 0n,
  currency: 'INR',
  number: 7,
};

describe('billUpiLink', () => {
  it('encodes the exact amount due with two decimals', () => {
    expect(billUpiLink(base)).toBe(
      'upi://pay?pa=acme.shop%40okhdfc&pn=Acme%20%26%20Sons&am=1234.50&cu=INR&tn=BILL-0007',
    );
  });
  it('uses total minus paid', () => {
    expect(billUpiLink({ ...base, paidMinor: 100005n })).toContain('&am=234.45&');
    expect(billUpiLink({ ...base, totalMinor: 5n })).toContain('&am=0.05&');
  });
  it('is null for non-INR, nothing due, or a bad VPA', () => {
    expect(billUpiLink({ ...base, currency: 'USD' })).toBeNull();
    expect(billUpiLink({ ...base, paidMinor: 123450n })).toBeNull();
    expect(billUpiLink({ ...base, paidMinor: 999999n })).toBeNull();
    expect(billUpiLink({ ...base, vpa: 'nope' })).toBeNull();
  });
  it('falls back to the VPA when the name is blank', () => {
    expect(billUpiLink({ ...base, payeeName: '  ' })).toContain('pn=acme.shop%40okhdfc');
  });
});

describe('isValidVpa', () => {
  it('accepts and rejects', () => {
    for (const v of ['a1@ybl', 'ravi.k-2@okhdfcbank', 'x_y@paytm'])
      expect(isValidVpa(v)).toBe(true);
    for (const v of ['', 'a@b', '@ybl', 'ravi@', 'ra vi@ybl', 'a@1bank', 'ravi@@ybl'])
      expect(isValidVpa(v)).toBe(false);
  });
  it('is the rule for the company UPI detail', () => {
    expect(invalidDetailKeys(cleanDetails({ upi: 'bad' }))).toEqual(['upi']);
    expect(invalidDetailKeys(cleanDetails({ upi: 'ravi@okhdfc' }))).toEqual([]);
  });
});
