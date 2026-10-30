import { useMemo } from 'react';
import { deriveMoneyDates, type MoneyDate } from '@waves/core';

import { useCompanyEntries } from '@/data/companyEntries';
import { useCompanyVendors } from '@/data/companyVendors';
import { useComingUp } from '@/data/companyOverview';
import { useCompanyDocs } from '@/data/companyDocuments';
import { todayIso } from '@/data/personal';
import { displayName } from '@/data/types';

/** Read-only calendar dates derived from the company data this viewer can already read. */
export function useMoneyDates(groupId: string): readonly MoneyDate[] {
  const view = useCompanyEntries(groupId);
  const vendors = useCompanyVendors(groupId);
  const docs = useCompanyDocs(groupId);
  const coming = useComingUp(groupId);
  return useMemo(() => {
    if (view.isVendor) return [];
    const people = view.members
      .filter((m) => m.role === 'member' && !m.left_at)
      .map((m) => ({
        id: m.id,
        name: displayName(m),
        currency: view.currency,
      }));
    const today = todayIso();
    const recurring: MoneyDate[] = coming
      .filter((r) => r.kind === 'recurring' && r.date)
      .map((r) => ({
        id: `recurring:${r.key}`,
        day: r.date as string,
        kind: 'recurring',
        title: r.title,
        amountMinor: r.amountMinor,
        currency: view.currency,
        memberId: null,
        overdue: (r.date as string) < today,
        route: null,
      }));
    const derived = deriveMoneyDates(
      {
        currency: view.currency,
        entries: view.entries,
        people,
        vendors: vendors.vendors,
        vendorLines: vendors.lines,
        documents: docs.docs,
      },
      today,
    );
    return [...derived, ...recurring].sort(
      (a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id),
    );
  }, [view, vendors.vendors, vendors.lines, docs.docs, coming]);
}
