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

// ───────────────────────────────────────────── company mode (owner / manager) ──

export type CompanyBarKey = 'home' | 'overview' | 'people' | 'pending' | 'payments' | 'more';

/** The viewer's live role in one group, from the members mirror; null when not a member. */
export function viewerRoleIn(
  members: readonly {
    group_id: string;
    profile_id: string | null;
    left_at: string | null;
    role: string;
  }[],
  groupId: string | null,
  viewerId: string | null,
): string | null {
  if (groupId === null || viewerId === null) return null;
  const mine = members.find(
    (m) => m.group_id === groupId && m.left_at === null && isViewer(m, viewerId),
  );
  return mine?.role ?? null;
}

/**
 * Company mode: an owner (admin) or manager inside one of their own companies gets the
 * company bar. Route-derived like Personal mode; employees keep the shared bar.
 */
export function isCompanyMode(
  segments: readonly string[],
  groupId: string | null,
  companyIds: readonly string[],
  role: string | null,
): boolean {
  return (
    segments[0] === 'group' &&
    groupId !== null &&
    companyIds.includes(groupId) &&
    (role === 'admin' || role === 'manager')
  );
}

const BAR_SCREEN: Readonly<Record<string, CompanyBarKey>> = {
  'company-people': 'people',
  members: 'people',
  'company-hierarchy': 'people',
  'company-statement': 'people',
  'company-pending': 'pending',
  'company-payments': 'payments',
  'company-wages': 'payments',
  'company-more': 'more',
  'company-budgets': 'more',
  settings: 'more',
  export: 'more',
};

/** Which company-bar tab reads as current; '' for screens that belong to none (entry forms). */
export function companyBarActiveKey(segments: readonly string[]): CompanyBarKey | '' {
  if (segments[0] !== 'group') return '';
  if (segments.length <= 2) return 'overview';
  return BAR_SCREEN[segments[2] ?? ''] ?? '';
}

/** Where a company-bar tab goes. */
export function companyBarRoute(groupId: string, key: string): string {
  switch (key) {
    case 'home':
      return '/';
    case 'people':
      return `/group/${groupId}/company-people`;
    case 'pending':
      return `/group/${groupId}/company-pending`;
    case 'payments':
      return `/group/${groupId}/company-payments`;
    case 'more':
      return `/group/${groupId}/company-more`;
    default:
      return `/group/${groupId}`;
  }
}

const SUB_TAB_SCREENS = ['company-people', 'company-pending', 'company-payments', 'company-more'];

/** True on a bar tab's own root screen (Overview or a sub-tab), not a screen opened from it. */
export function isCompanyBarRoot(segments: readonly string[]): boolean {
  return (
    segments[0] === 'group' &&
    (segments.length === 2 ||
      (segments.length === 3 && SUB_TAB_SCREENS.includes(segments[2] ?? '')))
  );
}

/** Where hardware Back goes from a company-bar root: a sub-tab to Overview, Overview to Home. */
export function companyBackRoute(segments: readonly string[], groupId: string): string | null {
  if (!isCompanyBarRoot(segments)) return null;
  return segments.length === 2 ? '/' : `/group/${groupId}`;
}
