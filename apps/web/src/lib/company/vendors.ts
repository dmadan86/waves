/**
 * Company vendors (port of apps/mobile/src/data/companyVendors.ts). Pure: reads the synced mirror,
 * builds mutation payloads 1:1 with mobile. Hooks live in useVendors.ts.
 */
import {
  materialiseVendors,
  pendingVendorBills,
  vendorBalance,
  MutationKind,
  type MirrorState,
  type Vendor,
  type VendorLine,
  type VendorLineKind,
  type VendorPayMethod,
} from '@waves/core';

import type { CompanyAccess } from '@/lib/company/vendorAccess';

export interface VendorsView {
  readonly vendors: readonly Vendor[];
  readonly lines: readonly VendorLine[];
  /** vendor id -> minor units: positive the company owes, negative the vendor holds an advance. */
  readonly balances: ReadonlyMap<string, bigint>;
  readonly canManage: boolean;
  readonly isVendor: boolean;
  readonly myMemberId: string | null;
  readonly currency: string;
}

export function deriveVendors(
  mirror: MirrorState,
  groupId: string,
  access: CompanyAccess,
): VendorsView {
  const myId = access.memberId;
  const all = materialiseVendors(mirror, [], {
    groupId,
    myMemberId: myId,
    isVendor: access.isVendor,
    isManager: access.isManager,
  });
  // A phone that was once an owner's must not show more than the viewer's role allows today.
  const vendors = all.vendors
    .filter((v) =>
      access.isOwner
        ? true
        : access.isManager
          ? v.addedBy === myId
          : access.isVendor
            ? v.memberId === myId
            : false,
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const ids = new Set(vendors.map((v) => v.id));
  const lines = all.lines.filter((l) => ids.has(l.vendorId));
  const balances = new Map<string, bigint>();
  for (const v of vendors)
    balances.set(v.id, vendorBalance(lines.filter((l) => l.vendorId === v.id)));
  return {
    vendors,
    lines,
    balances,
    canManage: access.isOwner || access.isManager,
    isVendor: access.isVendor,
    myMemberId: myId,
    currency: access.currency,
  };
}

export function pendingBillsOf(view: VendorsView): readonly VendorLine[] {
  return view.canManage ? pendingVendorBills(view.lines) : [];
}

type Payload = Record<string, unknown>;

export const vendorSetMutation = (input: {
  vendorId: string;
  name: string;
  phone?: string | null;
  category?: string | null;
}): { kind: MutationKind; payload: Payload } => ({
  kind: MutationKind.CompanyVendorSet,
  payload: {
    vendorId: input.vendorId,
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    category: input.category?.trim() || null,
  },
});

export const vendorRemovePayload = (vendorId: string): Payload => ({ vendorId });

export const vendorEntryCreatePayload = (input: {
  entryId: string;
  vendorId: string;
  kind: VendorLineKind;
  amountMinor: bigint;
  occurredOn: string;
  note?: string | null;
  dueOn?: string | null;
  method?: VendorPayMethod | null;
  reference?: string | null;
}): Payload => ({
  entryId: input.entryId,
  vendorId: input.vendorId,
  kind: input.kind,
  amountMinor: input.amountMinor.toString(),
  occurredOn: input.occurredOn,
  note: input.note?.trim() || null,
  dueOn: input.dueOn || null,
  method: input.method || null,
  reference: input.reference?.trim() || null,
});

export const vendorEntryReviewPayload = (input: {
  line: Pick<VendorLine, 'id' | 'version'>;
  to: 'approved' | 'rejected';
  note?: string | null;
}): Payload => ({
  entryId: input.line.id,
  to: input.to,
  note: input.note?.trim() || null,
  expectedVersion: input.line.version,
});

export const vendorEntryVoidPayload = (input: {
  entryId: string;
  reason?: string | null;
}): Payload => ({ entryId: input.entryId, reason: input.reason?.trim() || null });

export const vendorEntryReceivedPayload = (input: {
  entryId: string;
  received: boolean;
}): Payload => ({ ...input });

/** What a scanned or pasted vendor code can tell us: a name and/or phone, read client-side only. */
export interface VendorShare {
  name?: string;
  phone?: string;
}
const PHONE = /^\+?[\d\s-]{7,16}$/;

/** A UPI pay link (`pn` payee name, `pa` handle that is often the phone), a tel: link or a bare number. Else null. */
export function parseVendorShare(raw: string): VendorShare | null {
  const text = raw.trim();
  if (!text) return null;
  if (PHONE.test(text)) return { phone: text.replace(/[\s-]/g, '') };
  if (/^tel:/i.test(text)) {
    try {
      return { phone: decodeURIComponent(text.slice(4)).replace(/[\s-]/g, '') };
    } catch {
      return null;
    }
  }
  if (!/^upi:\/\//i.test(text)) return null;
  const query = text.split('?')[1] ?? '';
  const get = (key: string): string => {
    const hit = query.split('&').find((p) => p.startsWith(`${key}=`));
    try {
      return hit ? decodeURIComponent(hit.slice(key.length + 1).replace(/\+/g, ' ')).trim() : '';
    } catch {
      return '';
    }
  };
  const name = get('pn');
  const phone = /^\d{10}@/.test(get('pa')) ? get('pa').slice(0, 10) : '';
  return name || phone ? { ...(name && { name }), ...(phone && { phone }) } : null;
}

/** wa.me link for a phone, or null without digits. */
export function whatsappUrl(phone: string | null | undefined, text = ''): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}

export function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const todayIso = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
