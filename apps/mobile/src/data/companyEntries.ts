/**
 * Company expenses, read local-first and written through the offline queue.
 *
 * Who sees what is the server's job, not this file's: row-level security hands an
 * employee only their own entries (and only their own member row), an admin
 * everything. So `useCompanyEntries` simply shows what the mirror holds, and the
 * statement math in `@waves/core` is right for both.
 */

import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';

import {
  companyEntryFromRow,
  MutationKind,
  materialiseCompanyEntries,
  type CompanyEntry,
  type CompanyEntryData,
  type CompanyEntryRow,
} from '@waves/core';

import { useGroup } from '@/data/hooks';
import { isViewer, type MemberRow } from '@/data/types';
import { useViewerId } from '@/lib/auth';
import { useSync } from '@/sync';

export interface CompanyView {
  readonly entries: readonly CompanyEntry[];
  /** Every member row this viewer can read: all of them for an admin, only themself otherwise. */
  readonly members: readonly MemberRow[];
  readonly me: MemberRow | null;
  readonly isAdmin: boolean;
  readonly currency: string;
  readonly name: string;
  readonly ready: boolean;
}

export function useCompanyEntries(groupId: string): CompanyView {
  const { mirror, queue, hydrated } = useSync();
  const { group, members } = useGroup(groupId);
  const viewerId = useViewerId();
  const currency = group.data?.default_currency ?? 'INR';

  // A rate set offline reads as set at once: replay the queued ones over the rows.
  const people = useMemo(() => {
    const rows = members.data ?? [];
    const rates = new Map<string, string | null>();
    for (const mutation of [...queue].sort((a, b) => a.seq - b.seq)) {
      if (
        mutation.groupId !== groupId ||
        mutation.rejection ||
        mutation.kind !== MutationKind.CompanyMemberRateSet
      )
        continue;
      const payload = mutation.payload as unknown as {
        memberId: string;
        dailyRateMinor: string | null;
      };
      rates.set(payload.memberId, payload.dailyRateMinor);
    }
    return rates.size === 0
      ? rows
      : rows.map((row) =>
          rates.has(row.id) ? { ...row, daily_rate_minor: rates.get(row.id) } : row,
        );
  }, [members.data, queue, groupId]);
  const me = people.find((member) => isViewer(member, viewerId) && !member.left_at) ?? null;
  const isAdmin = me?.role === 'admin';
  // The server only sends an employee their own rows, but a phone that was once
  // an admin's still holds the rest: never show them to a non-admin.
  const entries = useMemo(
    () =>
      materialiseCompanyEntries(mirror, queue, { groupId, currency, myMemberId: me?.id ?? null })
        .map((row) => companyEntryFromRow(row as unknown as CompanyEntryRow))
        .filter((entry) => isAdmin || entry.memberId === me?.id),
    [mirror, queue, groupId, currency, me?.id, isAdmin],
  );
  return {
    entries,
    members: isAdmin ? people : people.filter((member) => member.id === me?.id),
    me,
    isAdmin,
    currency,
    name: group.data?.name ?? '',
    ready: hydrated && group.data !== null && group.data !== undefined,
  };
}

/** Add an entry. `entryId` is the client-chosen idempotency key. */
export function useAddCompanyEntry(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: async (input: {
      entryId: string;
      memberId: string;
      entryKind: 'expense' | 'advance' | 'allowance' | 'wages' | 'reimbursement';
      data: CompanyEntryData;
    }): Promise<string> => {
      await mutate(MutationKind.CompanyEntryCreate, groupId, { ...input });
      return input.entryId;
    },
  });
}

export function useUpdateCompanyEntry(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: { entryId: string; patch: CompanyEntryData }) =>
      mutate(MutationKind.CompanyEntryUpdate, groupId, { ...input }),
  });
}

export function useVoidCompanyEntry(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: { entryId: string; reason?: string }) =>
      mutate(MutationKind.CompanyEntryVoid, groupId, { ...input }),
  });
}

/** Admin: set (or clear with null) an employee's default daily bata rate. */
export function useSetCompanyRate(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: { memberId: string; dailyRateMinor: string | null }) =>
      mutate(MutationKind.CompanyMemberRateSet, groupId, { ...input }),
  });
}
