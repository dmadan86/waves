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
import { randomUUID } from 'expo-crypto';

import {
  companyEntryFromRow,
  MutationKind,
  materialiseCompanyEntries,
  materialiseCompanyEntryAttachments,
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
  /** Every member row this viewer can read: all of them for an admin, only themself otherwise. */
  readonly members: readonly MemberRow[];
  readonly me: MemberRow | null;
  readonly isAdmin: boolean;
  readonly currency: string;
  readonly name: string;
  /** New entries wait for an admin's approval (off by default). */
  readonly approvalsEnabled: boolean;
  /** The company-wide default daily bata rate, minor units, or null. */
  readonly defaultRateMinor: bigint | null;
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
      materialiseCompanyEntries(mirror, queue, {
        groupId,
        currency,
        myMemberId: me?.id ?? null,
        approvalsEnabled,
      })
        .map((row) => companyEntryFromRow(row as unknown as CompanyEntryRow))
        .filter((entry) => isAdmin || entry.memberId === me?.id),
    [mirror, queue, groupId, currency, me?.id, isAdmin, approvalsEnabled],
  );
  return {
    entries,
    members: isAdmin ? people : people.filter((member) => member.id === me?.id),
    me,
    isAdmin,
    currency,
    name: group.data?.name ?? '',
    approvalsEnabled,
    defaultRateMinor: defaultRate ? BigInt(defaultRate) : null,
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
    const { error } = await backend.rpc('waves_attach_company_entry_image', {
      p_entry_id: entryId,
      p_storage_path: path,
      p_attachment_id: attachmentId,
      p_preview: picked.preview ?? null,
    });
    if (error) throw new Error(error.message);
  } catch (caught) {
    if (uploaded)
      await removeRestrictedImage('company-entry-images', entryId, path).catch(() => {});
    throw caught;
  }
}

export function useAddCompanyPhoto(groupId: string, entryId: string) {
  const { flush } = useSync();
  return useMutation({
    mutationFn: async (source: 'camera' | 'library'): Promise<boolean> => {
      const picked = source === 'camera' ? await captureReceipt() : await pickAlbumPhoto();
      if (!picked) return false;
      // The entry may still be queued: the attach checks a real server row.
      await flush([groupId]);
      await attachCompanyPhoto(groupId, entryId, picked);
      return true;
    },
    onSuccess: () => void flush([groupId]),
  });
}

export function useRemoveCompanyPhoto(groupId: string) {
  const { flush } = useSync();
  return useMutation({
    mutationFn: async (input: { photoId: string }) => {
      const { error } = await backend.rpc('waves_remove_company_entry_image', {
        p_attachment_id: input.photoId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void flush([groupId]),
  });
}
