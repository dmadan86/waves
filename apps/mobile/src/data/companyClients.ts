/**
 * Company clients and inquiries: one record with a stage, notes, and follow-ups (company tasks linked by client).
 * The server's row-level security decides who sees which client; the filter here only keeps a phone that was once
 * an owner's from showing more than the viewer's role allows today.
 */
import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';

import {
  clientsToReceive,
  groupFollowUps,
  materialiseClients,
  MutationKind,
  nextFollowUpDay,
  type ClientNote,
  type CompanyClient,
  type CompanyClientSetPayload,
  type MirrorWorkTask,
  type NextFollowUp,
} from '@waves/core';

import { useCompanyDocs } from '@/data/companyDocuments';
import { useCompanyEntries } from '@/data/companyEntries';
import { todayIso } from '@/data/personal';
import { useWorkTasks, useSetWorkTask } from '@/data/companyWorkday';
import { displayName, type MemberRow } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useSync } from '@/sync';

export interface ClientsView {
  /** The clients this viewer may see. */
  readonly clients: readonly CompanyClient[];
  readonly notes: readonly ClientNote[];
  /** Owner or manager: sees every client, moves stages, reassigns and removes. */
  readonly canManage: boolean;
  /** May add an inquiry and notes: owner, manager or employee (not a vendor login). */
  readonly canAdd: boolean;
  readonly myMemberId: string | null;
  /** Who can be picked to follow up: live employees, managers and owners the viewer can read. */
  readonly owners: readonly MemberRow[];
  readonly memberName: (id: string | null) => string;
  readonly currency: string;
  readonly ready: boolean;
}

export function useCompanyClients(groupId: string): ClientsView {
  const { mirror, queue } = useSync();
  const view = useCompanyEntries(groupId);
  const myId = view.me?.id ?? null;
  const canManage = view.isOwner || view.isManager;
  const isEmployee = !canManage && !view.isVendor && view.me?.role === 'member';
  return useMemo(() => {
    const all = materialiseClients(mirror, queue, { groupId });
    const clients = all.clients.filter((c) =>
      canManage ? true : isEmployee ? c.ownerMemberId === myId : false,
    );
    const ids = new Set(clients.map((c) => c.id));
    const owners = view.members.filter((m) => !m.left_at && m.role !== 'vendor');
    const names = new Map(owners.map((m) => [m.id, displayName(m)]));
    return {
      clients,
      notes: all.notes.filter((n) => ids.has(n.clientId)),
      canManage,
      canAdd: canManage || isEmployee,
      myMemberId: myId,
      owners,
      memberName: (id: string | null) => (id ? (names.get(id) ?? '') : ''),
      currency: view.currency,
      ready: view.ready,
    };
  }, [
    mirror,
    queue,
    groupId,
    canManage,
    isEmployee,
    myId,
    view.members,
    view.currency,
    view.ready,
  ]);
}

/** What clients owe: unpaid bill balances linked to each client (the viewer's own bills only, for a manager). */
export function useClientMoney(groupId: string) {
  const { docs } = useCompanyDocs(groupId);
  return useMemo(() => {
    const r = clientsToReceive(docs);
    return { ...r, docs };
  }, [docs]);
}

export type ClientInput = Omit<CompanyClientSetPayload, 'clientId'> & { clientId?: string };

/** Add a client (a fresh id) or save one (its id). */
export function useSetClient(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: async (input: ClientInput) => {
      const clientId = input.clientId ?? randomUUID();
      await mutate(MutationKind.CompanyClientSet, groupId, {
        ...input,
        clientId,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        need: input.need?.trim() || null,
        address: input.address?.trim() || null,
        lostReason: input.stage === 'lost' ? input.lostReason?.trim() || null : null,
      });
      return clientId;
    },
  });
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

export function useRemoveClient(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (clientId: string) =>
      mutate(MutationKind.CompanyClientRemove, groupId, { clientId }),
  });
}

export function useAddClientNote(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: { clientId: string; body: string }) =>
      mutate(MutationKind.CompanyClientNoteAdd, groupId, {
        noteId: randomUUID(),
        clientId: input.clientId,
        body: input.body.trim(),
      }),
  });
}

export type FollowUpScope = 'mine' | 'all';

/** Open follow-ups (tasks linked to a client), grouped Overdue / Today / This week / Later. */
export function useFollowUps(groupId: string, scope: FollowUpScope = 'all') {
  const tasks = useWorkTasks(groupId);
  const view = useCompanyEntries(groupId);
  const myId = view.me?.id ?? null;
  return useMemo(() => {
    const today = todayIso();
    const linked = tasks.filter((t) => t.clientId && (scope === 'all' || t.memberId === myId));
    const groups = groupFollowUps(linked, today);
    return {
      groups,
      today,
      overdue: groups.overdue.length,
      dueToday: groups.today.length,
      /** Open follow-ups per client, soonest first. */
      byClient: (clientId: string): MirrorWorkTask[] =>
        [...groups.overdue, ...groups.today, ...groups.week, ...groups.later].filter(
          (t) => t.clientId === clientId,
        ),
    };
  }, [tasks, scope, myId]);
}

/** Add a follow-up task for a client: assigned to `memberId`, on `day`. */
export function useAddFollowUp(groupId: string) {
  const set = useSetWorkTask(groupId);
  const { t } = useStrings();
  return useMutation({
    mutationFn: async (input: {
      clientId: string;
      clientName: string;
      memberId: string;
      day: string;
      title?: string;
    }) => {
      const taskId = randomUUID();
      await set.mutateAsync({
        taskId,
        memberId: input.memberId,
        day: input.day,
        title: input.title ?? fill(t.companyClients.followTitle, { name: input.clientName }),
        projectId: null,
        status: 'todo',
        blockedReason: null,
        note: null,
        dueTime: null,
        clientId: input.clientId,
      });
      return taskId;
    },
  });
}

/** Mark a follow-up done, then (optionally) plan the next one. Leaves the saved client link alone. */
export function useCompleteFollowUp(groupId: string) {
  const set = useSetWorkTask(groupId);
  return useMutation({
    mutationFn: async (input: { task: MirrorWorkTask; next: NextFollowUp }) => {
      const { task } = input;
      await set.mutateAsync({
        taskId: task.id,
        memberId: task.memberId,
        day: task.day,
        title: task.title,
        projectId: task.projectId,
        status: 'done',
        blockedReason: null,
        note: task.note,
        dueTime: task.dueTime,
      });
      const day = nextFollowUpDay(input.next, todayIso());
      if (day && task.clientId)
        await set.mutateAsync({
          taskId: randomUUID(),
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
    },
  });
}
