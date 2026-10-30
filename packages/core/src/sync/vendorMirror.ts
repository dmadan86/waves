import type { Vendor, VendorLine } from '../company/vendors';
import type {
  CompanyVendorEntryCreatePayload,
  CompanyVendorEntryReceivedPayload,
  CompanyVendorEntryReviewPayload,
  CompanyVendorEntryVoidPayload,
  CompanyVendorSetPayload,
} from '../company/vendors';
import { rowsFor, type MirrorState } from './mirror';
import { SyncTable } from './protocol';
import type { QueuedMutation } from './queue';

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** The company's vendors and ledger lines with this phone's queued changes on top. */
export function materialiseVendors(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: {
    readonly groupId: string;
    readonly myMemberId: string | null;
    readonly isVendor: boolean;
    /** A manager pays vendors from their own cash pool. */
    readonly isManager?: boolean;
  },
): { vendors: Vendor[]; lines: VendorLine[] } {
  const vendors = new Map<string, Vendor>();
  for (const r of rowsFor(state, SyncTable.CompanyVendors, options.groupId) as unknown as Row[])
    vendors.set(r.id as string, {
      id: r.id as string,
      name: String(r.name),
      phone: str(r.phone),
      category: str(r.category),
      addedBy: r.added_by as string,
      memberId: str(r.member_id),
      version: Number(r.version ?? 1),
      deleted: r.deleted_at != null,
    });
  const lines = new Map<string, VendorLine>();
  for (const r of rowsFor(
    state,
    SyncTable.CompanyVendorEntries,
    options.groupId,
  ) as unknown as Row[])
    lines.set(r.id as string, {
      id: r.id as string,
      vendorId: r.vendor_id as string,
      kind: r.kind as VendorLine['kind'],
      amount: BigInt(String(r.amount)),
      occurredOn: String(r.occurred_on).slice(0, 10),
      note: str(r.note),
      status: r.status as VendorLine['status'],
      createdBy: r.created_by as string,
      fundingManagerId: str(r.funding_manager_id),
      receivedAt: str(r.received_at),
      reviewNote: str(r.review_note),
      version: Number(r.version ?? 1),
      createdAt: String(r.created_at ?? ''),
      deleted: r.deleted_at != null,
    });

  for (const m of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (m.groupId !== options.groupId || m.rejection) continue;
    if (m.kind === 'company_vendor.set') {
      const p = m.payload as unknown as CompanyVendorSetPayload;
      const old = vendors.get(p.vendorId);
      vendors.set(p.vendorId, {
        id: p.vendorId,
        name: p.name,
        phone: p.phone,
        category: p.category,
        addedBy: old?.addedBy ?? options.myMemberId ?? '',
        memberId: old?.memberId ?? null,
        version: old?.version ?? 1,
        deleted: false,
        pending: true,
      });
    } else if (m.kind === 'company_vendor.remove') {
      const old = vendors.get((m.payload as { vendorId: string }).vendorId);
      if (old) vendors.set(old.id, { ...old, deleted: true, pending: true });
    } else if (m.kind === 'company_vendor_entry.create') {
      const p = m.payload as unknown as CompanyVendorEntryCreatePayload;
      if (lines.has(p.entryId)) continue;
      lines.set(p.entryId, {
        id: p.entryId,
        vendorId: p.vendorId,
        kind: p.kind,
        amount: BigInt(p.amountMinor),
        occurredOn: p.occurredOn,
        note: p.note,
        // A vendor's own bill waits for confirmation; everything the company records counts at once.
        status: options.isVendor ? 'pending' : 'approved',
        createdBy: options.myMemberId ?? '',
        fundingManagerId: options.isManager && p.kind !== 'bill' ? options.myMemberId : null,
        receivedAt: null,
        reviewNote: null,
        version: 1,
        createdAt: m.clientCreatedAt,
        deleted: false,
        pending: true,
      });
    } else if (m.kind === 'company_vendor_entry.review') {
      const p = m.payload as unknown as CompanyVendorEntryReviewPayload;
      const old = lines.get(p.entryId);
      if (old?.status === 'pending')
        lines.set(old.id, { ...old, status: p.to, reviewNote: p.note, pending: true });
    } else if (m.kind === 'company_vendor_entry.void') {
      const old = lines.get((m.payload as unknown as CompanyVendorEntryVoidPayload).entryId);
      if (old) lines.set(old.id, { ...old, deleted: true, pending: true });
    } else if (m.kind === 'company_vendor_entry.received') {
      const p = m.payload as unknown as CompanyVendorEntryReceivedPayload;
      const old = lines.get(p.entryId);
      if (old)
        lines.set(old.id, {
          ...old,
          receivedAt: p.received ? m.clientCreatedAt : null,
          pending: true,
        });
    }
  }
  return {
    vendors: [...vendors.values()].filter((v) => !v.deleted),
    lines: [...lines.values()].filter((l) => !l.deleted),
  };
}
