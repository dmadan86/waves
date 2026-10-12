/**
 * What the past calls a member.
 *
 * A bill, a balance, a settlement and an activity line point at a member id, and
 * the member can have left or been removed since. They are still who paid and who
 * owes, so the name has to survive the departure: ghost_name for someone added by
 * name, the profile's display name for an account. A subtle "(left)" says they are
 * no longer in the group. Only an id that resolves to no row at all is "Someone".
 *
 * Pickers for a NEW expense, split or settle-up do not use this — they read the
 * active roster, so nobody who left is offered.
 */

import { displayName, isViewer, type MemberRow } from '@/data/types';

export interface MemberNameOptions {
  readonly viewerId?: string | null;
  readonly blocked?: ReadonlySet<string> | null;
  /** `t.misc.someone` */
  readonly someone: string;
  /** `t.misc.memberLeft` */
  readonly leftLabel: string;
  /** Leave the "(left)" mark off — for an avatar, which takes the bare name. */
  readonly bare?: boolean;
}

export function hasLeft(member: Pick<MemberRow, 'left_at'> | null | undefined): boolean {
  return Boolean(member?.left_at);
}

export function memberNameFor(
  member: MemberRow | null | undefined,
  options: MemberNameOptions,
): string {
  if (!member) return options.someone;
  const name = displayName(member, options.viewerId, options.blocked, options.someone);
  if (options.bare || !hasLeft(member)) return name;
  // The viewer reads "You" and a blocked person stays masked: neither is tagged.
  if (isViewer(member, options.viewerId)) return name;
  if (member.profile_id && options.blocked?.has(member.profile_id)) return name;
  return `${name} ${options.leftLabel}`;
}

export function memberNameById(
  lookup: ReadonlyMap<string, MemberRow>,
  memberId: string | null | undefined,
  options: MemberNameOptions,
): string {
  return memberNameFor(memberId ? lookup.get(memberId) : undefined, options);
}
