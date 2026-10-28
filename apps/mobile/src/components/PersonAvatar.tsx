/**
 * A person's face, everywhere.
 *
 * The one way the app draws a real person: their photo when they have one, their
 * initials otherwise. Screens hand over whichever of these they hold — a group
 * `member` (whose joined `profile.avatar_url` is already on the device), a bare
 * `avatarUrl` (a friends row, a profile, an activity actor), or neither (a
 * contact or a name somebody typed). The private-bucket path is signed through
 * `useAvatarUrl`, which shares the app's signed-URL cache, so a list of people
 * costs one resolve per distinct photo and a failed or missing one falls back
 * to initials rather than a blank circle.
 *
 * Ghost members (ADR-006) have no account and so no photo: they always show
 * initials, in the provisional ghost treatment. A blocked member's photo is
 * withheld the same way their name is masked.
 *
 * The bare `Avatar` from `@waves/ui` is for things that are not people (a
 * group's mark). `test/personAvatarGuard.test.ts` keeps it out of screens.
 */

import type { ReactNode } from 'react';

import { Avatar, type TintName } from '@waves/ui';

import { useAvatarUrl } from '@/components/ProfileAvatar';
import { useBlockedUsers } from '@/data/blocked';
import { useAuth } from '@/lib/auth';
import { useViewerIdentity } from '@/lib/viewerIdentity';
import type { MemberRow } from '@/data/types';

export interface PersonAvatarProps {
  name: string;
  size?: number;
  tint?: TintName;
  /** A drawn glyph in place of the initials (the viewer's own placeholder). */
  mark?: (color: string) => ReactNode;
  /** Provisional member with no account: initials only. */
  ghost?: boolean;
  /** A group member; its joined profile's avatar is used when no `avatarUrl` is given. */
  member?: Pick<MemberRow, 'profile' | 'profile_id'> | null;
  /** A raw `profiles.avatar_url` (storage path or https URL). Wins over `member`. */
  avatarUrl?: string | null;
  onPress?: () => void;
  accessibilityLabel?: string;
}

export function PersonAvatar({
  name,
  size,
  tint,
  mark,
  ghost = false,
  member,
  avatarUrl,
  onPress,
  accessibilityLabel,
}: PersonAvatarProps) {
  const { isBlocked } = useBlockedUsers();
  // A blocked person is anonymous on this device: their face is not drawn either.
  const hidden = ghost || isBlocked(member?.profile_id);
  // The viewer's own row falls back to the provider photo when their profile has none.
  const { profile: me } = useAuth();
  const viewer = useViewerIdentity();
  const isMe = !!member?.profile_id && member.profile_id === me?.id;
  // `||` so an empty column falls through; the viewer's live identity beats a cached member row.
  const raw = hidden
    ? null
    : (isMe && viewer.avatarUrl) || avatarUrl || member?.profile?.avatar_url || null;
  const photoUrl = useAvatarUrl(raw);
  return (
    <Avatar
      name={name}
      size={size}
      tint={tint}
      mark={mark}
      ghost={ghost}
      photoUrl={photoUrl}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
