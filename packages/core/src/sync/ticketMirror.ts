import {
  defaultDueAt,
  type CompanyTicket,
  type TicketEvent,
  type TicketEventKind,
} from '../company/tickets';
import { rowsFor, type MirrorState } from './mirror';
import {
  SyncTable,
  type CompanyTicketCommentAddPayload,
  type CompanyTicketRemovePayload,
  type CompanyTicketSetPayload,
  type CompanyTicketStatusPayload,
} from './protocol';
import type { QueuedMutation } from './queue';

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const iso = (v: unknown): string => {
  const s = String(v ?? '');
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? s : new Date(t).toISOString();
};

/**
 * The company's tickets and their timelines with this phone's queued changes on top (removed ones dropped,
 * events oldest first). A queued change that the server will turn into nothing (a move that is no longer
 * possible) is shown as asked until the next pull corrects it.
 */
export function materialiseTickets(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: {
    readonly groupId: string;
    /** Name and phone of a client picked on this phone, for a ticket not yet pulled. */
    readonly clientLookup?: (id: string) => { name: string; phone: string | null } | null;
    /** The signed-in member, who authors queued changes. */
    readonly myMemberId?: string | null;
  },
): { tickets: CompanyTicket[]; events: TicketEvent[] } {
  const tickets = new Map<string, CompanyTicket>();
  for (const r of rowsFor(state, SyncTable.CompanyTickets, options.groupId) as unknown as Row[]) {
    if (r.deleted_at != null) continue;
    tickets.set(r.id as string, {
      id: r.id as string,
      number: Number(r.number),
      clientId: str(r.client_id),
      clientName: str(r.client_name),
      clientPhone: str(r.client_phone),
      title: String(r.title),
      details: str(r.details),
      priority: r.priority as CompanyTicket['priority'],
      status: r.status as CompanyTicket['status'],
      assigneeMemberId: r.assignee_member_id as string,
      dueAt: iso(r.due_at),
      resolution: str(r.resolution),
      resolvedAt: r.resolved_at == null ? null : iso(r.resolved_at),
      createdBy: r.created_by as string,
      createdAt: String(r.created_at ?? ''),
    });
  }
  const events = new Map<string, TicketEvent>();
  for (const r of rowsFor(
    state,
    SyncTable.CompanyTicketEvents,
    options.groupId,
  ) as unknown as Row[]) {
    if (r.deleted_at != null) continue;
    events.set(r.id as string, {
      id: r.id as string,
      ticketId: r.ticket_id as string,
      kind: r.kind as TicketEventKind,
      body: str(r.body),
      toStatus: (r.to_status as TicketEvent['toStatus']) ?? null,
      memberId: str(r.member_id),
      createdBy: r.created_by as string,
      createdAt: iso(r.created_at),
    });
  }
  const me = options.myMemberId ?? '';
  for (const m of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (m.groupId !== options.groupId || m.rejection) continue;
    const pendingEvent = (e: Omit<TicketEvent, 'id' | 'createdBy' | 'createdAt' | 'pending'>) =>
      events.set(`pending:${m.clientMutationId}`, {
        ...e,
        id: `pending:${m.clientMutationId}`,
        createdBy: me,
        createdAt: m.clientCreatedAt,
        pending: true,
      });
    if (m.kind === 'company_ticket.set') {
      const p = m.payload as unknown as CompanyTicketSetPayload;
      const old = tickets.get(p.ticketId);
      const client = p.clientId ? options.clientLookup?.(p.clientId) : null;
      tickets.set(p.ticketId, {
        id: p.ticketId,
        number: old?.number ?? 0,
        clientId: p.clientId,
        clientName: client?.name ?? (old?.clientId === p.clientId ? old.clientName : null),
        clientPhone: client ? client.phone : old?.clientId === p.clientId ? old.clientPhone : null,
        title: p.title,
        details: p.details,
        priority: p.priority,
        status: old?.status ?? 'open',
        assigneeMemberId: p.assigneeMemberId,
        dueAt: p.dueAt,
        resolution: old?.resolution ?? null,
        resolvedAt: old?.resolvedAt ?? null,
        createdBy: old?.createdBy ?? me,
        createdAt: old?.createdAt ?? m.clientCreatedAt,
        pending: true,
      });
      if (!old)
        pendingEvent({
          ticketId: p.ticketId,
          kind: 'created',
          body: null,
          toStatus: null,
          memberId: p.assigneeMemberId,
        });
      else if (old.assigneeMemberId !== p.assigneeMemberId)
        pendingEvent({
          ticketId: p.ticketId,
          kind: 'assigned',
          body: null,
          toStatus: null,
          memberId: p.assigneeMemberId,
        });
    } else if (m.kind === 'company_ticket.status') {
      const p = m.payload as unknown as CompanyTicketStatusPayload;
      const old = tickets.get(p.ticketId);
      if (!old || old.status === p.status) continue;
      tickets.set(p.ticketId, {
        ...old,
        status: p.status,
        resolution: p.status === 'resolved' ? p.note : p.status === 'open' ? null : old.resolution,
        resolvedAt:
          p.status === 'resolved'
            ? m.clientCreatedAt
            : p.status === 'open'
              ? null
              : (old.resolvedAt ?? m.clientCreatedAt),
        dueAt: p.status === 'open' ? defaultDueAt(old.priority, m.clientCreatedAt) : old.dueAt,
        pending: true,
      });
      pendingEvent({
        ticketId: p.ticketId,
        kind: 'status',
        body: p.status === 'resolved' ? p.note : null,
        toStatus: p.status,
        memberId: null,
      });
    } else if (m.kind === 'company_ticket.remove') {
      tickets.delete((m.payload as unknown as CompanyTicketRemovePayload).ticketId);
    } else if (m.kind === 'company_ticket_comment.add') {
      const p = m.payload as unknown as CompanyTicketCommentAddPayload;
      if (!events.has(p.eventId))
        events.set(p.eventId, {
          id: p.eventId,
          ticketId: p.ticketId,
          kind: 'comment',
          body: p.body,
          toStatus: null,
          memberId: null,
          createdBy: me,
          createdAt: m.clientCreatedAt,
          pending: true,
        });
    }
  }
  const ids = new Set(tickets.keys());
  return {
    tickets: [...tickets.values()],
    events: [...events.values()]
      .filter((e) => ids.has(e.ticketId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}
