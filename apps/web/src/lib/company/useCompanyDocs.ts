'use client';

import { useMemo } from 'react';

import { materialiseCompanyDocs, type MirrorCompanyDoc } from '@waves/core';

import { useCompanyView } from '@/lib/company/view';
import { NO_QUEUE, useSync } from '@/lib/sync';

export interface CompanyDocsView {
  /** Newest first. */
  readonly docs: readonly MirrorCompanyDoc[];
  /** Owner or manager: the only roles that see Estimates & bills. */
  readonly canUse: boolean;
  readonly isOwner: boolean;
  readonly suspended: boolean;
  readonly currency: string;
  readonly companyName: string;
  readonly logoPath: string | null;
  readonly ready: boolean;
}

export function useCompanyDocs(groupId: string): CompanyDocsView {
  const { mirror } = useSync();
  const view = useCompanyView(groupId);
  const meId = view.me?.id ?? '';
  const canUse = view.isAdmin;
  const isOwner = view.isOwner;
  const docs = useMemo(
    () =>
      canUse && meId
        ? materialiseCompanyDocs(mirror, NO_QUEUE, {
            groupId,
            currency: view.currency,
            viewerMemberId: meId,
          }).filter((d) => isOwner || d.createdBy === meId) // a manager sees only their own
        : [],
    [mirror, groupId, canUse, isOwner, meId, view.currency],
  );
  return {
    docs,
    canUse,
    isOwner,
    suspended: view.suspended,
    currency: view.currency,
    companyName: view.name,
    logoPath: view.group?.photo_path ?? null,
    ready: view.ready,
  };
}
