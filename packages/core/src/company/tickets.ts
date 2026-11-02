import type { TicketPriority, TicketStatus } from '../sync/protocol';

export type { TicketPriority, TicketStatus };

export const TICKET_PRIORITIES: readonly TicketPriority[] = ['low', 'normal', 'high', 'urgent'];

const HOUR = 3_600_000;
/** How long a ticket of each priority may stay open; also the length of each escalation step. */
export const TICKET_WINDOW_MS: Record<TicketPriority, number> = {
  urgent: 4 * HOUR,
  high: 24 * HOUR,
  normal: 72 * HOUR,
  low: 168 * HOUR,
};

export interface CompanyTicket {
  readonly id: string;
  /** Per-company sequence, shown "TKT-0001". */
  readonly number: number;
  readonly clientId: string | null;
  readonly clientName: string | null;
  readonly clientPhone: string | null;
  readonly title: string;
  readonly details: string | null;
  readonly priority: TicketPriority;
  readonly status: TicketStatus;
  readonly assigneeMemberId: string;
  /** ISO instant. */
  readonly dueAt: string;
  readonly resolution: string | null;
  readonly resolvedAt: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly pending?: boolean;
}

export type TicketEventKind = 'created' | 'assigned' | 'status' | 'comment';
export interface TicketEvent {
  readonly id: string;
  readonly ticketId: string;
  readonly kind: TicketEventKind;
  readonly body: string | null;
  readonly toStatus: TicketStatus | null;
  /** The assignee, for created and assigned. */
  readonly memberId: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly pending?: boolean;
}

/** "TKT-0001". */
export const ticketNumber = (n: number): string => `TKT-${String(n).padStart(4, '0')}`;

/** The due time for a ticket raised (or reopened) at `from`, from its priority. */
export function defaultDueAt(priority: TicketPriority, from: string | number | Date): string {
  return new Date(new Date(from).getTime() + TICKET_WINDOW_MS[priority]).toISOString();
}

/** A ticket someone still has to deal with. */
export const isTicketOpen = (t: Pick<CompanyTicket, 'status'>): boolean =>
  t.status === 'open' || t.status === 'in_progress';

/**
 * Escalation is derived, never stored. 0 while on time (and always once resolved or closed); 1 once past `dueAt`
 * (the assignee's manager is involved); 2 once past `dueAt` plus the priority's window again (the owner).
 */
export type EscalationLevel = 0 | 1 | 2;
export function escalationLevel(
  t: Pick<CompanyTicket, 'status' | 'priority' | 'dueAt'>,
  now: string | number | Date,
): EscalationLevel {
  if (!isTicketOpen(t)) return 0;
  const late = new Date(now).getTime() - new Date(t.dueAt).getTime();
  if (!(late > 0)) return 0;
  return late > TICKET_WINDOW_MS[t.priority] ? 2 : 1;
}

export interface TicketMember {
  readonly id: string;
  readonly role: string;
  readonly managerId: string | null;
  readonly left?: boolean;
}

/**
 * Who a ticket at `level` has escalated to: level 1 the assignee's manager (the owner when they have none, e.g.
 * the assignee is a manager), level 2 the owner. Null at level 0 or when nobody is left to take it.
 */
export function escalatedTo(
  level: EscalationLevel,
  assigneeId: string,
  members: readonly TicketMember[],
): string | null {
  if (level === 0) return null;
  const live = members.filter((m) => !m.left);
  const owner = live.find((m) => m.role === 'admin')?.id ?? null;
  if (level === 2) return owner;
  const assignee = live.find((m) => m.id === assigneeId);
  const manager = assignee?.managerId ? live.find((m) => m.id === assignee.managerId) : undefined;
  return manager && manager.id !== assigneeId ? manager.id : owner;
}

/**
 * May this member see (and act on) the ticket? Mirrors the server: the owner every ticket; a manager the ones
 * assigned to or logged by them and their own reports' (an employee whose manager they are); an employee the ones
 * assigned to or logged by them; a vendor login none.
 */
export function ticketVisibleTo(
  t: Pick<CompanyTicket, 'assigneeMemberId' | 'createdBy'>,
  viewer: { readonly id: string; readonly role: string } | null,
  members: readonly TicketMember[],
): boolean {
  if (!viewer) return false;
  if (viewer.role === 'admin') return true;
  if (viewer.role !== 'manager' && viewer.role !== 'member') return false;
  if (t.assigneeMemberId === viewer.id || t.createdBy === viewer.id) return true;
  if (viewer.role !== 'manager') return false;
  const a = members.find((m) => m.id === t.assigneeMemberId);
  return a?.role === 'member' && a.managerId === viewer.id;
}

/** The moves offered from each status; the server allows exactly these. */
export type TicketAction = 'start' | 'resolve' | 'reopen' | 'close';
export const ACTION_TARGET: Record<TicketAction, TicketStatus> = {
  start: 'in_progress',
  resolve: 'resolved',
  reopen: 'open',
  close: 'closed',
};
export function ticketActions(status: TicketStatus): TicketAction[] {
  switch (status) {
    case 'open':
      return ['start', 'resolve'];
    case 'in_progress':
      return ['resolve'];
    case 'resolved':
      return ['reopen', 'close'];
    case 'closed':
      return ['reopen'];
  }
}

export type TicketTab = 'open' | 'escalated' | 'resolved';

export function ticketCounts(
  tickets: readonly CompanyTicket[],
  now: string | number | Date,
): Record<TicketTab, number> {
  const out: Record<TicketTab, number> = { open: 0, escalated: 0, resolved: 0 };
  for (const t of tickets) out[ticketTab(t, now)] += 1;
  return out;
}

/** Which tab a ticket sits on: resolved/closed, else escalated once past due, else open. */
export function ticketTab(t: CompanyTicket, now: string | number | Date): TicketTab {
  if (!isTicketOpen(t)) return 'resolved';
  return escalationLevel(t, now) > 0 ? 'escalated' : 'open';
}

/** One tab's tickets: open by soonest due, escalated by level then most overdue, resolved newest first. */
export function filterTickets(
  tickets: readonly CompanyTicket[],
  tab: TicketTab,
  now: string | number | Date,
  search = '',
): CompanyTicket[] {
  const q = search.trim().toLocaleLowerCase();
  const hit = (t: CompanyTicket) =>
    !q ||
    [t.title, t.clientName, ticketNumber(t.number)].some((v) => v?.toLocaleLowerCase().includes(q));
  const list = tickets.filter((t) => ticketTab(t, now) === tab && hit(t));
  if (tab === 'resolved')
    return list.sort((a, b) =>
      (b.resolvedAt ?? b.createdAt).localeCompare(a.resolvedAt ?? a.createdAt),
    );
  return list.sort(
    (a, b) =>
      escalationLevel(b, now) - escalationLevel(a, now) ||
      new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime() ||
      a.number - b.number,
  );
}

/** Tickets past due (escalated), for the badge on the More tile. */
export const escalatedCount = (
  tickets: readonly CompanyTicket[],
  now: string | number | Date,
): number => tickets.filter((t) => escalationLevel(t, now) > 0).length;

export type TicketSpanUnit = 'm' | 'h' | 'd';
/** A span as the one biggest whole unit: under an hour in minutes, under two days in hours, else days (at least 1). */
export function ticketSpan(ms: number): { readonly n: number; readonly unit: TicketSpanUnit } {
  const abs = Math.abs(ms);
  if (abs < HOUR) return { n: Math.max(1, Math.floor(abs / 60_000)), unit: 'm' };
  if (abs < 48 * HOUR) return { n: Math.floor(abs / HOUR), unit: 'h' };
  return { n: Math.floor(abs / (24 * HOUR)), unit: 'd' };
}

/** Time left (positive) or late (negative) against the due instant. */
export const ticketDueIn = (t: Pick<CompanyTicket, 'dueAt'>, now: string | number | Date): number =>
  new Date(t.dueAt).getTime() - new Date(now).getTime();
