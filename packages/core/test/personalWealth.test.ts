import { describe, expect, it } from 'vitest';

import {
  decodeInvestment,
  decodeProperty,
  decodeRecurring,
  decodeTenancy,
  decodeTxn,
  encodeInvestment,
  encodeProperty,
  encodeRecurring,
  encodeTenancy,
  encodeTxn,
} from '../src/personal/types';

describe('wealth codecs', () => {
  it('investment round-trips and carries unknown fields', () => {
    const blob = {
      type: 'fund',
      name: 'Index fund',
      currency: 'USD',
      openingInvested: '120000',
      openingAsOf: '2026-01-01',
      currentValue: '134500',
      valueAsOf: '2026-11-03',
      maturityDate: null,
      status: 'active',
      note: null,
      future: 1,
    };
    const rec = decodeInvestment('i', blob);
    expect(rec.openingInvested).toBe(120000n);
    expect(rec.carried).toEqual({ future: 1 });
    expect(encodeInvestment(rec)).toEqual(blob);
  });
  it('investment degrades garbage', () => {
    expect(decodeInvestment('i', { type: 'zzz', status: 'x' })).toMatchObject({
      type: 'other',
      status: 'active',
      currentValue: null,
      openingInvested: 0n,
    });
  });
  it('property round-trips', () => {
    const blob = {
      type: 'shop',
      name: 'Shop 2',
      locality: null,
      currency: 'INR',
      status: 'active',
      note: null,
    };
    expect(encodeProperty(decodeProperty('p', blob))).toEqual(blob);
  });
  it('tenancy round-trips and degrades', () => {
    const blob = {
      propertyId: 'p',
      unit: null,
      tenantName: 'Ravi',
      tenantPhone: null,
      depositHeld: '18000000',
      startDate: '2026-04-01',
      endDate: null,
      escalationPct: 5,
      status: 'active',
      endedOn: null,
      depositReturned: null,
      depositKept: null,
      note: null,
    };
    const rec = decodeTenancy('t', blob);
    expect(rec.depositHeld).toBe(18000000n);
    expect(rec.carried).toBeUndefined();
    expect(encodeTenancy(rec)).toEqual(blob);
    expect(decodeTenancy('t', { escalationPct: -2 }).escalationPct).toBeNull();
  });
  it('links on txn and recurring survive the round trip, without being carried', () => {
    const txn = decodeTxn('x', {
      kind: 'expense',
      amount: '10.00',
      investmentId: 'i',
      propertyId: 'p',
    });
    expect(txn).toMatchObject({ investmentId: 'i', propertyId: 'p', carried: undefined });
    expect(encodeTxn(txn)).toMatchObject({ investmentId: 'i', propertyId: 'p' });
    const rule = decodeRecurring('r', { tenancyId: 't', investmentId: 'i' });
    expect(rule.carried).toBeUndefined();
    expect(encodeRecurring(rule)).toMatchObject({ tenancyId: 't', investmentId: 'i' });
  });
});
