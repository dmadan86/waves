/**
 * Company vendors: a named payee with a ledger (bill / advance / payment) against the company.
 * Who sees which vendor is the server's row-level security; the filter here only keeps a phone that
 * was once an owner's from showing more than the viewer's role allows today.
 */

import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';

import {
  materialiseVendors,
  pendingVendorBills,
  MutationKind,
  vendorBalance,
  type Vendor,
  type VendorLine,
  type VendorLineKind,
} from '@waves/core';

import { groupJoinLink } from '@/data/api';
import { useCompanyEntries } from '@/data/companyEntries';
import { backend } from '@/lib/backend';
import { useSync } from '@/sync';

export interface VendorsView {
  /** The vendors this viewer may see. */
  readonly vendors: readonly Vendor[];
  /** Their ledger lines, deleted ones excluded. */
  readonly lines: readonly VendorLine[];
  /** vendor id -> balance in minor units: positive the company owes, negative the vendor holds an advance. */
  readonly balances: ReadonlyMap<string, bigint>;
  /** Owner or manager: may add vendors and record bills and payments. */
  readonly canManage: boolean;
  /** The viewer is a vendor's own login. */
  readonly isVendor: boolean;
  readonly myMemberId: string | null;
  readonly currency: string;
}

export function useCompanyVendors(groupId: string): VendorsView {
  const { mirror, queue } = useSync();
  const view = useCompanyEntries(groupId);
  const myId = view.me?.id ?? null;
  return useMemo(() => {
    const all = materialiseVendors(mirror, queue, {
      groupId,
      myMemberId: myId,
      isVendor: view.isVendor,
      isManager: view.isManager,
    });
    const vendors = all.vendors.filter((v) =>
      view.isOwner
        ? true
        : view.isManager
          ? v.addedBy === myId
          : view.isVendor
            ? v.memberId === myId
            : false,
    );
    const ids = new Set(vendors.map((v) => v.id));
    const lines = all.lines.filter((l) => ids.has(l.vendorId));
    const balances = new Map<string, bigint>();
    for (const v of vendors) balances.set(v.id, vendorBalance(lines.filter((l) => l.vendorId === v.id)));
    return {
      vendors: vendors.sort((a, b) => a.name.localeCompare(b.name)),
      lines,
      balances,
      canManage: view.isOwner || view.isManager,
      isVendor: view.isVendor,
      myMemberId: myId,
      currency: view.currency,
    };
  }, [mirror, queue, groupId, myId, view.isOwner, view.isManager, view.isVendor, view.currency]);
}

/** Add a vendor (a fresh id) or edit one (its id). */
export function useSetVendor(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: async (input: {
      vendorId?: string;
      name: string;
      phone?: string | null;
      category?: string | null;
    }) => {
      const vendorId = input.vendorId ?? randomUUID();
      await mutate(MutationKind.CompanyVendorSet, groupId, {
        vendorId,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        category: input.category?.trim() || null,
      });
      return vendorId;
    },
  });
}

export function useRemoveVendor(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (vendorId: string) => mutate(MutationKind.CompanyVendorRemove, groupId, { vendorId }),
  });
}

/** A bill (company owes), or an advance / payment (company paid). A vendor's own bill waits for confirmation. */
export function useAddVendorLine(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: {
      vendorId: string;
      kind: VendorLineKind;
      amountMinor: bigint;
      occurredOn: string;
      note?: string | null;
    }) =>
      mutate(MutationKind.CompanyVendorEntryCreate, groupId, {
        entryId: randomUUID(),
        vendorId: input.vendorId,
        kind: input.kind,
        amountMinor: input.amountMinor.toString(),
        occurredOn: input.occurredOn,
        note: input.note?.trim() || null,
      }),
  });
}

/** Owner or the adding manager: confirm or reject a vendor's pending bill. */
export function useReviewVendorLine(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: { line: VendorLine; to: 'approved' | 'rejected'; note?: string | null }) =>
      mutate(MutationKind.CompanyVendorEntryReview, groupId, {
        entryId: input.line.id,
        to: input.to,
        note: input.note?.trim() || null,
        expectedVersion: input.line.version,
      }),
  });
}

export function useVoidVendorLine(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: { entryId: string; reason?: string | null }) =>
      mutate(MutationKind.CompanyVendorEntryVoid, groupId, {
        entryId: input.entryId,
        reason: input.reason?.trim() || null,
      }),
  });
}

/** The vendor says a recorded payment reached them. Never changes the balance. */
export function useMarkVendorPaymentReceived(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: { entryId: string; received: boolean }) =>
      mutate(MutationKind.CompanyVendorEntryReceived, groupId, { ...input }),
  });
}

/** A single-use link (30 days) that makes the person who opens it this vendor's own login. Needs a connection. */
export async function createVendorInviteLink(vendorId: string): Promise<string> {
  const { data, error } = await backend.rpc('waves_company_vendor_invite', { p_vendor_id: vendorId });
  if (error) throw new Error(error.message);
  return groupJoinLink(data as string);
}

/** Vendor bills waiting for an owner or the adding manager to confirm (for the Pending screen). */
export function usePendingVendorBills(groupId: string): {
  readonly count: number;
  readonly bills: readonly VendorLine[];
  readonly vendorName: (vendorId: string) => string;
} {
  const v = useCompanyVendors(groupId);
  return useMemo(() => {
    const bills = v.canManage ? pendingVendorBills(v.lines) : [];
    const names = new Map(v.vendors.map((x) => [x.id, x.name]));
    return { count: bills.length, bills, vendorName: (id: string) => names.get(id) ?? '' };
  }, [v]);
}
