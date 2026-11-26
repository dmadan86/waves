import { describe, expect, it } from 'vitest';
import { recurringTxnLinks } from '../src/lib/recurringLinks';

describe('a posted rent or investment occurrence links to its parent', () => {
  const tenancies = [{ id: 'ten1', propertyId: 'prop1' }];

  it('rent from a tenancy carries the property, so deleting the property deletes it', () => {
    expect(recurringTxnLinks({ tenancyId: 'ten1', investmentId: null }, tenancies)).toEqual({
      propertyId: 'prop1',
    });
  });

  it('an investment contribution carries the investment', () => {
    expect(recurringTxnLinks({ investmentId: 'inv1', tenancyId: null }, tenancies)).toEqual({
      investmentId: 'inv1',
    });
  });

  it('a plain bill, or a tenancy not on this device yet, carries nothing extra', () => {
    expect(recurringTxnLinks({ investmentId: null, tenancyId: null }, tenancies)).toEqual({});
    expect(recurringTxnLinks({ investmentId: null, tenancyId: 'missing' }, tenancies)).toEqual({});
  });
});
