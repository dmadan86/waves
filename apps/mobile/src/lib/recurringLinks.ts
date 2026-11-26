import type { PersonalRecurring, PersonalTenancy } from '@waves/core';

/**
 * The parent links a posted occurrence carries, so deleting the investment or the property
 * deletes it too (linkedPersonalTxnIds). Rent rules hang off a tenancy; the entry needs that
 * tenancy's property.
 */
export function recurringTxnLinks(
  rule: Pick<PersonalRecurring, 'investmentId' | 'tenancyId'>,
  tenancies: readonly Pick<PersonalTenancy, 'id' | 'propertyId'>[],
): { investmentId?: string; propertyId?: string } {
  const propertyId = rule.tenancyId
    ? tenancies.find((tenancy) => tenancy.id === rule.tenancyId)?.propertyId
    : undefined;
  return {
    ...(rule.investmentId ? { investmentId: rule.investmentId } : {}),
    ...(propertyId ? { propertyId } : {}),
  };
}
