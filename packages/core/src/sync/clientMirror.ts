import type { ClientAssignee, ClientNote, CompanyClient } from '../company/clients';
import type { CompanyInquiry } from '../company/inquiries';
import { rowsFor, type MirrorState } from './mirror';
import {
  SyncTable,
  type CompanyClientAssignPayload,
  type CompanyClientNoteAddPayload,
  type CompanyInquiryRejectPayload,
  type CompanyInquiryRemovePayload,
  type CompanyInquirySetPayload,
  type CompanyClientRemovePayload,
  type CompanyClientSetPayload,
} from './protocol';
import type { QueuedMutation } from './queue';

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** The company's clients and notes with this phone's queued changes on top (removed ones dropped, notes oldest first). */
export function materialiseClients(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: { readonly groupId: string },
): {
  clients: CompanyClient[];
  notes: ClientNote[];
  inquiries: CompanyInquiry[];
  assignees: ClientAssignee[];
} {
  const clients = new Map<string, CompanyClient>();
  for (const r of rowsFor(state, SyncTable.CompanyClients, options.groupId) as unknown as Row[]) {
    if (r.deleted_at != null) continue;
    clients.set(r.id as string, {
      id: r.id as string,
      name: String(r.name),
      phone: str(r.phone),
      need: str(r.need),
      source: r.source as CompanyClient['source'],
      expectedValueMinor: r.expected_value == null ? null : BigInt(String(r.expected_value)),
      address: str(r.address),
      stage: r.stage as CompanyClient['stage'],
      lostReason: str(r.lost_reason),
      ownerMemberId: str(r.owner_member_id),
      createdBy: r.created_by as string,
      createdAt: String(r.created_at ?? ''),
    });
  }
  const notes = new Map<string, ClientNote>();
  for (const r of rowsFor(
    state,
    SyncTable.CompanyClientNotes,
    options.groupId,
  ) as unknown as Row[]) {
    if (r.deleted_at != null) continue;
    notes.set(r.id as string, {
      id: r.id as string,
      clientId: r.client_id as string,
      body: String(r.body),
      createdBy: r.created_by as string,
      createdAt: String(r.created_at ?? ''),
    });
  }
  const inquiries = new Map<string, CompanyInquiry>();
  for (const r of rowsFor(state, SyncTable.CompanyInquiries, options.groupId) as unknown as Row[]) {
    if (r.deleted_at != null) continue;
    inquiries.set(r.id as string, {
      id: r.id as string,
      clientId: r.client_id as string,
      number: Number(r.number),
      title: String(r.title),
      details: str(r.details),
      expectedValueMinor:
        r.expected_value_minor == null ? null : BigInt(String(r.expected_value_minor)),
      inquiryDate: String(r.inquiry_date ?? '').slice(0, 10),
      rejectedAt: str(r.rejected_at),
      rejectReason: str(r.reject_reason),
      createdBy: r.created_by as string,
      createdAt: String(r.created_at ?? ''),
    });
  }
  // Keyed client:member so a queued reassignment can replace a client's set.
  const assignees = new Map<string, ClientAssignee>();
  for (const r of rowsFor(
    state,
    SyncTable.CompanyClientAssignees,
    options.groupId,
  ) as unknown as Row[]) {
    if (r.deleted_at != null) continue;
    assignees.set(`${r.client_id}:${r.member_id}`, {
      clientId: r.client_id as string,
      memberId: r.member_id as string,
    });
  }
  const dropAssignees = (clientId: string, keep: (memberId: string) => boolean) => {
    for (const [k, a] of assignees)
      if (a.clientId === clientId && !keep(a.memberId)) assignees.delete(k);
  };
  for (const m of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (m.groupId !== options.groupId || m.rejection) continue;
    if (m.kind === 'company_client.set') {
      const p = m.payload as unknown as CompanyClientSetPayload;
      const old = clients.get(p.clientId);
      clients.set(p.clientId, {
        id: p.clientId,
        name: p.name,
        phone: p.phone,
        need: p.need,
        source: p.source,
        expectedValueMinor: p.expectedValueMinor == null ? null : BigInt(p.expectedValueMinor),
        address: p.address,
        stage: p.stage,
        lostReason: p.stage === 'lost' ? p.lostReason : null,
        ownerMemberId: p.ownerMemberId,
        createdBy: old?.createdBy ?? '',
        createdAt: old?.createdAt ?? m.clientCreatedAt,
        pending: true,
      });
      // A hand-over drops the previous owner from the set; the new owner joins it.
      if (old?.ownerMemberId && old.ownerMemberId !== p.ownerMemberId)
        dropAssignees(p.clientId, (id) => id !== old.ownerMemberId);
      if (p.ownerMemberId)
        assignees.set(`${p.clientId}:${p.ownerMemberId}`, {
          clientId: p.clientId,
          memberId: p.ownerMemberId,
        });
    } else if (m.kind === 'company_client.remove') {
      const id = (m.payload as unknown as CompanyClientRemovePayload).clientId;
      clients.delete(id);
      for (const [k, i] of inquiries) if (i.clientId === id) inquiries.delete(k);
      dropAssignees(id, () => false);
    } else if (m.kind === 'company_client.assign') {
      const p = m.payload as unknown as CompanyClientAssignPayload;
      const set = new Set(p.memberIds);
      dropAssignees(p.clientId, (id) => set.has(id));
      for (const id of set)
        assignees.set(`${p.clientId}:${id}`, { clientId: p.clientId, memberId: id });
      const old = clients.get(p.clientId);
      if (old)
        clients.set(p.clientId, {
          ...old,
          ownerMemberId:
            old.ownerMemberId && set.has(old.ownerMemberId)
              ? old.ownerMemberId
              : (p.memberIds[0] ?? null),
          pending: true,
        });
    } else if (m.kind === 'company_inquiry.set') {
      const p = m.payload as unknown as CompanyInquirySetPayload;
      const old = inquiries.get(p.inquiryId);
      inquiries.set(p.inquiryId, {
        id: p.inquiryId,
        clientId: p.clientId,
        number: old?.number ?? 0,
        title: p.title,
        details: p.details,
        expectedValueMinor: p.expectedValueMinor == null ? null : BigInt(p.expectedValueMinor),
        inquiryDate: p.inquiryDate,
        rejectedAt: old?.rejectedAt ?? null,
        rejectReason: old?.rejectReason ?? null,
        createdBy: old?.createdBy ?? '',
        createdAt: old?.createdAt ?? m.clientCreatedAt,
        pending: true,
      });
    } else if (m.kind === 'company_inquiry.reject') {
      const p = m.payload as unknown as CompanyInquiryRejectPayload;
      const old = inquiries.get(p.inquiryId);
      if (old)
        inquiries.set(p.inquiryId, {
          ...old,
          rejectedAt: p.rejected ? (old.rejectedAt ?? m.clientCreatedAt) : null,
          rejectReason: p.rejected ? (old.rejectedAt ? old.rejectReason : p.reason) : null,
          pending: true,
        });
    } else if (m.kind === 'company_inquiry.remove') {
      inquiries.delete((m.payload as unknown as CompanyInquiryRemovePayload).inquiryId);
    } else if (m.kind === 'company_client_note.add') {
      const p = m.payload as unknown as CompanyClientNoteAddPayload;
      if (!notes.has(p.noteId))
        notes.set(p.noteId, {
          id: p.noteId,
          clientId: p.clientId,
          body: p.body,
          createdBy: '',
          createdAt: m.clientCreatedAt,
          pending: true,
        });
    }
  }
  return {
    clients: [...clients.values()],
    inquiries: [...inquiries.values()],
    assignees: [...assignees.values()],
    notes: [...notes.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}
