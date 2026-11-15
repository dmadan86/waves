/**
 * Material orders to a vendor. An order is a request, never a debt: it does not touch the vendor
 * balance (only the vendor's bill does). Money is bigint minor units; quantity is a decimal string
 * with up to 3 places so nothing goes through a float.
 */

export type VendorOrderStatus = 'sent' | 'accepted' | 'rejected' | 'delivered' | 'cancelled';
export const VENDOR_ORDER_UNITS = ['bags', 'pieces', 'kg', 'litres', 'metres', 'other'] as const;
export type VendorOrderUnit = (typeof VENDOR_ORDER_UNITS)[number];

export interface VendorOrderItem {
  readonly name: string;
  /** Decimal string, up to 3 places ("10.5"). */
  readonly qty: string;
  readonly unit: VendorOrderUnit;
  readonly unitPrice: bigint;
  readonly position: number;
}

export interface VendorOrderEvent {
  readonly status: VendorOrderStatus;
  readonly actorId: string;
  readonly at: string;
}

export interface VendorOrder {
  readonly id: string;
  readonly vendorId: string;
  /** Null until the server numbers it. */
  readonly orderNo: number | null;
  readonly status: VendorOrderStatus;
  readonly expectedOn: string | null;
  readonly note: string | null;
  readonly createdBy: string;
  readonly version: number;
  readonly createdAt: string;
  readonly items: readonly VendorOrderItem[];
  readonly events: readonly VendorOrderEvent[];
  readonly pending?: boolean;
}

export const orderLabel = (no: number | null | undefined): string => (no ? `#PO-${no}` : '');

/** "10.5" -> 10500n (thousandths). Null when it is not a positive number with at most 3 places. */
export function qtyThousandths(qty: string): bigint | null {
  const m = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(qty.trim());
  if (!m) return null;
  const v = BigInt(m[1]!) * 1000n + BigInt((m[2] ?? '').padEnd(3, '0') || '0');
  return v > 0n ? v : null;
}

/** qty x unit price in minor units, rounded half up to the nearest minor unit. */
export function orderLineTotal(qty: string, unitPrice: bigint): bigint {
  const q = qtyThousandths(qty);
  return q === null ? 0n : (q * unitPrice + 500n) / 1000n;
}

export const orderTotal = (items: readonly Pick<VendorOrderItem, 'qty' | 'unitPrice'>[]): bigint =>
  items.reduce((sum, i) => sum + orderLineTotal(i.qty, i.unitPrice), 0n);

/** The status changes a side may make (the server enforces the same table). */
export function orderActions(
  side: 'company' | 'vendor',
  status: VendorOrderStatus,
): VendorOrderStatus[] {
  if (side === 'vendor')
    return status === 'sent'
      ? ['accepted', 'rejected']
      : status === 'accepted'
        ? ['delivered']
        : [];
  return status === 'sent' || status === 'accepted' ? ['cancelled'] : [];
}

export interface CompanyVendorOrderSetPayload {
  readonly orderId: string;
  readonly vendorId: string;
  readonly expectedOn: string | null;
  readonly note: string | null;
  readonly items: readonly {
    readonly name: string;
    readonly qty: string;
    readonly unit: VendorOrderUnit;
    /** Minor units as digits. */
    readonly unitPrice: string;
  }[];
}
export interface CompanyVendorOrderStatusPayload {
  readonly orderId: string;
  readonly to: VendorOrderStatus;
}
