import type { CompanyEntry } from '@waves/core';

import { useCompanyEntries, type CompanyView } from '@/data/companyEntries';
import { usePendingVendorBills } from '@/data/companyVendors';
import { useWorkdayCounts } from '@/data/companyWorkday';

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

/**
 * The Pending tab's badge: what needs this person to act (claims, vendor bills to confirm, blocked tasks).
 * Unpaid bills and people not marked today are listed on the screen but not counted.
 */
export function usePendingCount(groupId: string | null): number {
  const id = groupId ?? '';
  const view = useCompanyEntries(id);
  const vendorBills = usePendingVendorBills(id).count;
  const { blocked } = useWorkdayCounts(id);
  return groupId === null ? 0 : awaitingApprovals(view).length + vendorBills + blocked;
}
