/**
 * Company complaints (tickets) on the web: pure port of the phone's `data/companyTickets.ts`.
 * Escalation is derived from the due time; row-level security decides who sees which ticket.
 */

import {
  escalationLevel,
  escalatedTo,
  materialiseTickets,
  MutationKind,
  ticketVisibleTo,
  type CompanyTicket,
  type CompanyTicketSetPayload,
  type MirrorState,
  type QueuedMutation,
  type TicketEvent,
  type TicketMember,
  type TicketStatus,
} from '@waves/core';

import { viewerRole, type ClientsView, type CompanyMember } from './clients';

const NO_QUEUE: readonly QueuedMutation[] = [];

export interface TicketsView {
  readonly tickets: readonly CompanyTicket[];
  readonly events: readonly TicketEvent[];
  readonly people: readonly CompanyMember[];
  readonly hierarchy: readonly TicketMember[];
  readonly canAdd: boolean;
  readonly canRemove: boolean;
  readonly myMemberId: string | null;
  readonly memberName: (id: string | null) => string;
}

export function buildTicketsView(
  mirror: MirrorState,
  groupId: string,
  members: readonly CompanyMember[],
  profileId: string | null,
  clients: Pick<ClientsView, 'clients'>,
): TicketsView {
  const { me, isOwner, isManager, isVendor } = viewerRole(members, profileId);
  const myId = me?.id ?? null;
  const role = isVendor ? 'vendor' : (me?.role ?? null);
  const people = members.filter((m) => !m.left && m.role !== 'vendor');
  const hierarchy: TicketMember[] = members.map((m) => ({
    id: m.id,
    role: m.role,
    managerId: m.managerId,
    left: m.left,
  }));
  const lookup = new Map(clients.clients.map((c) => [c.id, c]));
  const all = materialiseTickets(mirror, NO_QUEUE, {
    groupId,
    myMemberId: myId,
    clientLookup: (id) => {
      const c = lookup.get(id);
      return c ? { name: c.name, phone: c.phone } : null;
    },
  });
  const viewer = myId && role ? { id: myId, role } : null;
  const tickets = all.tickets.filter((t) => ticketVisibleTo(t, viewer, hierarchy));
  const ids = new Set(tickets.map((t) => t.id));
  const names = new Map(members.map((m) => [m.id, m.name]));
  return {
    tickets,
    events: all.events.filter((e) => ids.has(e.ticketId)),
    people,
    hierarchy,
    canAdd: !isVendor && (isOwner || isManager || me?.role === 'member'),
    canRemove: isOwner || isManager,
    myMemberId: myId,
    memberName: (id) => (id ? (names.get(id) ?? '') : ''),
  };
}

/** A ticket's escalation level now and the name it has escalated to ('' while on time). */
export function ticketEscalation(
  view: Pick<TicketsView, 'hierarchy' | 'memberName'>,
  t: CompanyTicket,
  now: number,
): { level: 0 | 1 | 2; name: string } {
  const level = escalationLevel(t, now);
  return { level, name: view.memberName(escalatedTo(level, t.assigneeMemberId, view.hierarchy)) };
}

export type TicketInput = Omit<CompanyTicketSetPayload, 'ticketId'> & { ticketId?: string };

export function ticketSetPayload(input: TicketInput, id: string = crypto.randomUUID()) {
  const ticketId = input.ticketId ?? id;
  return {
    ticketId,
    payload: {
      ...input,
      ticketId,
      title: input.title.trim(),
      details: input.details?.trim() || null,
    } as Record<string, unknown>,
  };
}

/** The same ticket as a save payload, for a reassign. */
export function ticketInput(t: CompanyTicket): TicketInput {
  return {
    ticketId: t.id,
    clientId: t.clientId,
    title: t.title,
    details: t.details,
    priority: t.priority,
    assigneeMemberId: t.assigneeMemberId,
    dueAt: t.dueAt,
  };
}

export const ticketStatusPayload = (i: {
  ticketId: string;
  status: TicketStatus;
  note?: string | null;
}) => ({ ticketId: i.ticketId, status: i.status, note: i.note?.trim() || null });

export const ticketCommentPayload = (
  i: { ticketId: string; body: string },
  eventId: string = crypto.randomUUID(),
) => ({ eventId, ticketId: i.ticketId, body: i.body.trim() });

export const ticketKinds = {
  set: MutationKind.CompanyTicketSet,
  status: MutationKind.CompanyTicketStatus,
  comment: MutationKind.CompanyTicketCommentAdd,
  remove: MutationKind.CompanyTicketRemove,
} as const;
