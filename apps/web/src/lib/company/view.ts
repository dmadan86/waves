'use client';

/**
 * One company, read from the sync mirror: the web port of the phone's
 * `useCompanyEntries`. Who sees what is the server's job (RLS hands an employee
 * only their own rows); this adds the role flags and the claim helpers. There is
 * no offline queue on the web, so nothing is overlaid.
 */

import { useEffect, useMemo, useState } from 'react';

import {
  companyEntryFromRow,
  gstFieldsApply,
  materialiseCompanyEntries,
  materialiseGroup,
  materialiseMembers,
  needsSecondOwner,
  parseCompanyPolicies,
  rowsFor,
  SyncTable,
  type CompanyEntry,
  type CompanyEntryRow,
  type CompanyPolicies,
  type MirrorGroup,
  type MirrorMember,
} from '@waves/core';

import { useAuth } from '@/lib/auth';
import { NO_QUEUE, useSync } from '@/lib/sync';
import { supabase } from '@/lib/waves';

export type CompanyMember = MirrorMember & {
  profile?: { display_name: string | null; avatar_url: string | null } | null;
  role?: 'admin' | 'manager' | 'member' | 'vendor';
  daily_rate_minor?: string | null;
};

/** The columns of the group row a company page reads. */
export interface CompanyGroup {
  id: string;
  name: string | null;
  type: string;
  default_currency: string;
  country_code: string | null;
  created_by: string | null;
  photo_path: string | null;
  suspended_at: string | null;
  slot_lapsed_at: string | null;
  deleted_at: string | null;
  company_approvals_enabled?: boolean;
  company_default_daily_rate_minor?: string | null;
  company_default_mileage_rate_minor?: string | null;
  company_policies?: unknown;
  company_policy_revision?: number;
  company_second_approval?: boolean;
  company_second_approval_threshold_minor?: string | null;
}

export interface DirectoryPerson {
  member_id: string;
  display_name: string;
  role: 'admin' | 'manager' | 'member' | 'vendor';
  manager_id: string | null;
  detail: boolean;
}

export interface CompanyView {
  readonly group: CompanyGroup | null;
  readonly entries: readonly CompanyEntry[];
  /** Every member row this viewer can read. */
  readonly members: readonly CompanyMember[];
  readonly me: CompanyMember | null;
  readonly isAdmin: boolean;
  readonly isOwner: boolean;
  readonly isManager: boolean;
  readonly isVendor: boolean;
  readonly suspended: boolean;
  readonly hasManagers: boolean;
  readonly manageableIds: ReadonlySet<string>;
  readonly currency: string;
  readonly name: string;
  readonly approvalsEnabled: boolean;
  readonly policies: CompanyPolicies;
  readonly gstEnabled: boolean;
  readonly needsOtherOwner: (entry: CompanyEntry) => boolean;
  readonly canApprove: (entry: CompanyEntry) => boolean;
  readonly receiptEntryIds: ReadonlySet<string>;
  readonly directory: readonly DirectoryPerson[];
  readonly ready: boolean;
}

/** Names-only directory (owners, my manager, my team, me) from the server; empty until it answers. */
function useDirectory(groupId: string, enabled: boolean): readonly DirectoryPerson[] {
  const [people, setPeople] = useState<readonly DirectoryPerson[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void supabase.rpc('waves_company_people', { p_group_id: groupId }).then(({ data, error }) => {
      if (active && !error) setPeople((data ?? []) as DirectoryPerson[]);
    });
    return () => {
      active = false;
    };
  }, [groupId, enabled]);
  return people;
}

export function useCompanyView(groupId: string): CompanyView {
  const { mirror, hydrated } = useSync();
  const { profileId } = useAuth();

  const group = useMemo(() => {
    const built = materialiseGroup(mirror, NO_QUEUE, groupId) as MirrorGroup | undefined;
    return built && !built.deleted_at ? (built as unknown as CompanyGroup) : null;
  }, [mirror, groupId]);

  const members = useMemo(
    () => materialiseMembers(mirror, NO_QUEUE, { groupId, includeLeft: true }) as CompanyMember[],
    [mirror, groupId],
  );

  const currency = group?.default_currency ?? 'INR';
  const approvalsEnabled = group?.company_approvals_enabled === true;
  const me = members.find((m) => profileId && m.profile_id === profileId && !m.left_at) ?? null;
  const isOwner = me?.role === 'admin';
  const isManager = me?.role === 'manager';
  const isVendor = me?.role === 'vendor';
  const isAdmin = isOwner || isManager;
  const directory = useDirectory(groupId, me !== null);

  // A phone that was once an owner's may still hold more than today's role allows: narrow it.
  const visibleIds = useMemo(() => {
    const ids = new Set<string>();
    if (isManager) {
      if (me) ids.add(me.id);
      for (const person of directory) if (person.detail) ids.add(person.member_id);
      return ids;
    }
    for (const m of members) if (isOwner || m.id === me?.id) ids.add(m.id);
    return ids;
  }, [members, isOwner, isManager, me, directory]);

  const manageableIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of members) {
      if (m.id === me?.id || m.left_at || m.role === 'vendor') continue;
      if (isManager && !visibleIds.has(m.id)) continue;
      if (isOwner ? m.role !== 'admin' : isManager && m.manager_id === me?.id) ids.add(m.id);
    }
    return ids;
  }, [members, isOwner, isManager, me?.id, visibleIds]);

  const myId = me?.id ?? null;
  const entries = useMemo(
    () =>
      materialiseCompanyEntries(mirror, NO_QUEUE, {
        groupId,
        currency,
        myMemberId: myId,
        myIsManager: isManager,
        approvalsEnabled,
      })
        .map((row) => companyEntryFromRow(row as unknown as CompanyEntryRow))
        .filter((entry) =>
          entry.paidByCompany
            ? isOwner || (isManager && myId !== null && entry.createdBy === myId)
            : visibleIds.has(entry.memberId),
        ),
    [mirror, groupId, currency, myId, visibleIds, approvalsEnabled, isOwner, isManager],
  );

  const ownerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of members) if (m.role === 'admin' && !m.left_at) ids.add(m.id);
    for (const person of directory) if (person.role === 'admin') ids.add(person.member_id);
    return ids;
  }, [members, directory]);

  const secondEnabled = group?.company_second_approval === true && approvalsEnabled && ownerIds.size > 1;
  const secondThreshold = group?.company_second_approval_threshold_minor
    ? BigInt(group.company_second_approval_threshold_minor)
    : null;
  const needsOtherOwner = (entry: CompanyEntry): boolean =>
    needsSecondOwner({
      enabled: secondEnabled,
      approvalsEnabled,
      thresholdMinor: secondThreshold,
      ownerCount: ownerIds.size,
      creatorIsOwner: entry.createdBy !== null && ownerIds.has(entry.createdBy),
      amount: entry.amount,
    });
  const canApprove = (entry: CompanyEntry): boolean =>
    isOwner
      ? !needsOtherOwner(entry) || entry.createdBy !== me?.id
      : isManager && !needsOtherOwner(entry);

  const receiptEntryIds = useMemo(
    () =>
      new Set(
        (
          rowsFor(mirror, SyncTable.CompanyEntryAttachments, groupId) as unknown as {
            entry_id: string;
            deleted_at: string | null;
          }[]
        )
          .filter((row) => row.deleted_at === null)
          .map((row) => row.entry_id),
      ),
    [mirror, groupId],
  );

  return {
    group,
    entries,
    members: members.filter((m) => visibleIds.has(m.id)),
    me,
    isAdmin,
    isOwner,
    isManager,
    isVendor,
    suspended: group?.suspended_at != null || group?.slot_lapsed_at != null,
    hasManagers: members.some((m) => m.role === 'manager' && !m.left_at),
    manageableIds,
    currency,
    name: group?.name ?? '',
    approvalsEnabled,
    policies: parseCompanyPolicies(group?.company_policies),
    gstEnabled: gstFieldsApply(group?.country_code, currency),
    needsOtherOwner,
    canApprove,
    receiptEntryIds,
    directory,
    ready: hydrated && group !== null,
  };
}

/** A member's name for the page: the profile's, else the ghost's, else a stand-in. */
export function memberName(member: CompanyMember | undefined, someone: string): string {
  const name = (member?.profile?.display_name ?? member?.ghost_name ?? '')
    .replace(/[-]/g, '')
    .trim();
  return name || someone;
}

/** Claims this viewer can act on now: an owner sees all, a manager their team's (never their own). */
export function awaitingApprovals(view: CompanyView): CompanyEntry[] {
  return view.entries.filter(
    (e) =>
      !e.deleted &&
      e.status === 'submitted' &&
      (view.isOwner || e.memberId !== view.me?.id) &&
      view.canApprove(e),
  );
}

export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
