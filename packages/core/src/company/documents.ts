/**
 * Company estimates and bills (India: NOT a tax invoice - no GST, GSTIN or e-invoicing).
 * All money is integer minor units (bigint). Quantities are thousandths (2.5 -> 2500n) so
 * line amount = round_half_up(qtyMilli * rateMinor / 1000), the exact rule the database applies.
 */
export type CompanyDocType = 'estimate' | 'bill';
export type EstimateStatus = 'draft' | 'sent' | 'accepted' | 'declined';
export type BillStatus = 'unpaid' | 'part_paid' | 'paid';
export type CompanyDocStatus = EstimateStatus | BillStatus;

export const ESTIMATE_STATUSES: readonly EstimateStatus[] = [
  'draft',
  'sent',
  'accepted',
  'declined',
];
export const DOC_MAX_ITEMS = 50;
export const DOC_MAX_MINOR = 9_000_000_000_000_000n;

export interface DocItemInput {
  readonly description: string;
  readonly qtyMilli: bigint;
  readonly rateMinor: bigint;
}
export interface DocPayment {
  readonly id: string;
  readonly amountMinor: bigint;
  readonly paidOn: string;
}
export interface DocTotals {
  readonly lines: readonly bigint[];
  readonly subtotalMinor: bigint;
  readonly totalMinor: bigint;
}

/** "2.5" -> 2500n. Null when not a positive number with at most 3 decimals. */
export function parseQtyMilli(text: string): bigint | null {
  const t = text.trim().replace(',', '.');
  const m = /^(\d{1,6})(?:\.(\d{1,3}))?$/.exec(t);
  if (!m) return null;
  const v = BigInt(m[1]!) * 1000n + BigInt((m[2] ?? '').padEnd(3, '0') || '0');
  return v > 0n ? v : null;
}

export function formatQty(qtyMilli: bigint): string {
  const whole = qtyMilli / 1000n;
  const frac = (qtyMilli % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function lineAmount(item: Pick<DocItemInput, 'qtyMilli' | 'rateMinor'>): bigint {
  return (item.qtyMilli * item.rateMinor + 500n) / 1000n;
}

/** Lines, subtotal and total (subtotal less a discount amount). Discount is clamped to [0, subtotal]. */
export function computeDocTotals(
  items: readonly Pick<DocItemInput, 'qtyMilli' | 'rateMinor'>[],
  discountMinor: bigint,
): DocTotals {
  const lines = items.map(lineAmount);
  const subtotalMinor = lines.reduce((a, b) => a + b, 0n);
  const d = discountMinor < 0n ? 0n : discountMinor > subtotalMinor ? subtotalMinor : discountMinor;
  return { lines, subtotalMinor, totalMinor: subtotalMinor - d };
}

export interface DocValidationInput {
  readonly customerName: string;
  readonly items: readonly DocItemInput[];
  readonly discountMinor: bigint;
}
/** First problem as a code the screen maps to a message, or null when the document can be saved. */
export function validateDoc(
  doc: DocValidationInput,
  paidMinor = 0n,
): 'name' | 'items' | 'item' | 'discount' | 'total' | 'below_paid' | null {
  if (!doc.customerName.trim() || doc.customerName.trim().length > 120) return 'name';
  if (doc.items.length < 1 || doc.items.length > DOC_MAX_ITEMS) return 'items';
  if (doc.items.some((i) => !i.description.trim() || i.qtyMilli <= 0n || i.rateMinor < 0n))
    return 'item';
  const t = computeDocTotals(doc.items, 0n);
  if (doc.discountMinor < 0n || doc.discountMinor >= t.subtotalMinor) return 'discount';
  const total = t.subtotalMinor - doc.discountMinor;
  if (total <= 0n || total > DOC_MAX_MINOR) return 'total';
  if (total < paidMinor) return 'below_paid';
  return null;
}

export function billStatus(totalMinor: bigint, paidMinor: bigint): BillStatus {
  return paidMinor <= 0n ? 'unpaid' : paidMinor < totalMinor ? 'part_paid' : 'paid';
}
export const billDueMinor = (totalMinor: bigint, paidMinor: bigint): bigint =>
  totalMinor > paidMinor ? totalMinor - paidMinor : 0n;

/** null when a payment of this size is fine, else the reason (the screen checks first; the server re-checks). */
export function validatePayment(
  totalMinor: bigint,
  paidMinor: bigint,
  amountMinor: bigint,
): 'amount' | 'over' | null {
  if (amountMinor <= 0n) return 'amount';
  return paidMinor + amountMinor > totalMinor ? 'over' : null;
}

/** The running label, e.g. EST-0001 / BILL-0001. Null number = not yet numbered by the server. */
export function docNumberLabel(type: CompanyDocType, number: number | null): string {
  const prefix = type === 'estimate' ? 'EST' : 'BILL';
  return number == null ? prefix : `${prefix}-${String(number).padStart(4, '0')}`;
}

/** Minimal row shape for the list helpers (the mobile mirror row satisfies it). */
export interface DocSummaryRow {
  readonly docType: CompanyDocType;
  readonly status: CompanyDocStatus;
  readonly totalMinor: bigint;
  readonly paidMinor: bigint;
  readonly deleted?: boolean;
}

/** Bills not fully paid: the Pending screen's list. */
export function unpaidBills<T extends DocSummaryRow>(docs: readonly T[]): T[] {
  return docs.filter((d) => !d.deleted && d.docType === 'bill' && d.paidMinor < d.totalMinor);
}
export function unpaidBillsTotal(docs: readonly DocSummaryRow[]): bigint {
  return unpaidBills(docs).reduce((a, d) => a + billDueMinor(d.totalMinor, d.paidMinor), 0n);
}
