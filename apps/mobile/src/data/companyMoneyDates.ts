import { useMemo } from 'react';
import { deriveMoneyDates, isGroupRecurringDue, type MoneyDate } from '@waves/core';

import { useCompanyEntries } from '@/data/companyEntries';
import { useCompanyVendors } from '@/data/companyVendors';
import { useGroupRecurring } from '@/data/groupRecurring';
import { useCompanyDocs } from '@/data/companyDocuments';
import { todayIso } from '@/data/personal';
import { displayName } from '@/data/types';

/** Read-only calendar dates derived from the company data this viewer can already read. */
export function useMoneyDates(groupId: string): readonly MoneyDate[] {
  const view = useCompanyEntries(groupId);
  const vendors = useCompanyVendors(groupId);
  const docs = useCompanyDocs(groupId);
  const { rules } = useGroupRecurring(groupId);
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
    // Active repeating bills due within a week (or already due).
    const soon = new Date(`${today}T00:00:00Z`);
    soon.setUTCDate(soon.getUTCDate() + 7);
    const recurring: MoneyDate[] = (view.isOwner ? rules : [])
      .filter(
        (r) => r.status === 'active' && (r.nextDate <= soon.toISOString().slice(0, 10) || isGroupRecurringDue(r, today)),
      )
      .map((r) => ({
        id: `recurring:r-${r.id}`,
        day: r.nextDate,
        kind: 'recurring',
        title: r.description,
        amountMinor: r.amount,
        currency: view.currency,
        memberId: null,
        overdue: r.nextDate < today,
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
  }, [view, vendors.vendors, vendors.lines, docs.docs, rules]);
}
