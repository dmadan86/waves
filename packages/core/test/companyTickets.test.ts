import { describe, expect, it } from 'vitest';
import {
  defaultDueAt,
  emptyMirror,
  escalatedCount,
  escalatedTo,
  escalationLevel,
  filterTickets,
  materialiseTickets,
  purgeCompanyInvisible,
  reconcile,
  SyncTable,
  ticketActions,
  ticketCounts,
  ticketNumber,
  ticketSpan,
  ticketTab,
  ticketVisibleTo,
  type CompanyTicket,
  type QueuedMutation,
  type SyncChange,
  type TicketMember,
} from '../src';

const H = 3_600_000;
const T0 = '2026-11-10T00:00:00.000Z';
const at = (hours: number) => new Date(new Date(T0).getTime() + hours * H).toISOString();

const ticket = (over: Partial<CompanyTicket>): CompanyTicket => ({
  id: 't',
  number: 1,
  clientId: null,
  clientName: null,
  clientPhone: null,
  title: 'Leak',
  details: null,
  priority: 'normal',
  status: 'open',
  assigneeMemberId: 'emp',
  dueAt: T0,
  resolution: null,
  resolvedAt: null,
  createdBy: 'own',
  createdAt: T0,
  ...over,
});

const members: TicketMember[] = [
  { id: 'own', role: 'admin', managerId: null },
  { id: 'mgr', role: 'manager', managerId: null },
  { id: 'mgr2', role: 'manager', managerId: null },
  { id: 'emp', role: 'member', managerId: 'mgr' },
  { id: 'emp2', role: 'member', managerId: 'mgr' },
  { id: 'loose', role: 'member', managerId: null },
  { id: 'ven', role: 'vendor', managerId: null },
];

describe('due time', () => {
  it('is set from the priority: urgent 4h, high 1 day, normal 3 days, low 7 days', () => {
    expect(defaultDueAt('urgent', T0)).toBe(at(4));
    expect(defaultDueAt('high', T0)).toBe(at(24));
    expect(defaultDueAt('normal', T0)).toBe(at(72));
    expect(defaultDueAt('low', T0)).toBe(at(168));
  });
  it('numbers read TKT-0001', () => {
    expect(ticketNumber(1)).toBe('TKT-0001');
    expect(ticketNumber(12345)).toBe('TKT-12345');
  });
});

describe('escalation level', () => {
  const t = ticket({ priority: 'high', dueAt: T0 }); // window 24h
  it('is 0 until due, 1 past due, 2 past due plus the window again', () => {
    expect(escalationLevel(t, at(-5))).toBe(0);
    expect(escalationLevel(t, at(0))).toBe(0);
    expect(escalationLevel(t, at(0.001))).toBe(1);
    expect(escalationLevel(t, at(24))).toBe(1);
    expect(escalationLevel(t, at(24.001))).toBe(2);
    expect(escalationLevel(t, at(500))).toBe(2);
  });
  it('uses the priority window', () => {
    const urgent = ticket({ priority: 'urgent' });
    expect(escalationLevel(urgent, at(3))).toBe(1);
    expect(escalationLevel(urgent, at(5))).toBe(2);
    expect(escalationLevel(ticket({ priority: 'low' }), at(100))).toBe(1);
  });
  it('is 0 once resolved or closed, back after a reopen', () => {
    expect(escalationLevel({ ...t, status: 'resolved' }, at(100))).toBe(0);
    expect(escalationLevel({ ...t, status: 'closed' }, at(100))).toBe(0);
    expect(escalationLevel({ ...t, status: 'in_progress' }, at(100))).toBe(2);
  });
  it('treats a bad date as not late', () => {
    expect(escalationLevel(ticket({ dueAt: 'nope' }), at(1))).toBe(0);
  });
});

describe('who it escalated to', () => {
  it('level 1 is the assignee manager, level 2 the owner', () => {
    expect(escalatedTo(0, 'emp', members)).toBeNull();
    expect(escalatedTo(1, 'emp', members)).toBe('mgr');
    expect(escalatedTo(2, 'emp', members)).toBe('own');
  });
  it('level 1 goes to the owner when the assignee has no manager (or is a manager)', () => {
    expect(escalatedTo(1, 'loose', members)).toBe('own');
    expect(escalatedTo(1, 'mgr', members)).toBe('own');
  });
  it('skips a manager who has left', () => {
    expect(
      escalatedTo(
        1,
        'emp',
        members.map((m) => (m.id === 'mgr' ? { ...m, left: true } : m)),
      ),
    ).toBe('own');
  });
  it('is null when there is nobody to take it', () => {
    expect(
      escalatedTo(
        2,
        'emp',
        members.filter((m) => m.role !== 'admin'),
      ),
    ).toBeNull();
  });
});

describe('visibility mirrors the server', () => {
  const view = (t: Pick<CompanyTicket, 'assigneeMemberId' | 'createdBy'>, id: string) =>
    ticketVisibleTo(t, members.find((m) => m.id === id) ?? null, members);
  const toEmp = { assigneeMemberId: 'emp', createdBy: 'own' };
  it('the owner sees all', () => expect(view(toEmp, 'own')).toBe(true));
  it('a manager sees their reports, not another manager', () => {
    expect(view(toEmp, 'mgr')).toBe(true);
    expect(view(toEmp, 'mgr2')).toBe(false);
  });
  it('a manager sees what is assigned to or logged by them', () => {
    expect(view({ assigneeMemberId: 'mgr2', createdBy: 'own' }, 'mgr2')).toBe(true);
    expect(view({ assigneeMemberId: 'emp', createdBy: 'mgr2' }, 'mgr2')).toBe(true);
    expect(view({ assigneeMemberId: 'mgr2', createdBy: 'own' }, 'mgr')).toBe(false);
  });
  it('an employee sees only assigned to or logged by them', () => {
    expect(view(toEmp, 'emp')).toBe(true);
    expect(view(toEmp, 'emp2')).toBe(false);
    expect(view({ assigneeMemberId: 'emp2', createdBy: 'emp' }, 'emp')).toBe(true);
  });
  it('a vendor login and a stranger see nothing', () => {
    expect(view(toEmp, 'ven')).toBe(false);
    expect(ticketVisibleTo(toEmp, null, members)).toBe(false);
    expect(view({ assigneeMemberId: 'ven', createdBy: 'ven' }, 'ven')).toBe(false);
  });
});

describe('actions and tabs', () => {
  it('offers the moves the server allows', () => {
    expect(ticketActions('open')).toEqual(['start', 'resolve']);
    expect(ticketActions('in_progress')).toEqual(['resolve']);
    expect(ticketActions('resolved')).toEqual(['reopen', 'close']);
    expect(ticketActions('closed')).toEqual(['reopen']);
  });
  const all = [
    ticket({ id: 'ok', number: 1, dueAt: at(10) }),
    ticket({ id: 'soon', number: 2, dueAt: at(2) }),
    ticket({ id: 'l1', number: 3, dueAt: at(-1) }),
    ticket({ id: 'l2', number: 4, dueAt: at(-80), clientName: 'Goa Traders' }),
    ticket({ id: 'done', number: 5, status: 'resolved', resolvedAt: at(-3) }),
    ticket({ id: 'shut', number: 6, status: 'closed', resolvedAt: at(-1) }),
  ];
  it('puts each ticket on one tab', () => {
    expect(ticketTab(all[2]!, T0)).toBe('escalated');
    expect(ticketCounts(all, T0)).toEqual({ open: 2, escalated: 2, resolved: 2 });
    expect(escalatedCount(all, T0)).toBe(2);
  });
  it('sorts: open by due, escalated by level then lateness, resolved newest first', () => {
    expect(filterTickets(all, 'open', T0).map((t) => t.id)).toEqual(['soon', 'ok']);
    expect(filterTickets(all, 'escalated', T0).map((t) => t.id)).toEqual(['l2', 'l1']);
    expect(filterTickets(all, 'resolved', T0).map((t) => t.id)).toEqual(['shut', 'done']);
  });
  it('searches title, client and number', () => {
    expect(filterTickets(all, 'escalated', T0, 'goa').map((t) => t.id)).toEqual(['l2']);
    expect(filterTickets(all, 'open', T0, 'tkt-0002').map((t) => t.id)).toEqual(['soon']);
  });
});

describe('spans', () => {
  it('uses the biggest whole unit', () => {
    expect(ticketSpan(30 * 60_000)).toEqual({ n: 30, unit: 'm' });
    expect(ticketSpan(10_000)).toEqual({ n: 1, unit: 'm' });
    expect(ticketSpan(3 * H)).toEqual({ n: 3, unit: 'h' });
    expect(ticketSpan(-47 * H)).toEqual({ n: 47, unit: 'h' });
    expect(ticketSpan(72 * H)).toEqual({ n: 3, unit: 'd' });
  });
});

describe('materialise tickets', () => {
  let seq = 0;
  const row = (table: SyncTable, r: Record<string, unknown>): SyncChange => ({
    table,
    groupId: 'g',
    seq: ++seq,
    row: { group_id: 'g', deleted_at: null, ...r },
  });
  const q = (kind: string, payload: Record<string, unknown>, n: number): QueuedMutation =>
    ({
      clientMutationId: `m${n}`,
      kind,
      groupId: 'g',
      clientCreatedAt: '2026-11-11T00:00:00.000Z',
      payload,
      seq: n,
      attempts: 0,
      nextAttemptAt: 0,
    }) as unknown as QueuedMutation;
  const base = (status = 'open') => ({
    id: 't1',
    number: 7,
    client_id: 'c1',
    client_name: 'Goa Traders',
    client_phone: '99',
    title: 'Late delivery',
    priority: 'normal',
    status,
    assignee_member_id: 'emp',
    due_at: '2026-11-12T00:00:00+00:00',
    created_by: 'own',
    created_at: '2026-11-10T00:00:00+00:00',
  });
  const state = reconcile(emptyMirror(), [
    row(SyncTable.CompanyTickets, base()),
    row(SyncTable.CompanyTickets, { ...base(), id: 'gone', deleted_at: 'x' }),
    row(SyncTable.CompanyTicketEvents, {
      id: 'e1',
      ticket_id: 't1',
      kind: 'created',
      member_id: 'emp',
      created_by: 'own',
      created_at: '2026-11-10T00:00:00+00:00',
    }),
  ]).state;

  it('reads rows, normalising times, and drops removed ones', () => {
    const r = materialiseTickets(state, [], { groupId: 'g' });
    expect(r.tickets.map((t) => t.id)).toEqual(['t1']);
    expect(r.tickets[0]).toMatchObject({
      number: 7,
      clientName: 'Goa Traders',
      dueAt: '2026-11-12T00:00:00.000Z',
    });
    expect(r.events.map((e) => e.id)).toEqual(['e1']);
  });

  it('applies a queued reassign, resolve, comment and remove on top', () => {
    const set = {
      ticketId: 't1',
      clientId: 'c1',
      title: 'Late delivery',
      details: null,
      priority: 'high',
      assigneeMemberId: 'emp2',
      dueAt: '2026-11-13T00:00:00.000Z',
    };
    const r = materialiseTickets(
      state,
      [
        q('company_ticket.set', set, 1),
        q('company_ticket.status', { ticketId: 't1', status: 'resolved', note: 'Sent stock' }, 2),
        q('company_ticket_comment.add', { eventId: 'e2', ticketId: 't1', body: 'Phoned' }, 3),
      ],
      { groupId: 'g', myMemberId: 'emp' },
    );
    expect(r.tickets[0]).toMatchObject({
      assigneeMemberId: 'emp2',
      priority: 'high',
      number: 7,
      clientName: 'Goa Traders',
      status: 'resolved',
      resolution: 'Sent stock',
      pending: true,
    });
    expect(r.events.map((e) => e.kind)).toEqual(['created', 'assigned', 'status', 'comment']);
    const gone = materialiseTickets(state, [q('company_ticket.remove', { ticketId: 't1' }, 1)], {
      groupId: 'g',
    });
    expect(gone.tickets).toEqual([]);
    expect(gone.events).toEqual([]);
  });

  it('a reopen gets a fresh due time; a new ticket shows its picked client', () => {
    const resolved = reconcile(emptyMirror(), [
      row(SyncTable.CompanyTickets, base('resolved')),
    ]).state;
    const r = materialiseTickets(
      resolved,
      [q('company_ticket.status', { ticketId: 't1', status: 'open', note: null }, 1)],
      { groupId: 'g' },
    );
    expect(r.tickets[0]!.dueAt).toBe('2026-11-14T00:00:00.000Z'); // queued at 11-11 + 3 days
    const created = materialiseTickets(
      emptyMirror(),
      [
        q(
          'company_ticket.set',
          {
            ticketId: 'n',
            clientId: 'c9',
            title: 'New',
            details: null,
            priority: 'low',
            assigneeMemberId: 'emp',
            dueAt: at(1),
          },
          1,
        ),
      ],
      { groupId: 'g', clientLookup: (id) => (id === 'c9' ? { name: 'Asha', phone: '98' } : null) },
    );
    expect(created.tickets[0]).toMatchObject({
      clientName: 'Asha',
      clientPhone: '98',
      number: 0,
      status: 'open',
    });
    expect(created.events.map((e) => e.kind)).toEqual(['created']);
  });

  it('drops a ticket the server no longer lists, with its timeline', () => {
    const { state: next, removed } = purgeCompanyInvisible(
      state,
      {},
      {
        g: { dates: [], events: [], tickets: ['other'] },
      },
    );
    expect(removed.map((x) => x.id).sort()).toEqual(['e1', 'gone', 't1']);
    expect(materialiseTickets(next, [], { groupId: 'g' }).tickets).toEqual([]);
  });
});
