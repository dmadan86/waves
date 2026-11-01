import { describe, expect, it } from 'vitest';

import { parseVendorShare } from '../src/lib/vendorShare';

describe('parseVendorShare', () => {
  it('reads a UPI link', () => {
    expect(parseVendorShare('upi://pay?pa=9876543210@ybl&pn=Sri%20Traders')).toEqual({
      name: 'Sri Traders',
      phone: '9876543210',
    });
    expect(parseVendorShare('upi://pay?pa=shop@okhdfc&pn=Ravi+Stores')).toEqual({
      name: 'Ravi Stores',
    });
  });
  it('reads a phone', () => {
    expect(parseVendorShare('tel:+91 98765-43210')).toEqual({ phone: '+919876543210' });
    expect(parseVendorShare('98765 43210')).toEqual({ phone: '9876543210' });
  });
  it('refuses anything else', () => {
    expect(parseVendorShare('https://example.com')).toBeNull();
    expect(parseVendorShare('')).toBeNull();
  });
});
