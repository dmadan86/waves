/**
 * The company activity feed for this viewer, derived from rows the phone already syncs.
 * The server's row-level security has already narrowed every table to what the viewer may read;
 * `buildCompanyActivity` narrows it once more by role.
 */

import { useMemo } from 'react';
import { rowsFor, SyncTable } from '@waves/core';

import { useCompanyDocs } from '@/data/companyDocuments';
import { useCompanyEntries } from '@/data/companyEntries';
import { useCompanyVendors } from '@/data/companyVendors';
import { displayName } from '@/data/types';
import { useStrings } from '@/i18n';
import {
  buildCompanyActivity,
  countNewActivity,
  type ActivityRole,
  type CompanyActivityEvent,
} from '@/lib/companyActivity';
import { useCompanyActivitySeenAt } from '@/lib/companyActivitySeen';
import { useSync } from '@/sync';

type Raw = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function useCompanyActivity(groupId: string): {
  readonly events: readonly CompanyActivityEvent[];
  readonly ready: boolean;
} {
  const { mirror } = useSync();
  const { t } = useStrings();
  const view = useCompanyEntries(groupId);
  const vendors = useCompanyVendors(groupId);
  const docs = useCompanyDocs(groupId);

  // The raw synced rows carry the stamps the screens' own views drop (who marked, when).
  const raw = useMemo(() => {
    const rows = (table: SyncTable): Raw[] => rowsFor(mirror, table, groupId) as unknown as Raw[];
    const live = (r: Raw): boolean => !r.deleted_at;
    return {
      attendance: rows(SyncTable.CompanyAttendance).filter(live),
      tasks: rows(SyncTable.CompanyWorkTasks).filter(live),
      members: rows(SyncTable.GroupMembers),
      entries: rows(SyncTable.CompanyEntries),
      vendorEntries: rows(SyncTable.CompanyVendorEntries),
      docs: rows(SyncTable.CompanyDocuments),
    };
  }, [mirror, groupId]);

  const { isOwner, isVendor, isManager, me, members, manageableIds, entries, ready } = view;
  const vendorList = vendors.vendors;
  const vendorLines = vendors.lines;
  const docList = docs.docs;
  const events = useMemo(() => {
    const role: ActivityRole = isOwner
      ? 'owner'
      : isVendor
        ? 'vendor'
        : isManager
          ? 'manager'
          : 'employee';
    const names = new Map(members.map((m) => [m.id, displayName(m, null, null, t.misc.someone)]));
    const entryReviews = new Map<string, { at: string; by: string }>();
    for (const r of raw.entries)
      if (r.reviewed_at && r.reviewed_by)
        entryReviews.set(str(r.id), { at: str(r.reviewed_at), by: str(r.reviewed_by) });
    const vendorReviews = new Map<string, string>();
    for (const r of raw.vendorEntries)
      if (r.reviewed_at) vendorReviews.set(str(r.id), str(r.reviewed_at));
    const docStamps = new Map(raw.docs.map((r) => [str(r.id), r]));
    return buildCompanyActivity({
      viewer: {
        memberId: me?.id ?? null,
        role,
        manageableIds: manageableIds,
        active: ready && !!me && !me.left_at,
      },
      labels: {
        you: t.companyActivity.you,
        youObj: t.companyActivity.youObj,
        someone: t.misc.someone,
      },
      names,
      entries: entries,
      entryReviews,
      attendance: raw.attendance.map((r) => ({
        memberId: str(r.member_id),
        day: str(r.day).slice(0, 10),
        status: r.status as 'present' | 'half' | 'absent',
        markedBy: str(r.marked_by),
        updatedAt: str(r.updated_at),
      })),
      tasks: raw.tasks.map((r) => ({
        id: str(r.id),
        memberId: str(r.member_id),
        day: str(r.day).slice(0, 10),
        title: str(r.title),
        status: str(r.status),
        createdBy: str(r.created_by),
        createdAt: str(r.created_at),
        updatedAt: str(r.updated_at),
      })),
      members: raw.members.map((r) => ({
        id: str(r.id),
        role: str(r.role),
        hasProfile: !!r.profile_id,
        createdAt: str(r.created_at),
        leftAt: str(r.left_at) || null,
        removedBy: str(r.removed_by) || null,
      })),
      vendors: vendorList,
      vendorLines: vendorLines,
      vendorReviews,
      // A queued (offline) document has no server stamp yet: it joins the feed once it syncs.
      docs: docList.flatMap((doc) => {
        const s = docStamps.get(doc.id);
        return s ? [{ doc, createdAt: str(s.created_at), updatedAt: str(s.updated_at) }] : [];
      }),
    });
  }, [
    isOwner,
    isVendor,
    isManager,
    me,
    members,
    manageableIds,
    entries,
    ready,
    vendorList,
    vendorLines,
    docList,
    raw,
    t,
  ]);

  return { events, ready };
}

/** The Overview bell's red count: new things from somebody else since this phone last opened the feed. */
export function useCompanyActivityUnread(groupId: string): number {
  const { events } = useCompanyActivity(groupId);
  return countNewActivity(events, useCompanyActivitySeenAt(groupId));
}
