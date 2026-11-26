import { nameOf, pastNameOf, type Member } from '@waves/api-client';

/**
 * Your own row says "You", whatever the profile carries (often the server's
 * "Guest"). Pass `leftLabel` to mark somebody who has since left.
 */
export function memberLabel(
  member: Member,
  myProfileId: string | null,
  you: string,
  leftLabel?: string,
): string {
  if (myProfileId && member.profile_id === myProfileId) return you;
  return leftLabel ? pastNameOf(member, leftLabel) : nameOf(member);
}

/** The first visible character of a name: a whole emoji, not half of one. */
export function initialOf(name: string): string {
  const trimmed = name.trim();
  const first = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    .segment(trimmed)
    [Symbol.iterator]()
    .next();
  return first.done ? '?' : first.value.segment.toUpperCase();
}
