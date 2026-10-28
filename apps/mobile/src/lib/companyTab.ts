import { isViewer } from '@/data/types';

/** Returns the viewer's current, available companies in group order. */
export function viewerCompanyIds(
  groups: readonly {
    id: string;
    type: string;
    archived_at: string | null;
    deleted_at: string | null;
  }[],
  members: readonly { group_id: string; profile_id: string | null; left_at: string | null }[],
  viewerId: string | null,
): string[] {
  if (viewerId === null) return [];
  const memberships = new Set(
    members
      .filter((member) => isViewer(member, viewerId) && member.left_at === null)
      .map((member) => member.group_id),
  );
  return [
    ...new Set(
      groups
        .filter(
          (group) =>
            group.type === 'company' &&
            group.archived_at === null &&
            group.deleted_at === null &&
            memberships.has(group.id),
        )
        .map((group) => group.id),
    ),
  ];
}

/** Chooses the destination occupying the Review slot. */
export function reviewSlotKey(companyIds: readonly string[]): 'company' | 'captures' {
  return companyIds.length > 0 ? 'company' : 'captures';
}

/** Opens the sole or currently open company directly, or the company list when there are several. */
export function companyTabRoute(
  companyIds: readonly string[],
  openCompanyId: string | null = null,
): string | null {
  if (companyIds.length === 0) return null;
  if (openCompanyId !== null && companyIds.includes(openCompanyId))
    return `/group/${openCompanyId}`;
  return companyIds.length === 1 ? `/group/${companyIds[0]}` : '/companies';
}

/** Highlights Company on its list and any of the viewer's company screens. */
export function companyActiveKey(
  segments: readonly string[],
  groupId: string | null,
  companyIds: readonly string[],
): 'company' | '' {
  return segments[0] === 'companies' ||
    (segments[0] === 'group' && groupId !== null && companyIds.includes(groupId))
    ? 'company'
    : '';
}

/** Identifies the company list or the sole company's root screen. */
export function isCompanyTabRoot(
  segments: readonly string[],
  groupId: string | null,
  companyIds: readonly string[],
): boolean {
  return (
    (segments.length === 1 && segments[0] === 'companies') ||
    (companyIds.length === 1 &&
      segments.length === 2 &&
      segments[0] === 'group' &&
      groupId === companyIds[0])
  );
}

/** Home's second quick action: Review swaps in for Settle up when it swaps the Review tab out. */
export function homeSecondActionKey(companyIds: readonly string[]): 'review' | 'settle' {
  return reviewSlotKey(companyIds) === 'company' ? 'review' : 'settle';
}
