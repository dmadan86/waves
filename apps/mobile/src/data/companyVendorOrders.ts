/** Material orders to vendors. Visibility is the server's RLS; this reads what the phone holds. */
import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';

import {
  materialiseVendorOrders,
  MutationKind,
  type VendorOrder,
  type VendorOrderStatus,
  type VendorOrderUnit,
} from '@waves/core';

import { useCompanyEntries } from '@/data/companyEntries';
import { useCompanyVendors } from '@/data/companyVendors';
import { useSync } from '@/sync';

export function useVendorOrders(groupId: string): readonly VendorOrder[] {
  const { mirror, queue } = useSync();
  const view = useCompanyEntries(groupId);
  // Same filter as the vendors: a phone that once held more (an owner's) must not keep showing it.
  const visible = useCompanyVendors(groupId).vendors;
  const myId = view.me?.id ?? null;
  return useMemo(() => {
    const ids = new Set(visible.map((v) => v.id));
    return materialiseVendorOrders(mirror, queue, {
      groupId,
      myMemberId: myId,
      isVendor: view.isVendor,
    }).filter((o) => ids.has(o.vendorId));
  }, [mirror, queue, groupId, myId, view.isVendor, visible]);
}

export interface OrderDraftItem {
  readonly name: string;
  readonly qty: string;
  readonly unit: VendorOrderUnit;
  readonly unitPrice: bigint;
}

/** Create (a fresh `orderId`) or edit an order that is still sent. Reuse one id per form so a retry is the same request. */
export function useSetVendorOrder(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: async (input: {
      orderId?: string;
      vendorId: string;
      expectedOn?: string | null;
      note?: string | null;
      items: readonly OrderDraftItem[];
    }) => {
      const orderId = input.orderId ?? randomUUID();
      await mutate(MutationKind.CompanyVendorOrderSet, groupId, {
        orderId,
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
      return orderId;
    },
  });
}

export function useVendorOrderStatus(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: { orderId: string; to: VendorOrderStatus }) =>
      mutate(MutationKind.CompanyVendorOrderStatus, groupId, { ...input }),
  });
}
