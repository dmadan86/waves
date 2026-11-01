/**
 * What the Vendors screens show, worked out from vendors + ledger lines (bigint minor units).
 * Pure: the dashboard aggregates, the receipt and the statement.
 */
import {
  sortVendorLines,
  vendorBalance,
  vendorLineCounts,
  type Vendor,
  type VendorLine,
  type VendorPayMethod,
} from './vendors';

export type VendorStatus = 'settled' | 'overdue' | 'toReview' | 'toPay';
export type VendorFilter = 'all' | 'toPay' | 'settled' | 'toReview';

export interface VendorRow {
  readonly vendor: Vendor;
  readonly balance: bigint;
  /** Part of the balance on approved bills past their due date (never more than the balance). */
  readonly overdue: bigint;
  readonly toReview: number;
  readonly status: VendorStatus;
  /** Newest live line, for the row's subtitle. */
  readonly latest: VendorLine | null;
}

export interface VendorDashboard {
  readonly totalToPay: bigint;
  readonly overdueVendors: number;
  readonly paidThisMonth: bigint;
  /** Vendor bills waiting for the company to confirm. */
  readonly billsToReview: number;
  readonly rows: readonly VendorRow[];
  readonly counts: Record<VendorFilter, number>;
}

/** The part of a vendor's balance that is overdue on `today` (YYYY-MM-DD): payments settle the oldest bills first. */
export function vendorOverdue(lines: readonly VendorLine[], today: string): bigint {
  let credit = 0n;
  const bills: VendorLine[] = [];
  for (const l of lines) {
    if (!vendorLineCounts(l)) continue;
    if (l.kind === 'bill') bills.push(l);
    else credit += l.amount;
  }
  bills.sort((a, b) => (a.dueOn ?? a.occurredOn).localeCompare(b.dueOn ?? b.occurredOn));
  let late = 0n;
  for (const b of bills) {
    const used = credit < b.amount ? credit : b.amount;
    credit -= used;
    if (b.dueOn && b.dueOn < today) late += b.amount - used;
  }
  return late;
}

export function vendorStatus(balance: bigint, overdue: bigint, toReview: number): VendorStatus {
  if (toReview > 0) return 'toReview';
  if (overdue > 0n) return 'overdue';
  return balance > 0n ? 'toPay' : 'settled';
}

export function vendorDashboard(
  vendors: readonly Vendor[],
  lines: readonly VendorLine[],
  today: string,
): VendorDashboard {
  const month = today.slice(0, 7);
  const byVendor = new Map<string, VendorLine[]>();
  for (const l of lines)
    if (!l.deleted)
      (byVendor.get(l.vendorId) ?? byVendor.set(l.vendorId, []).get(l.vendorId)!).push(l);
  let totalToPay = 0n;
  let overdueVendors = 0;
  let billsToReview = 0;
  let paidThisMonth = 0n;
  const rows: VendorRow[] = [];
  for (const vendor of vendors) {
    const own = byVendor.get(vendor.id) ?? [];
    const balance = vendorBalance(own);
    const overdue = vendorOverdue(own, today);
    const toReview = own.filter((l) => l.kind === 'bill' && l.status === 'pending').length;
    if (balance > 0n) totalToPay += balance;
    if (overdue > 0n) overdueVendors += 1;
    billsToReview += toReview;
    for (const l of own)
      if (vendorLineCounts(l) && l.kind === 'payment' && l.occurredOn.startsWith(month))
        paidThisMonth += l.amount;
    rows.push({
      vendor,
      balance,
      overdue,
      toReview,
      status: vendorStatus(balance, overdue, toReview),
      latest: sortVendorLines(own)[0] ?? null,
    });
  }
  const counts = {
    all: rows.length,
    toPay: filterVendorRows(rows, 'toPay').length,
    settled: filterVendorRows(rows, 'settled').length,
    toReview: filterVendorRows(rows, 'toReview').length,
  };
  return { totalToPay, overdueVendors, paidThisMonth, billsToReview, rows, counts };
}

/** Filter chip + search box (name or phone, case-insensitive). */
export function filterVendorRows(
  rows: readonly VendorRow[],
  filter: VendorFilter,
  query = '',
): VendorRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (filter === 'toPay' && r.balance <= 0n) return false;
    if (filter === 'settled' && r.balance > 0n) return false;
    if (filter === 'toReview' && r.toReview === 0) return false;
    return !q || r.vendor.name.toLowerCase().includes(q) || (r.vendor.phone ?? '').includes(q);
  });
}

/** Latest live payment (by date, then creation) for "Last payment". */
export function lastVendorPayment(lines: readonly VendorLine[]): VendorLine | null {
  return sortVendorLines(lines.filter((l) => !l.deleted && l.kind === 'payment'))[0] ?? null;
}

/** Remaining balance after paying `amount` now, and any part that becomes an advance. */
export function paymentOutcome(
  balance: bigint,
  amount: bigint,
): { remaining: bigint; advance: bigint } {
  const remaining = balance - amount;
  return { remaining, advance: remaining < 0n ? -remaining : 0n };
}

// ---- receipt ----

export const receiptLabel = (no: number | null | undefined): string => (no ? `#R-${no}` : '');

export interface VendorReceipt {
  readonly receiptNo: number | null;
  readonly vendorName: string;
  readonly date: string;
  readonly amount: bigint;
  readonly method: VendorPayMethod | null;
  readonly reference: string | null;
  readonly note: string | null;
  /** Balance owed after this payment (negative: the vendor holds an advance). */
  readonly balanceAfter: bigint;
  readonly received: boolean;
  /** Not saved on the server yet. */
  readonly pending: boolean;
}

/** A payment's receipt: the balance is what remained once every line up to and including it counted. */
export function buildReceipt(
  line: VendorLine,
  vendor: Pick<Vendor, 'name'>,
  lines: readonly VendorLine[],
): VendorReceipt {
  const upTo = lines.filter(
    (l) =>
      l.id === line.id ||
      l.occurredOn < line.occurredOn ||
      (l.occurredOn === line.occurredOn && l.createdAt <= line.createdAt),
  );
  return {
    receiptNo: line.receiptNo ?? null,
    vendorName: vendor.name,
    date: line.occurredOn,
    amount: line.amount,
    method: line.method ?? null,
    reference: line.reference ?? null,
    note: line.note,
    balanceAfter: vendorBalance(upTo),
    received: !!line.receivedAt,
    pending: !!line.pending,
  };
}

// ---- statement ----

export interface VendorStatementRow {
  readonly date: string;
  readonly kind: VendorLine['kind'];
  readonly note: string | null;
  readonly receiptNo: number | null;
  /** Positive for a bill, negative for money paid. */
  readonly signed: bigint;
  readonly balance: bigint;
}

/** Oldest first, counting lines only, with the running balance after each. */
export function buildVendorStatement(lines: readonly VendorLine[]): {
  rows: VendorStatementRow[];
  balance: bigint;
} {
  const rows: VendorStatementRow[] = [];
  let running = 0n;
  for (const l of [...sortVendorLines(lines)].reverse()) {
    if (!vendorLineCounts(l)) continue;
    const signed = l.kind === 'bill' ? l.amount : -l.amount;
    running += signed;
    rows.push({
      date: l.occurredOn,
      kind: l.kind,
      note: l.note,
      receiptNo: l.receiptNo ?? null,
      signed,
      balance: running,
    });
  }
  return { rows, balance: running };
}
