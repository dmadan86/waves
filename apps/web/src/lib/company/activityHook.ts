'use client';

import { useMemo } from 'react';

import { materialiseCompanyDocs, materialiseVendors, rowsFor, SyncTable } from '@waves/core';

import { useStrings } from '@/i18n-context';
import { NO_QUEUE, useSync } from '@/lib/sync';
import {
  buildCompanyActivity,
  type ActivityRole,
  type CompanyActivityEvent,
} from '@/lib/company/activity';
import { memberName, useCompanyView } from '@/lib/company/view';

type Raw = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The company feed for this viewer, derived from rows already in the mirror. */
export function useCompanyActivity(groupId: string): {
  readonly events: readonly CompanyActivityEvent[];
  readonly ready: boolean;
} {
  const { mirror } = useSync();
  const { t } = useStrings();
  const view = useCompanyView(groupId);
  const { isOwner, isVendor, isManager, me, members, manageableIds, entries, ready } = view;

  const events = useMemo(() => {
    const rows = (table: SyncTable): Raw[] => rowsFor(mirror, table, groupId) as unknown as Raw[];
    const live = (r: Raw): boolean => !r.deleted_at;
    const myId = me?.id ?? null;

    const all = materialiseVendors(mirror, NO_QUEUE, {
      groupId,
      myMemberId: myId,
      isVendor,
      isManager,
    });
    const vendors = all.vendors.filter((v) =>
      isOwner ? true : isManager ? v.addedBy === myId : isVendor ? v.memberId === myId : false,
    );
    const vendorIds = new Set(vendors.map((v) => v.id));
    const vendorLines = all.lines.filter((l) => vendorIds.has(l.vendorId));
    const docList =
      (isOwner || isManager) && myId
        ? materialiseCompanyDocs(mirror, NO_QUEUE, {
            groupId,
            currency: view.currency,
            viewerMemberId: myId,
          }).filter((d) => isOwner || d.createdBy === myId)
        : [];

    const rawEntries = rows(SyncTable.CompanyEntries);
    const entryReviews = new Map<string, { at: string; by: string }>();
    for (const r of rawEntries)
      if (r.reviewed_at && r.reviewed_by)
        entryReviews.set(str(r.id), { at: str(r.reviewed_at), by: str(r.reviewed_by) });
    const vendorReviews = new Map<string, string>();
    for (const r of rows(SyncTable.CompanyVendorEntries))
      if (r.reviewed_at) vendorReviews.set(str(r.id), str(r.reviewed_at));
    const docStamps = new Map(rows(SyncTable.CompanyDocuments).map((r) => [str(r.id), r]));
    const role: ActivityRole = isOwner
      ? 'owner'
      : isVendor
        ? 'vendor'
        : isManager
          ? 'manager'
          : 'employee';

    return buildCompanyActivity({
      currency: view.currency,
      viewer: { memberId: myId, role, manageableIds, active: ready && !!me && !me.left_at },
      labels: {
        you: t.company.activity.you,
        youObj: t.company.activity.youObj,
        someone: t.company.common.someone,
      },
      names: new Map(members.map((m) => [m.id, memberName(m, t.company.common.someone)])),
      entries,
      entryReviews,
      attendance: rows(SyncTable.CompanyAttendance)
        .filter(live)
        .map((r) => ({
          memberId: str(r.member_id),
          day: str(r.day).slice(0, 10),
          status: r.status as 'present' | 'half' | 'absent',
          markedBy: str(r.marked_by),
          updatedAt: str(r.updated_at),
        })),
      tasks: rows(SyncTable.CompanyWorkTasks)
        .filter(live)
        .map((r) => ({
          id: str(r.id),
          memberId: str(r.member_id),
          day: str(r.day).slice(0, 10),
          title: str(r.title),
          status: str(r.status),
          createdBy: str(r.created_by),
          createdAt: str(r.created_at),
          updatedAt: str(r.updated_at),
        })),
      members: rows(SyncTable.GroupMembers).map((r) => ({
        id: str(r.id),
        role: str(r.role),
        hasProfile: !!r.profile_id,
        createdAt: str(r.created_at),
        leftAt: str(r.left_at) || null,
        removedBy: str(r.removed_by) || null,
      })),
      vendors,
      vendorLines,
      vendorReviews,
      docs: docList.flatMap((doc) => {
        const s = docStamps.get(doc.id);
        return s ? [{ doc, createdAt: str(s.created_at), updatedAt: str(s.updated_at) }] : [];
      }),
    });
  }, [
    mirror,
    groupId,
    view.currency,
    isOwner,
    isVendor,
    isManager,
    me,
    members,
    manageableIds,
    entries,
    ready,
    t,
  ]);

  return { events, ready };
}
