/**
 * Company clients, inquiries and follow-ups on the web: pure ports of the phone's `data/companyClients.ts`.
 * No React here; `useCompanyClients.ts` wires these to the sync mirror. Payloads match the phone 1:1.
 */

import {
  clientsToReceive,
  groupFollowUps,
  materialiseClients,
  materialiseWorkTasks,
  MutationKind,
  nextFollowUpDay,
  rowsFor,
  SyncTable,
  type ClientAssignee,
  type ClientNote,
  type CompanyClient,
  type CompanyClientSetPayload,
  type CompanyInquiry,
  type CompanyInquirySetPayload,
  type CompanyWorkSetPayload,
  type MirrorState,
  type MirrorWorkTask,
  type NextFollowUp,
  type QueuedMutation,
} from '@waves/core';

const NO_QUEUE: readonly QueuedMutation[] = [];

/** A member row as the web needs it: role is the raw group_members.role. */
export interface CompanyMember {
  readonly id: string;
  readonly profileId: string | null;
  readonly role: string;
  readonly managerId: string | null;
  readonly left: boolean;
  readonly name: string;
}

/** Live and past members from the mirror; `names` (member id -> display name) overrides the ghost name. */
export function companyMembers(
  mirror: MirrorState,
  groupId: string,
  names: ReadonlyMap<string, string> = new Map(),
): CompanyMember[] {
  const rows = rowsFor(mirror, SyncTable.GroupMembers, groupId) as unknown as {
    id: string;
    profile_id: string | null;
    ghost_name: string | null;
    role?: string | null;
    manager_id?: string | null;
    left_at: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    profileId: r.profile_id,
    role: r.role ?? 'member',
    managerId: r.manager_id ?? null,
    left: !!r.left_at,
    name: names.get(r.id) || r.ghost_name || '',
  }));
}

export interface ClientsView {
  readonly clients: readonly CompanyClient[];
  readonly notes: readonly ClientNote[];
  readonly inquiries: readonly CompanyInquiry[];
  readonly assigneeIds: (clientId: string) => string[];
  readonly canManage: boolean;
  readonly canAdd: boolean;
  readonly myMemberId: string | null;
  readonly owners: readonly CompanyMember[];
  readonly memberName: (id: string | null) => string;
}

/** Who the viewer is in this company. */
export function viewerRole(members: readonly CompanyMember[], profileId: string | null) {
  const me = profileId ? (members.find((m) => m.profileId === profileId && !m.left) ?? null) : null;
  const isOwner = me?.role === 'admin';
  const isManager = me?.role === 'manager';
  const isVendor = me?.role === 'vendor';
  return { me, isOwner, isManager, isVendor, canManage: isOwner || isManager };
}

export function buildClientsView(
  mirror: MirrorState,
  groupId: string,
  members: readonly CompanyMember[],
  profileId: string | null,
): ClientsView {
  const { me, isVendor, canManage } = viewerRole(members, profileId);
  const myId = me?.id ?? null;
  const isEmployee = !canManage && !isVendor && me?.role === 'member';
  const all = materialiseClients(mirror, NO_QUEUE, { groupId });
  const mine = new Set(all.assignees.filter((a) => a.memberId === myId).map((a) => a.clientId));
  const clients = all.clients.filter((c) =>
    canManage ? true : isEmployee ? c.ownerMemberId === myId || mine.has(c.id) : false,
  );
  const ids = new Set(clients.map((c) => c.id));
  const byClient = new Map<string, ClientAssignee[]>();
  for (const a of all.assignees) byClient.set(a.clientId, [...(byClient.get(a.clientId) ?? []), a]);
  const owners = members.filter((m) => !m.left && m.role !== 'vendor');
  const names = new Map(members.map((m) => [m.id, m.name]));
  return {
    clients,
    notes: all.notes.filter((n) => ids.has(n.clientId)),
    inquiries: all.inquiries.filter((i) => ids.has(i.clientId)),
    assigneeIds: (clientId) => {
      const owner = clients.find((c) => c.id === clientId)?.ownerMemberId ?? null;
      const rest = (byClient.get(clientId) ?? [])
        .map((a) => a.memberId)
        .filter((m) => m !== owner);
      return [...(owner ? [owner] : []), ...new Set(rest)];
    },
    canManage,
    canAdd: canManage || isEmployee,
    myMemberId: myId,
    owners,
    memberName: (id) => (id ? (names.get(id) ?? '') : ''),
  };
}

export { clientsToReceive };

export type ClientInput = Omit<CompanyClientSetPayload, 'clientId'> & { clientId?: string };

/** Payload for CompanyClientSet: add (fresh id) or save (its id). */
export function clientSetPayload(input: ClientInput, id: string = crypto.randomUUID()) {
  const clientId = input.clientId ?? id;
  return {
    clientId,
    payload: {
      ...input,
      clientId,
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      need: input.need?.trim() || null,
      address: input.address?.trim() || null,
      lostReason: input.stage === 'lost' ? input.lostReason?.trim() || null : null,
    } as Record<string, unknown>,
  };
}

/** The same client with one stage change. */
export function stageChange(
  client: CompanyClient,
  stage: CompanyClient['stage'],
  lostReason: string | null = null,
): ClientInput {
  return {
    clientId: client.id,
    name: client.name,
    phone: client.phone,
    need: client.need,
    source: client.source,
    expectedValueMinor: client.expectedValueMinor?.toString() ?? null,
    address: client.address,
    ownerMemberId: client.ownerMemberId,
    stage,
    lostReason,
  };
}

export type InquiryInput = Omit<CompanyInquirySetPayload, 'inquiryId'> & { inquiryId?: string };

export function inquirySetPayload(input: InquiryInput, id: string = crypto.randomUUID()) {
  const inquiryId = input.inquiryId ?? id;
  return {
    inquiryId,
    payload: {
      ...input,
      inquiryId,
      title: input.title.trim().slice(0, 120),
      details: input.details?.trim() || null,
    } as Record<string, unknown>,
  };
}

export const inquiryRejectPayload = (i: {
  inquiryId: string;
  rejected: boolean;
  reason?: string | null;
}) => ({
  inquiryId: i.inquiryId,
  rejected: i.rejected,
  reason: i.rejected ? i.reason?.trim() || null : null,
});

export const clientNotePayload = (
  i: { clientId: string; body: string },
  noteId: string = crypto.randomUUID(),
) => ({ noteId, clientId: i.clientId, body: i.body.trim() });

export type FollowUpScope = 'mine' | 'all';

/** Open follow-ups (work tasks linked to a client), grouped Overdue / Today / This week / Later. */
export function buildFollowUps(
  mirror: MirrorState,
  groupId: string,
  myId: string | null,
  today: string,
  scope: FollowUpScope = 'all',
) {
  const tasks = materialiseWorkTasks(mirror, NO_QUEUE, { groupId });
  const linked = tasks.filter((t) => t.clientId && (scope === 'all' || t.memberId === myId));
  const groups = groupFollowUps(linked, today);
  const all = [...groups.overdue, ...groups.today, ...groups.week, ...groups.later];
  return {
    groups,
    all,
    today,
    overdue: groups.overdue.length,
    dueToday: groups.today.length,
    byClient: (clientId: string): MirrorWorkTask[] => all.filter((t) => t.clientId === clientId),
  };
}

/** The CompanyWorkSet payload for a new follow-up: assigned to `memberId`, on `day`. */
export function addFollowUpPayload(
  input: { clientId: string; memberId: string; day: string; title: string },
  taskId: string = crypto.randomUUID(),
): CompanyWorkSetPayload {
  return {
    taskId,
    memberId: input.memberId,
    day: input.day,
    title: input.title,
    projectId: null,
    status: 'todo',
    blockedReason: null,
    note: null,
    dueTime: null,
    clientId: input.clientId,
  };
}

/** Done payload for a follow-up, then (optionally) the next one. Leaves the saved client link alone. */
export function completeFollowUpPayloads(
  task: MirrorWorkTask,
  next: NextFollowUp,
  today: string,
  nextId: string = crypto.randomUUID(),
): CompanyWorkSetPayload[] {
  const out: CompanyWorkSetPayload[] = [
    {
      taskId: task.id,
      memberId: task.memberId,
      day: task.day,
      title: task.title,
      projectId: task.projectId,
      status: 'done',
      blockedReason: null,
      note: task.note,
      dueTime: task.dueTime,
    },
  ];
  const day = nextFollowUpDay(next, today);
  if (day && task.clientId)
    out.push({
      taskId: nextId,
      memberId: task.memberId,
      day,
      title: task.title,
      projectId: null,
      status: 'todo',
      blockedReason: null,
      note: null,
      dueTime: null,
      clientId: task.clientId,
    });
  return out;
}

export const clientKinds = {
  set: MutationKind.CompanyClientSet,
  remove: MutationKind.CompanyClientRemove,
  assign: MutationKind.CompanyClientAssign,
  note: MutationKind.CompanyClientNoteAdd,
  inquirySet: MutationKind.CompanyInquirySet,
  inquiryReject: MutationKind.CompanyInquiryReject,
  inquiryRemove: MutationKind.CompanyInquiryRemove,
  work: MutationKind.CompanyWorkSet,
} as const;
