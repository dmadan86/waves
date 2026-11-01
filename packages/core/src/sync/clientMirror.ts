import type { ClientNote, CompanyClient } from '../company/clients';
import { rowsFor, type MirrorState } from './mirror';
import {
  SyncTable,
  type CompanyClientNoteAddPayload,
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
): { clients: CompanyClient[]; notes: ClientNote[] } {
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
    } else if (m.kind === 'company_client.remove') {
      clients.delete((m.payload as unknown as CompanyClientRemovePayload).clientId);
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
    notes: [...notes.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}
