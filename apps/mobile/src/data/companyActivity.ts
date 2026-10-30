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
  hasNewActivity,
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

  const events = useMemo(() => {
    const role: ActivityRole = view.isOwner
      ? 'owner'
      : view.isVendor
        ? 'vendor'
        : view.isManager
          ? 'manager'
          : 'employee';
    const names = new Map(
      view.members.map((m) => [m.id, displayName(m, null, null, t.misc.someone)]),
    );
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
        memberId: view.me?.id ?? null,
        role,
        manageableIds: view.manageableIds,
        active: view.ready && !!view.me && !view.me.left_at,
      },
      labels: {
        you: t.companyActivity.you,
        youObj: t.companyActivity.youObj,
        someone: t.misc.someone,
      },
      names,
      entries: view.entries,
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
      vendors: vendors.vendors,
      vendorLines: vendors.lines,
      vendorReviews,
      // A queued (offline) document has no server stamp yet: it joins the feed once it syncs.
      docs: docs.docs.flatMap((doc) => {
        const s = docStamps.get(doc.id);
        return s ? [{ doc, createdAt: str(s.created_at), updatedAt: str(s.updated_at) }] : [];
      }),
    });
  }, [view, vendors, docs.docs, raw, t]);

  return { events, ready: view.ready };
}

/** The Overview bell's red dot: something new from somebody else since this phone last opened the feed. */
export function useCompanyActivityDot(groupId: string): boolean {
  const { events } = useCompanyActivity(groupId);
  return hasNewActivity(events, useCompanyActivitySeenAt(groupId));
}
