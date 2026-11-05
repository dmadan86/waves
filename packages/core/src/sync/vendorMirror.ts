import { orderActions } from '../company/vendorOrders';
import type {
  CompanyVendorOrderSetPayload,
  CompanyVendorOrderStatusPayload,
  VendorOrder,
  VendorOrderEvent,
  VendorOrderItem,
  VendorOrderStatus,
} from '../company/vendorOrders';
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
      categories: Array.isArray(r.categories)
        ? r.categories.map(String)
        : r.category
          ? [String(r.category)]
          : [],
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
      dueOn: r.due_on ? String(r.due_on).slice(0, 10) : null,
      method: str(r.method) as VendorLine['method'],
      reference: str(r.reference),
      receiptNo: r.receipt_no == null ? null : Number(r.receipt_no),
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
        category: p.categories?.[0] ?? p.category,
        categories: p.categories ?? (p.category ? [p.category] : []),
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
        dueOn: p.dueOn ?? null,
        method: p.method ?? null,
        reference: p.reference ?? null,
        receiptNo: null,
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

/** Orders with their items and history, this phone's queued changes on top. Visibility is the server's RLS. */
export function materialiseVendorOrders(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: {
    readonly groupId: string;
    readonly myMemberId: string | null;
    readonly isVendor: boolean;
  },
): VendorOrder[] {
  const items = new Map<string, VendorOrderItem[]>();
  for (const r of rowsFor(
    state,
    SyncTable.CompanyVendorOrderItems,
    options.groupId,
  ) as unknown as Row[]) {
    if (r.deleted_at != null) continue;
    const list = items.get(r.order_id as string) ?? [];
    list.push({
      name: String(r.name),
      qty: String(r.qty),
      unit: r.unit as VendorOrderItem['unit'],
      unitPrice: BigInt(String(r.unit_price)),
      position: Number(r.position ?? 0),
    });
    items.set(r.order_id as string, list);
  }
  const events = new Map<string, VendorOrderEvent[]>();
  for (const r of rowsFor(
    state,
    SyncTable.CompanyVendorOrderEvents,
    options.groupId,
  ) as unknown as Row[]) {
    if (r.deleted_at != null) continue;
    const list = events.get(r.order_id as string) ?? [];
    list.push({
      status: r.status as VendorOrderStatus,
      actorId: String(r.actor_id),
      at: String(r.at),
    });
    events.set(r.order_id as string, list);
  }
  const orders = new Map<string, VendorOrder>();
  for (const r of rowsFor(
    state,
    SyncTable.CompanyVendorOrders,
    options.groupId,
  ) as unknown as Row[]) {
    if (r.deleted_at != null) continue;
    orders.set(r.id as string, {
      id: r.id as string,
      vendorId: r.vendor_id as string,
      orderNo: r.order_no == null ? null : Number(r.order_no),
      status: r.status as VendorOrderStatus,
      expectedOn: r.expected_on ? String(r.expected_on).slice(0, 10) : null,
      note: str(r.note),
      createdBy: r.created_by as string,
      version: Number(r.version ?? 1),
      createdAt: String(r.created_at ?? ''),
      items: (items.get(r.id as string) ?? []).sort((a, b) => a.position - b.position),
      events: (events.get(r.id as string) ?? []).sort((a, b) => a.at.localeCompare(b.at)),
    });
  }
  for (const m of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (m.groupId !== options.groupId || m.rejection) continue;
    if (m.kind === 'company_vendor_order.set') {
      const p = m.payload as unknown as CompanyVendorOrderSetPayload;
      const old = orders.get(p.orderId);
      if (old && old.status !== 'sent') continue;
      orders.set(p.orderId, {
        id: p.orderId,
        vendorId: p.vendorId,
        orderNo: old?.orderNo ?? null,
        status: 'sent',
        expectedOn: p.expectedOn,
        note: p.note,
        createdBy: old?.createdBy ?? options.myMemberId ?? '',
        version: old?.version ?? 1,
        createdAt: old?.createdAt ?? m.clientCreatedAt,
        items: p.items.map((i, position) => ({
          name: i.name,
          qty: i.qty,
          unit: i.unit,
          unitPrice: BigInt(i.unitPrice),
          position,
        })),
        events: old?.events ?? [
          { status: 'sent', actorId: options.myMemberId ?? '', at: m.clientCreatedAt },
        ],
        pending: true,
      });
    } else if (m.kind === 'company_vendor_order.status') {
      const p = m.payload as unknown as CompanyVendorOrderStatusPayload;
      const old = orders.get(p.orderId);
      if (!old || !orderActions(options.isVendor ? 'vendor' : 'company', old.status).includes(p.to))
        continue;
      orders.set(old.id, {
        ...old,
        status: p.to,
        events: [
          ...old.events,
          { status: p.to, actorId: options.myMemberId ?? '', at: m.clientCreatedAt },
        ],
        pending: true,
      });
    }
  }
  return [...orders.values()].sort(
    (a, b) => (b.orderNo ?? 1e9) - (a.orderNo ?? 1e9) || b.createdAt.localeCompare(a.createdAt),
  );
}
