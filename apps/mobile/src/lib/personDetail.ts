import type { PersonProfileRow } from '@/data/api';

/**
 * Which avatar object path the person screen may sign.
 *
 * A blocked person is anonymous on this device, and a guest is not an account
 * identity yet. Neither should cause a private avatar path to be signed even if
 * stale or malformed server data happens to carry one.
 */
export function personAvatarPath(
  profile: Pick<PersonProfileRow, 'avatar_url' | 'is_ghost'> | null,
  masked: boolean,
): string | null {
  if (masked || profile?.is_ghost) return null;
  return profile?.avatar_url ?? null;
}
