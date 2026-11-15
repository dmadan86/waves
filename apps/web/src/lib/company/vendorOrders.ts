/** Material orders to vendors (port of companyVendorOrders.ts). Pure. */
import {
  materialiseVendorOrders,
  type MirrorState,
  type Vendor,
  type VendorOrder,
  type VendorOrderStatus,
  type VendorOrderUnit,
} from '@waves/core';

import type { CompanyAccess } from '@/lib/company/vendorAccess';

export function deriveOrders(
  mirror: MirrorState,
  groupId: string,
  access: CompanyAccess,
  visibleVendors: readonly Vendor[],
): readonly VendorOrder[] {
  // Same filter as the vendors: a phone that once held more must not keep showing it.
  const ids = new Set(visibleVendors.map((v) => v.id));
  return materialiseVendorOrders(mirror, [], {
    groupId,
    myMemberId: access.memberId,
    isVendor: access.isVendor,
  }).filter((o) => ids.has(o.vendorId));
}

export interface OrderDraftItem {
  readonly name: string;
  readonly qty: string;
  readonly unit: VendorOrderUnit;
  readonly unitPrice: bigint;
}

export const orderSetPayload = (input: {
  orderId: string;
  vendorId: string;
  expectedOn?: string | null;
  note?: string | null;
  items: readonly OrderDraftItem[];
}): Record<string, unknown> => ({
  orderId: input.orderId,
  vendorId: input.vendorId,
  expectedOn: input.expectedOn || null,
  note: input.note?.trim() || null,
  items: input.items.map((i) => ({
    name: i.name.trim(),
    qty: i.qty.trim(),
    unit: i.unit,
    unitPrice: i.unitPrice.toString(),
  })),
});

export const orderStatusPayload = (input: {
  orderId: string;
  to: VendorOrderStatus;
}): Record<string, unknown> => ({ ...input });

/** Quantity text without trailing zeros ("2.500" -> "2.5"). */
export const trimQty = (qty: string): string =>
  qty.includes('.') ? qty.replace(/\.?0+$/, '') : qty;
