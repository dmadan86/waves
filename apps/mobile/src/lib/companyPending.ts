import type { CompanyEntry } from '@waves/core';

import { useCompanyEntries, type CompanyView } from '@/data/companyEntries';

/** Claims this viewer can act on now: an owner sees all, a manager their team's (never their own). */
export function awaitingApprovals(view: CompanyView): CompanyEntry[] {
  return view.entries.filter(
    (e) =>
      !e.deleted &&
      e.status === 'submitted' &&
      (view.isOwner || e.memberId !== view.me?.id) &&
      // A claim waiting for a second owner is not this reviewer's to act on.
      view.canApprove(e),
  );
}

/** The Pending tab's badge. Vendor bills awaiting confirmation add to it when Vendors lands. */
export function usePendingCount(groupId: string | null): number {
  const view = useCompanyEntries(groupId ?? '');
  return groupId === null ? 0 : awaitingApprovals(view).length;
}
