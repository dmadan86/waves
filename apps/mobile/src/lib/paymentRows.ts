import { dashboardStats, type CompanyEntry } from '@waves/core';

/** Which strings and sign a Payments row uses, so title, subtitle and sign always agree. */
export function paymentRowKind(e: Pick<CompanyEntry, 'kind' | 'direction'>): {
  title: 'advanceTo' | 'wagesTo' | 'cashReturnedBy' | 'paymentTo';
  sub: 'advancesLabel' | 'salaryPayment' | 'returned' | 'paidOut';
  incoming: boolean;
} {
  if (e.direction === 'employee_to_company')
    return { title: 'cashReturnedBy', sub: 'returned', incoming: true };
  if (e.kind === 'advance') return { title: 'advanceTo', sub: 'advancesLabel', incoming: false };
  if (e.kind === 'reimbursement') return { title: 'paymentTo', sub: 'paidOut', incoming: false };
  return { title: 'wagesTo', sub: 'salaryPayment', incoming: false };
}

/**
 * Payments hero: "paid" is this month's payments out, "pending" the same figure the Overview's
 * "Payments due" tile shows (owed to people plus, for owners, owed to vendors).
 */
export function paymentsHero(
  entries: readonly CompanyEntry[],
  memberIds: readonly string[],
  today: string,
  owedToVendors: bigint,
): { paid: bigint; pending: bigint } {
  const s = dashboardStats(entries, memberIds, today);
  return { paid: s.paidThisMonth, pending: s.owes + owedToVendors };
}
