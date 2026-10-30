/**
 * Company vendors: a named supplier/contractor/landlord with a ledger against the company.
 * A bill is what the company owes; an advance or a payment is what the company paid.
 * Money is bigint minor units. The server is authoritative; this previews and overlays it offline.
 */

export type VendorLineKind = 'bill' | 'advance' | 'payment';
export type VendorLineStatus = 'pending' | 'approved' | 'rejected';

export interface Vendor {
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
  readonly category: string | null;
  /** The owner or manager who added them: the only manager who sees them. */
  readonly addedBy: string;
  /** The vendor's own login (group member), once they accepted the invite. */
  readonly memberId: string | null;
  readonly version: number;
  readonly deleted: boolean;
  /** Queued on this phone, not yet saved. */
  readonly pending?: boolean;
}

export interface VendorLine {
  readonly id: string;
  readonly vendorId: string;
  readonly kind: VendorLineKind;
  readonly amount: bigint;
  readonly occurredOn: string;
  readonly note: string | null;
  readonly status: VendorLineStatus;
  readonly createdBy: string;
  /** The manager whose cash pool paid it (owner-paid: null). */
  readonly fundingManagerId: string | null;
  readonly receivedAt: string | null;
  readonly reviewNote: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly deleted: boolean;
  readonly pending?: boolean;
}

/** A line that moves the balance: a confirmed bill, or any recorded advance/payment. */
export const vendorLineCounts = (l: VendorLine): boolean => !l.deleted && l.status === 'approved';

/** Positive: the company owes the vendor. Negative: the vendor holds an advance. Zero: settled. */
export function vendorBalance(lines: readonly VendorLine[]): bigint {
  let owed = 0n;
  for (const l of lines) {
    if (!vendorLineCounts(l)) continue;
    owed += l.kind === 'bill' ? l.amount : -l.amount;
  }
  return owed;
}

/** Bills waiting for an owner or manager to confirm. */
export const pendingVendorBills = (lines: readonly VendorLine[]): VendorLine[] =>
  lines.filter((l) => !l.deleted && l.kind === 'bill' && l.status === 'pending');

/** What a manager's vendor payments took out of their cash pool. */
export function vendorPaidFromPool(lines: readonly VendorLine[], managerId: string): bigint {
  let paid = 0n;
  for (const l of lines)
    if (vendorLineCounts(l) && l.kind !== 'bill' && l.fundingManagerId === managerId)
      paid += l.amount;
  return paid;
}

/** Newest first, ties by creation time. */
export const sortVendorLines = (lines: readonly VendorLine[]): VendorLine[] =>
  [...lines].sort(
    (a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt),
  );

// ---- queued-mutation payloads (client -> sync function -> RPC) ----

export interface CompanyVendorSetPayload {
  readonly vendorId: string;
  readonly name: string;
  readonly phone: string | null;
  readonly category: string | null;
}
export interface CompanyVendorRemovePayload {
  readonly vendorId: string;
}
export interface CompanyVendorEntryCreatePayload {
  readonly entryId: string;
  readonly vendorId: string;
  readonly kind: VendorLineKind;
  readonly amountMinor: string;
  readonly occurredOn: string;
  readonly note: string | null;
}
export interface CompanyVendorEntryReviewPayload {
  readonly entryId: string;
  readonly to: 'approved' | 'rejected';
  readonly note: string | null;
  readonly expectedVersion: number;
}
export interface CompanyVendorEntryVoidPayload {
  readonly entryId: string;
  readonly reason: string | null;
}
export interface CompanyVendorEntryReceivedPayload {
  readonly entryId: string;
  readonly received: boolean;
}
