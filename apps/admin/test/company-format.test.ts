import { describe, expect, it } from 'vitest';
import { companyMoney, companyWhen } from '@/lib/company-format';

describe('Company metadata formatting', () => {
  it('formats minor units using the currency exponent', () => {
    expect(companyMoney(12345, 'INR')).toBe('₹123.45');
    expect(companyMoney(-1, 'INR')).toBe('-₹0.01');
    expect(companyMoney(123, 'JPY')).toBe('JP¥123');
    expect(companyMoney('1234', 'KWD')).toContain('1.234');
  });
  it('keeps bigint totals exact', () => {
    expect(companyMoney('9007199254740993123', 'INR')).toBe('₹90,07,19,92,54,74,09,931.23');
    expect(companyMoney('0', 'INR')).toBe('₹0.00');
  });
  it('shows missing activity as a dash', () => {
    expect(companyWhen(null)).toBe('—');
  });
});
