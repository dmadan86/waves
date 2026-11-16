/** Company spending (for working capital and caps): entries plus vendor payments, owner's view. */

import { useMemo } from 'react';

import { companySpendItems, type SpendItem } from '@waves/core';

import { useCompanyEntries } from '@/data/companyEntries';
import { useCompanyVendors } from '@/data/companyVendors';

export function useCompanySpend(groupId: string): SpendItem[] {
  const view = useCompanyEntries(groupId);
  const vendors = useCompanyVendors(groupId);
  return useMemo(
    () => (view.isOwner ? companySpendItems(view.entries, vendors.lines) : []),
    [view.isOwner, view.entries, vendors.lines],
  );
}
