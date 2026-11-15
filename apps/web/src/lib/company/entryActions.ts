'use client';

/** Company entry writes, payloads exactly as the mobile hooks send them. */
import { useMemo } from 'react';
import {
  materialiseCompanyEntryAttachments,
  MutationKind,
  type CompanyEntryData,
  type CompanyPoolPostPayload,
  type CompanyReimbursePayload,
  type CompanyWagePayPayload,
} from '@waves/core';

import { useSync } from '@/lib/sync';
import { supabase } from '@/lib/waves';

export function useEntryActions(groupId: string) {
  const { mutate } = useSync();
  return {
    /** `entryId` is the client-chosen idempotency key. */
    add: async (input: {
      entryId: string;
      memberId: string | null;
      entryKind: 'expense' | 'advance' | 'allowance' | 'wages' | 'reimbursement';
      data: CompanyEntryData;
    }): Promise<string> => {
      await mutate(MutationKind.CompanyEntryCreate, groupId, { ...input });
      return input.entryId;
    },
    update: (input: { entryId: string; patch: CompanyEntryData }) =>
      mutate(MutationKind.CompanyEntryUpdate, groupId, { ...input }),
    void: (input: { entryId: string; reason?: string }) =>
      mutate(MutationKind.CompanyEntryVoid, groupId, { ...input }),
    review: (input: {
      entryId: string;
      to: 'approved' | 'rejected';
      expectedVersion: number;
      note?: string | null;
    }) => mutate(MutationKind.CompanyEntryTransition, groupId, { ...input }),
    reimburse: (input: CompanyReimbursePayload) =>
      mutate(MutationKind.CompanyReimburse, groupId, { ...input }),
    postPool: (input: Omit<CompanyPoolPostPayload, 'entryId'> & { entryId?: string }) =>
      mutate(MutationKind.CompanyPoolPost, groupId, {
        ...input,
        entryId: input.entryId ?? crypto.randomUUID(),
      }),
    payWages: (input: CompanyWagePayPayload) =>
      mutate(MutationKind.CompanyWagePay, groupId, { ...input }),
  };
}

export interface CompanyPhoto {
  readonly id: string;
  readonly entryId: string;
  readonly storagePath: string;
  readonly uploaderMemberId: string | null;
  readonly preview: string | null;
}

/** The photos on one entry (rows the server let this caller read). */
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

export async function removeCompanyPhoto(photoId: string): Promise<void> {
  const { error } = await supabase.rpc('waves_remove_company_entry_image', {
    p_attachment_id: photoId,
  });
  if (error) throw new Error(error.message);
}

/** Server pool figure for one manager (online RPC). */
export async function fetchPoolBalance(groupId: string, managerId: string): Promise<bigint> {
  const { data, error } = await supabase.rpc('waves_company_pool_balance', {
    p_group_id: groupId,
    p_manager_id: managerId,
  });
  if (error) throw new Error(error.message);
  return BigInt(String((data as { balance: string | number }).balance));
}
