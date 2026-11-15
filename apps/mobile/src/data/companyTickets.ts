/**
 * Company complaints (tickets): staff log a customer's complaint against a client, assign it, and it escalates
 * by itself when it is not solved in time (derived from the due time, no timer on a server). The server's
 * row-level security decides who sees which ticket; the filter here only keeps a stale mirror from showing more.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';

import {
  escalatedCount,
  escalationLevel,
  escalatedTo,
  materialiseTickets,
  MutationKind,
  ticketVisibleTo,
  type CompanyTicket,
  type CompanyTicketSetPayload,
  type TicketEvent,
  type TicketMember,
  type TicketStatus,
} from '@waves/core';

import { useCompanyClients } from '@/data/companyClients';
import { useCompanyEntries } from '@/data/companyEntries';
import { displayName, type MemberRow } from '@/data/types';
import { useSync } from '@/sync';

/** The current instant, refreshed every minute so "Due in 3h" and escalations keep up while a screen is open. */
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

export interface TicketsView {
  /** The tickets this viewer may see. */
  readonly tickets: readonly CompanyTicket[];
  readonly events: readonly TicketEvent[];
  /** Live people a ticket can be given to (owner, managers, employees the viewer can read). */
  readonly people: readonly MemberRow[];
  readonly hierarchy: readonly TicketMember[];
  /** May log a complaint: owner, manager or employee (not a vendor login). */
  readonly canAdd: boolean;
  /** Owner or manager: may delete a ticket. */
  readonly canRemove: boolean;
  readonly myMemberId: string | null;
  readonly memberName: (id: string | null) => string;
  readonly ready: boolean;
}

export function useCompanyTickets(groupId: string): TicketsView {
  const { mirror, queue } = useSync();
  const view = useCompanyEntries(groupId);
  const clients = useCompanyClients(groupId);
  const me = view.me;
  const myId = me?.id ?? null;
  const role = view.isVendor ? 'vendor' : (me?.role ?? null);
  return useMemo(() => {
    const people = view.members.filter((m) => !m.left_at && m.role !== 'vendor');
    const hierarchy: TicketMember[] = view.members.map((m) => ({
      id: m.id,
      role: m.role,
      managerId: m.manager_id ?? null,
      left: !!m.left_at,
    }));
    const lookup = new Map(clients.clients.map((c) => [c.id, c]));
    const all = materialiseTickets(mirror, queue, {
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
    const names = new Map(view.members.map((m) => [m.id, displayName(m)]));
    return {
      tickets,
      events: all.events.filter((e) => ids.has(e.ticketId)),
      people,
      hierarchy,
      canAdd: !view.isVendor && (view.isOwner || view.isManager || me?.role === 'member'),
      canRemove: view.isOwner || view.isManager,
      myMemberId: myId,
      memberName: (id: string | null) => (id ? (names.get(id) ?? '') : ''),
      ready: view.ready,
    };
  }, [mirror, queue, groupId, myId, role, view, clients.clients, me?.role]);
}

/** Open and escalated counts for the More tile (escalated = past its due time and still open). */
export function useTicketBadge(groupId: string) {
  const { tickets, canAdd } = useCompanyTickets(groupId);
  const now = useNow();
  return useMemo(
    () => ({
      show: canAdd,
      open: tickets.filter((t) => t.status === 'open' || t.status === 'in_progress').length,
      escalated: escalatedCount(tickets, now),
    }),
    [tickets, canAdd, now],
  );
}

/** A ticket's escalation level now and the name it has escalated to ('' while on time or when nobody is readable). */
export function ticketEscalation(
  view: Pick<TicketsView, 'hierarchy' | 'memberName'>,
  t: CompanyTicket,
  now: number,
): { level: 0 | 1 | 2; name: string } {
  const level = escalationLevel(t, now);
  return { level, name: view.memberName(escalatedTo(level, t.assigneeMemberId, view.hierarchy)) };
}

export type TicketInput = Omit<CompanyTicketSetPayload, 'ticketId'> & { ticketId?: string };

/** Log a complaint (a fresh id) or save one (its id); reassigning is a save. */
export function useSetTicket(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: async (input: TicketInput) => {
      const ticketId = input.ticketId ?? randomUUID();
      await mutate(MutationKind.CompanyTicketSet, groupId, {
        ...input,
        ticketId,
        title: input.title.trim(),
        details: input.details?.trim() || null,
      });
      return ticketId;
    },
  });
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

export function useTicketStatus(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: { ticketId: string; status: TicketStatus; note?: string | null }) =>
      mutate(MutationKind.CompanyTicketStatus, groupId, {
        ticketId: input.ticketId,
        status: input.status,
        note: input.note?.trim() || null,
      }),
  });
}

export function useAddTicketComment(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: { ticketId: string; body: string }) =>
      mutate(MutationKind.CompanyTicketCommentAdd, groupId, {
        eventId: randomUUID(),
        ticketId: input.ticketId,
        body: input.body.trim(),
      }),
  });
}

export function useRemoveTicket(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (ticketId: string) =>
      mutate(MutationKind.CompanyTicketRemove, groupId, { ticketId }),
  });
}
