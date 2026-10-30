/**
 * Company expenses, read local-first and written through the offline queue.
 *
 * Who sees what is the server's job, not this file's: row-level security hands an
 * employee only their own entries (and only their own member row), an admin
 * everything. So `useCompanyEntries` simply shows what the mirror holds, and the
 * statement math in `@waves/core` is right for both.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';

import {
  employeeIdTaken,
  normaliseEmployeeId,
  companyEntryFromRow,
  MutationKind,
  materialiseCompanyEntries,
  materialiseCompanyEntryAttachments,
  materialiseCompanyProjects,
  materialiseProjectMembers,
  materialiseVendors,
  materialiseWageSplits,
  needsSecondOwner,
  poolBalance,
  parseCompanyPolicies,
  rowsFor,
  SyncTable,
  gstFieldsApply,
  type CompanyPolicies,
  type CompanyReimbursePayload,
  type CompanyPoolPostPayload,
  type CompanyProjectSetPayload,
  type MirrorWageSplit,
  type CompanyWagePayPayload,
  type CompanyEntry,
  type CompanyEntryData,
  type CompanyEntryRow,
} from '@waves/core';

import { useGroup } from '@/data/hooks';
import { isViewer, type MemberRow } from '@/data/types';
import { useViewerId } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { pickAlbumPhoto, captureReceipt, type PickedImage } from '@/lib/image';
import { putImage, removeRestrictedImage } from '@/lib/storage';
import { useSync } from '@/sync';

export interface CompanyView {
  readonly entries: readonly CompanyEntry[];
  /** The same without this phone's queued changes. */
  readonly settledEntries: readonly CompanyEntry[];
  /** Every member row this viewer can read: all of them for an admin, only themself otherwise. */
  readonly members: readonly MemberRow[];
  readonly me: MemberRow | null;
  /** Can manage people's entries: an owner (everyone) or a manager (their own team). */
  readonly isAdmin: boolean;
  /** An owner: company settings, pools, sites, promotions. */
  readonly isOwner: boolean;
  readonly isManager: boolean;
  /** A vendor's own login: sees only their ledger with this company. */
  readonly isVendor: boolean;
  /** Managers with at least one team member or pool entry exist (progressive disclosure). */
  readonly hasManagers: boolean;
  /** Whom the viewer may record money entries for (owner: everyone, manager: own team). */
  readonly manageableIds: ReadonlySet<string>;
  readonly currency: string;
  readonly name: string;
  /** New entries wait for an admin's approval (off by default). */
  readonly approvalsEnabled: boolean;
  /** The company-wide default daily bata rate, minor units, or null. */
  readonly defaultRateMinor: bigint | null;
  /** Company default mileage rate per km, minor units, or null. */
  readonly defaultMileageRateMinor: bigint | null;
  readonly policies: CompanyPolicies;
  readonly policyRevision: number;
  /** GST and vendor fields apply (India, rupees). */
  readonly gstEnabled: boolean;
  /** A second owner's approval is on (and approvals, and two owners): the toggle's own state. */
  readonly secondApproval: boolean;
  readonly secondApprovalThresholdMinor: bigint | null;
  /** The claim needs an owner other than its creator to approve it. */
  readonly needsOtherOwner: (entry: CompanyEntry) => boolean;
  /** This viewer may approve the claim now: a reviewer, and an owner other than the creator when a second owner is needed. */
  readonly canApprove: (entry: CompanyEntry) => boolean;
  /** Entries that have at least one live photo (for the receipt rule). */
  readonly receiptEntryIds: ReadonlySet<string>;
  readonly ready: boolean;
}

export function useCompanyEntries(groupId: string): CompanyView {
  const { mirror, queue, hydrated } = useSync();
  const { group, members } = useGroup(groupId);
  const viewerId = useViewerId();
  const currency = group.data?.default_currency ?? 'INR';
  const approvalsEnabled = group.data?.company_approvals_enabled === true;
  const defaultRate = group.data?.company_default_daily_rate_minor;

  // A rate set offline reads as set at once: replay the queued ones over the rows.
  const { people, defaultMileage, policies, policyRevision } = useMemo(() => {
    const rows = members.data ?? [];
    let defaultMileage = group.data?.company_default_mileage_rate_minor ?? null;
    let policies = parseCompanyPolicies(group.data?.company_policies);
    let policyRevision = group.data?.company_policy_revision ?? 0;
    const rates = new Map<string, string | null>();
    const mileage = new Map<string, string | null>();
    for (const mutation of [...queue].sort((a, b) => a.seq - b.seq)) {
      if (mutation.groupId !== groupId || mutation.rejection) continue;
      if (mutation.kind === MutationKind.CompanyMileageRateSet) {
        const p = mutation.payload as unknown as {
          memberId: string | null;
          rateMinor: string | null;
        };
        if (p.memberId) mileage.set(p.memberId, p.rateMinor);
        else defaultMileage = p.rateMinor;
        continue;
      }
      if (mutation.kind === MutationKind.CompanyPoliciesSet) {
        // A queued edit reads as saved at once and moves the revision the next edit names.
        const p = mutation.payload as unknown as { policies: unknown };
        policies = parseCompanyPolicies(p.policies);
        policyRevision += 1;
        continue;
      }
      if (mutation.kind !== MutationKind.CompanyMemberRateSet) continue;
      const payload = mutation.payload as unknown as {
        memberId: string;
        dailyRateMinor: string | null;
      };
      rates.set(payload.memberId, payload.dailyRateMinor);
    }
    const people =
      rates.size === 0 && mileage.size === 0
        ? rows
        : rows.map((row) => ({
            ...row,
            ...(rates.has(row.id) ? { daily_rate_minor: rates.get(row.id) } : {}),
            ...(mileage.has(row.id) ? { mileage_rate_minor: mileage.get(row.id) } : {}),
          }));
    return { people, defaultMileage, policies, policyRevision };
  }, [
    members.data,
    queue,
    groupId,
    group.data?.company_default_mileage_rate_minor,
    group.data?.company_policies,
    group.data?.company_policy_revision,
  ]);
  const me = people.find((member) => isViewer(member, viewerId) && !member.left_at) ?? null;
  const isOwner = me?.role === 'admin';
  const isManager = me?.role === 'manager';
  const isVendor = me?.role === 'vendor';
  const isAdmin = isOwner || isManager;
  const hasManagers = people.some((member) => member.role === 'manager' && !member.left_at);
  // The server only sends each person what they may read, but a phone that was once an
  // owner's (or whose employee moved teams) may still hold more: show only own + own team.
  // The server's directory is authoritative for a manager: after a reassignment their phone
  // still holds the old row, so the team is whoever the directory says they may see in detail.
  const directory = useCompanyPeople(groupId).data;
  const visibleIds = useMemo(() => {
    const ids = new Set<string>();
    if (me?.role === 'manager') {
      // Fail closed: until the server's directory answers, a manager sees only themself.
      if (me.id) ids.add(me.id);
      for (const person of directory ?? []) if (person.detail) ids.add(person.member_id);
      // A person this phone added offline is on this manager's team; the server forces it.
      for (const member of people) if (member.pending && !member.profile_id) ids.add(member.id);
      return ids;
    }
    for (const member of people) {
      if (isOwner || member.id === me?.id || (isManager && member.manager_id === me?.id))
        ids.add(member.id);
    }
    return ids;
  }, [people, isOwner, isManager, me, directory]);
  const manageableIds = useMemo(() => {
    const ids = new Set<string>();
    for (const member of people) {
      if (member.id === me?.id || member.left_at || member.role === 'vendor') continue;
      if (isManager && !visibleIds.has(member.id)) continue;
      if (
        isOwner
          ? member.role !== 'admin'
          : isManager && (member.manager_id === me?.id || (member.pending && !member.profile_id))
      )
        ids.add(member.id);
    }
    return ids;
  }, [people, isOwner, isManager, me?.id, visibleIds]);
  const myId = me?.id ?? null;
  const entries = useMemo(
    () =>
      materialiseCompanyEntries(mirror, queue, {
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
    [mirror, queue, groupId, currency, myId, visibleIds, approvalsEnabled, isOwner, isManager],
  );
  // The same rows without this phone's queued changes: the base a queued edit is measured from.
  const settledEntries = useMemo(
    () =>
      materialiseCompanyEntries(mirror, [], {
        groupId,
        currency,
        myMemberId: myId,
        myIsManager: isManager,
      })
        .map((row) => companyEntryFromRow(row as unknown as CompanyEntryRow))
        .filter((entry) =>
          entry.paidByCompany
            ? isOwner || (isManager && myId !== null && entry.createdBy === myId)
            : visibleIds.has(entry.memberId),
        ),
    [mirror, groupId, currency, myId, visibleIds, isOwner, isManager],
  );
  // Owners are known to owners (member rows) and to managers (the directory).
  const ownerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const member of people) if (member.role === 'admin' && !member.left_at) ids.add(member.id);
    for (const person of directory ?? []) if (person.role === 'admin') ids.add(person.member_id);
    return ids;
  }, [people, directory]);
  const second = {
    enabled: group.data?.company_second_approval === true && approvalsEnabled && ownerIds.size > 1,
    thresholdMinor: group.data?.company_second_approval_threshold_minor
      ? BigInt(group.data.company_second_approval_threshold_minor)
      : null,
  };
  const needsOtherOwner = (entry: CompanyEntry): boolean =>
    needsSecondOwner({
      enabled: second.enabled,
      approvalsEnabled,
      thresholdMinor: second.thresholdMinor,
      ownerCount: ownerIds.size,
      // Live owners only, like the server: a claim raised by an owner who has left is ordinary.
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
          rowsFor(mirror, SyncTable.CompanyEntryAttachments, groupId) as {
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
    entries,
    settledEntries,
    members: people.filter((member) => visibleIds.has(member.id)),
    me,
    isAdmin,
    isOwner,
    isManager,
    isVendor,
    hasManagers,
    manageableIds,
    currency,
    name: group.data?.name ?? '',
    approvalsEnabled,
    defaultRateMinor: defaultRate ? BigInt(defaultRate) : null,
    defaultMileageRateMinor: defaultMileage ? BigInt(defaultMileage) : null,
    secondApproval: second.enabled,
    secondApprovalThresholdMinor: second.thresholdMinor,
    needsOtherOwner,
    canApprove,
    policies,
    policyRevision,
    gstEnabled: gstFieldsApply(group.data?.country_code, currency),
    receiptEntryIds,
    ready: hydrated && group.data !== null && group.data !== undefined,
  };
}

/** Add an entry. `entryId` is the client-chosen idempotency key. */
export function useAddCompanyEntry(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: async (input: {
      entryId: string;
      memberId: string | null;
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

/** Admin: approve, or reject with a note (a rejection needs one). Names the version reviewed. */
export function useReviewCompanyEntry(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: {
      entryId: string;
      to: 'approved' | 'rejected';
      expectedVersion: number;
      note?: string | null;
    }) => mutate(MutationKind.CompanyEntryTransition, groupId, { ...input }),
  });
}

/**
 * Admin: the company-wide default daily rate (null clears) and the approvals
 * switch. The server takes both together, so a change to one resends the other.
 */
export function useSetCompanySettings(groupId: string) {
  const { mutate } = useSync();
  const { group } = useGroup(groupId);
  return useMutation({
    mutationFn: (input: { defaultDailyRateMinor?: string | null; approvalsEnabled?: boolean }) =>
      mutate(MutationKind.CompanySettingsSet, groupId, {
        defaultDailyRateMinor:
          input.defaultDailyRateMinor !== undefined
            ? input.defaultDailyRateMinor
            : (group.data?.company_default_daily_rate_minor ?? null),
        approvalsEnabled: input.approvalsEnabled ?? group.data?.company_approvals_enabled === true,
      }),
  });
}

export interface CompanyPhoto {
  readonly id: string;
  readonly entryId: string;
  readonly storagePath: string;
  readonly uploaderMemberId: string;
  readonly preview: string | null;
}

/**
 * The photos on one entry. The mirror only holds rows the server let this
 * caller read (the entry's employee and admins), and the bytes are a second,
 * re-checked gate at r2-sign.
 */
export function useCompanyPhotos(entryId: string): readonly CompanyPhoto[] {
  const { mirror } = useSync();
  return useMemo(
    () =>
      materialiseCompanyEntryAttachments(mirror, { entryId }).map((row) => ({
        id: row.id,
        entryId: row.entry_id,
        storagePath: row.storage_path,
        uploaderMemberId: row.uploader_member_id,
        preview: row.preview ?? null,
      })),
    [mirror, entryId],
  );
}

/**
 * Upload one picked photo and attach it. A direct online RPC (the bytes need an
 * upload anyway), so the entry must already be on the server: callers flush
 * first. A failed attach frees the bytes it just uploaded.
 */
export async function attachCompanyPhoto(
  groupId: string,
  entryId: string,
  picked: PickedImage,
  kind: 'entry' | 'vendor' = 'entry',
): Promise<void> {
  const attachmentId = randomUUID();
  const path = `${entryId}/${attachmentId}/${randomUUID()}.jpg`;
  let uploaded = false;
  try {
    await putImage({
      bucket: 'company-entry-images',
      path,
      base64: picked.base64,
      contentType: picked.mimeType,
      groupId,
      subjectId: entryId,
    });
    uploaded = true;
    const { error } = await backend.rpc(
      kind === 'vendor' ? 'waves_attach_company_vendor_entry_image' : 'waves_attach_company_entry_image',
      {
        p_entry_id: entryId,
        p_storage_path: path,
        p_attachment_id: attachmentId,
        p_preview: picked.preview ?? null,
      },
    );
    if (error) throw new Error(error.message);
  } catch (caught) {
    if (uploaded)
      await removeRestrictedImage('company-entry-images', entryId, path).catch(() => {});
    throw caught;
  }
}

export function useAddCompanyPhoto(
  groupId: string,
  entryId: string,
  kind: 'entry' | 'vendor' = 'entry',
) {
  const { flush } = useSync();
  return useMutation({
    mutationFn: async (source: 'camera' | 'library'): Promise<boolean> => {
      const picked = source === 'camera' ? await captureReceipt() : await pickAlbumPhoto();
      if (!picked) return false;
      // The entry may still be queued: the attach checks a real server row.
      await flush([groupId]);
      await attachCompanyPhoto(groupId, entryId, picked, kind);
      return true;
    },
    onSuccess: () => void flush([groupId]),
  });
}

export function useRemoveCompanyPhoto(groupId: string, kind: 'entry' | 'vendor' = 'entry') {
  const { flush } = useSync();
  return useMutation({
    mutationFn: async (input: { photoId: string }) => {
      const { error } = await backend.rpc(
        kind === 'vendor' ? 'waves_remove_company_vendor_entry_image' : 'waves_remove_company_entry_image',
        { p_attachment_id: input.photoId },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void flush([groupId]),
  });
}

/** Admin: the per-km rate for the company (memberId null) or one employee; null clears. */
export function useSetMileageRate(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: { memberId: string | null; rateMinor: string | null }) =>
      mutate(MutationKind.CompanyMileageRateSet, groupId, { ...input }),
  });
}

/** Admin: replace the policy rules; names the revision edited. */
export function useSetCompanyPolicies(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: { policies: CompanyPolicies; expectedRevision: number }) =>
      mutate(MutationKind.CompanyPoliciesSet, groupId, { ...input }),
  });
}

/** Admin: one reimbursement entry covering a frozen list of one employee's claims. */
export function useReimburseCompany(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: CompanyReimbursePayload) =>
      mutate(MutationKind.CompanyReimburse, groupId, { ...input }),
  });
}

// ───────────────────────────────────────────────────────── Phase 4 ──

/** Sites of this company the viewer may see (names for all; budgets only for owners). */
export function useCompanyProjects(groupId: string) {
  const { mirror, queue } = useSync();
  return useMemo(
    () => materialiseCompanyProjects(mirror, queue, { groupId }).filter((p) => !p.deleted_at),
    [mirror, queue, groupId],
  );
}

/** Which sites each employee is on (project ids): pulled assignments with this phone's queued changes on top. */
export function useCompanyProjectMembers(groupId: string): ReadonlyMap<string, readonly string[]> {
  const { mirror, queue } = useSync();
  return useMemo(
    () => materialiseProjectMembers(mirror, queue, { groupId }),
    [mirror, queue, groupId],
  );
}

/** Wage payment id -> how it was divided across sites (pulled rows plus a queued wage run). */
export function useWageSplits(groupId: string): ReadonlyMap<string, readonly MirrorWageSplit[]> {
  const { mirror, queue } = useSync();
  return useMemo(() => materialiseWageSplits(mirror, queue, { groupId }), [mirror, queue, groupId]);
}

/** Owner: a second owner must approve large or owner-raised claims. Needs two owners and approvals on. */
export function useSetSecondApproval(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: { enabled: boolean; thresholdMinor: string | null }) =>
      mutate(MutationKind.CompanySecondApprovalSet, groupId, { ...input }),
  });
}

export function useSetCompanyProject(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: CompanyProjectSetPayload) =>
      mutate(MutationKind.CompanyProjectSet, groupId, { ...input }),
  });
}

export function useAssignCompanyMember(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: { memberId: string; managerId: string | null; reason: string }) =>
      mutate(MutationKind.CompanyMemberAssign, groupId, { ...input }),
  });
}

/** Owner or the employee's manager: set (blank clears) the free-text employee ID. */
export function useSetEmployeeId(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: { memberId: string; employeeId: string | null }) =>
      mutate(MutationKind.CompanyMemberEmployeeIdSet, groupId, { ...input }),
  });
}

/**
 * Is this ID already someone else's? Checks this phone's people, then asks the server (it also
 * sees people a manager cannot read) — so the screen can say so before saving, never after.
 * An offline phone has only its own view; the save then goes ahead.
 */
export function useEmployeeIdTaken(groupId: string, people: readonly MemberRow[]) {
  return async (raw: string, exceptMemberId?: string | null): Promise<boolean> => {
    const id = normaliseEmployeeId(raw);
    if (!id) return false;
    if (employeeIdTaken(people, id, exceptMemberId)) return true;
    try {
      const { data, error } = await backend.rpc('waves_company_employee_id_taken', {
        p_group_id: groupId,
        p_employee_id: id,
        p_except_member: exceptMemberId ?? null,
      });
      return !error && data === true;
    } catch {
      return false;
    }
  };
}

export function useSetMemberProjects(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: { memberId: string; projectIds: readonly string[] }) =>
      mutate(MutationKind.CompanyMemberProjectsSet, groupId, { ...input }),
  });
}

/** Owner: allocate to, take back from, or adjust a manager's pool. Return / adjust need a reason. */
export function usePostPool(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: Omit<CompanyPoolPostPayload, 'entryId'> & { entryId?: string }) =>
      mutate(MutationKind.CompanyPoolPost, groupId, {
        ...input,
        entryId: input.entryId ?? randomUUID(),
      }),
  });
}

/** Manager or owner: record a reviewed wage run. `runId` is the idempotency key. */
export function usePayWages(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: CompanyWagePayPayload) =>
      mutate(MutationKind.CompanyWagePay, groupId, { ...input }),
  });
}

/**
 * The pool figure: the server's (it also counts employees who have since moved
 * teams) unless this phone has queued money entries it has not seen yet, then the
 * phone's own sum of what it can read.
 */
export function usePoolBalance(groupId: string, managerId: string | null): bigint | null {
  const { entries, settledEntries } = useCompanyEntries(groupId);
  const { queue, mirror } = useSync();
  const queryClient = useQueryClient();
  // When a queued change is acknowledged its overlay disappears: refresh the server figure at once.
  const queued = queue.filter((m) => m.groupId === groupId && m.kind.startsWith('company')).length;
  const lastQueued = useRef(queued);
  useEffect(() => {
    if (queued < lastQueued.current)
      void queryClient.invalidateQueries({ queryKey: ['company-pool', groupId] });
    lastQueued.current = queued;
  }, [queued, groupId, queryClient]);
  const server = useQuery({
    queryKey: ['company-pool', groupId, managerId],
    enabled: !!managerId,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await backend.rpc('waves_company_pool_balance', {
        p_group_id: groupId,
        p_manager_id: managerId,
      });
      if (error) throw new Error(error.message);
      return BigInt(String((data as { balance: string | number }).balance));
    },
  });
  // The server's figure is the truth (it also counts people who moved teams); queued entries
  // add only their own effect on top of it.
  return useMemo(() => {
    if (!managerId) return null;
    // A manager's vendor payments come out of their pool too (queued ones count at once).
    const vendorOpts = { groupId, myMemberId: managerId, isVendor: false, isManager: true };
    const vendorLines = materialiseVendors(mirror, queue, vendorOpts).lines;
    const mine = poolBalance(entries, managerId, vendorLines).balance;
    if (server.data === undefined) return mine;
    const settled = poolBalance(
      settledEntries,
      managerId,
      materialiseVendors(mirror, [], vendorOpts).lines,
    ).balance;
    return server.data + (mine - settled);
  }, [entries, settledEntries, managerId, server.data, mirror, queue, groupId]);
}

/** Names-only directory (owners, my manager, my team, me) from the server; empty until it answers. */
export function useCompanyPeople(groupId: string) {
  return useQuery({
    queryKey: ['company-people', groupId],
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await backend.rpc('waves_company_people', { p_group_id: groupId });
      if (error) throw new Error(error.message);
      return (data ?? []) as {
        member_id: string;
        display_name: string;
        role: 'admin' | 'manager' | 'member' | 'vendor';
        manager_id: string | null;
        detail: boolean;
      }[];
    },
  });
}

/** Manager asks the owners for more budget (a request row they see). */
export function useAskBudget(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: {
      managerId: string;
      amountMinor: string;
      note: string | null;
      today: string;
    }) =>
      mutate(MutationKind.CompanyPoolPost, groupId, {
        entryId: randomUUID(),
        managerId: input.managerId,
        kind: 'pool_request',
        amountMinor: input.amountMinor,
        projectId: null,
        occurredOn: input.today,
        reason: input.note,
      }),
  });
}
