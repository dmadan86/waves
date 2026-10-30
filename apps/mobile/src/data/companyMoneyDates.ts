import { useMemo } from 'react';
import { deriveMoneyDates, type MoneyDate } from '@waves/core';

import { useCompanyEntries } from '@/data/companyEntries';
import { useCompanyVendors } from '@/data/companyVendors';
import { useCompanyDocs } from '@/data/companyDocuments';
import { todayIso } from '@/data/personal';
import { displayName } from '@/data/types';

/** Read-only calendar dates derived from the company data this viewer can already read. */
export function useMoneyDates(groupId: string): readonly MoneyDate[] {
  const view = useCompanyEntries(groupId);
  const vendors = useCompanyVendors(groupId);
  const docs = useCompanyDocs(groupId);
  return useMemo(() => {
    if (view.isVendor) return [];
    const people = view.members
      .filter((m) => m.role === 'member' && !m.left_at)
      .map((m) => ({
        id: m.id,
        name: displayName(m),
        currency: view.currency,
      }));
    return deriveMoneyDates(
      {
        currency: view.currency,
        entries: view.entries,
        people,
        vendors: vendors.vendors,
        vendorLines: vendors.lines,
        documents: docs.docs,
      },
      todayIso(),
    );
  }, [view, vendors.vendors, vendors.lines, docs.docs]);
}
