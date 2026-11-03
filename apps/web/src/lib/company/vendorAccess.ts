/** Who the viewer is inside one company, read from the synced groups + members rows. Pure. */
import { rowsFor, SyncTable, type MirrorState } from '@waves/core';

export interface CompanyAccess {
  readonly memberId: string | null;
  readonly isOwner: boolean;
  readonly isManager: boolean;
  readonly isVendor: boolean;
  readonly currency: string;
  readonly name: string;
  /** Waves suspended it, or its slot lapsed: read-only. */
  readonly suspended: boolean;
  readonly countryCode: string | null;
}

interface GroupLike {
  id: string;
  name?: string;
  default_currency?: string;
  suspended_at?: string | null;
  slot_lapsed_at?: string | null;
  country_code?: string | null;
}
interface MemberLike {
  id: string;
  profile_id: string | null;
  role?: string;
  left_at: string | null;
}

export function deriveAccess(
  mirror: MirrorState,
  groupId: string,
  profileId: string | null,
): CompanyAccess {
  const group = (rowsFor(mirror, SyncTable.Groups) as unknown as GroupLike[]).find(
    (g) => g.id === groupId,
  );
  const me = profileId
    ? (rowsFor(mirror, SyncTable.GroupMembers, groupId) as unknown as MemberLike[]).find(
        (m) => m.profile_id === profileId && !m.left_at,
      )
    : undefined;
  return {
    memberId: me?.id ?? null,
    isOwner: me?.role === 'admin',
    isManager: me?.role === 'manager',
    isVendor: me?.role === 'vendor',
    currency: group?.default_currency ?? 'INR',
    name: group?.name ?? '',
    suspended: group?.suspended_at != null || group?.slot_lapsed_at != null,
    countryCode: group?.country_code ?? null,
  };
}
