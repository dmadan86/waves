/**
 * The colour behind a group's icon.
 *
 * A group's mark has always sat on a tile whose colour the app chose. This is
 * the owner's say in it: `groups.cover_color` holds one of these keys, or NULL
 * for "the app's colour", which is what every group made before this existed
 * looks like and why NULL must keep drawing exactly what it always drew.
 *
 * A *key* is stored, never a hex, so dark mode can map the same pick to a
 * different tone (a pastel tile on a dark screen is a lamp). The key list is
 * shared so the picker, the `/sync` boundary and the tests agree on it; the
 * actual tones per scheme live with the theme in the app. The column's CHECK is
 * deliberately only the *shape* of a key (lowercase letters), not this list, so
 * adding a swatch later is an app change and not a migration — a client that
 * meets a key it does not know draws the default.
 */

/** Soft pastels first, then the stronger few. The order is the picker's order. */
export const GROUP_COVER_COLORS = [
  'lilac',
  'pink',
  'peach',
  'coral',
  'butter',
  'mint',
  'sage',
  'sky',
  'indigo',
  'teal',
  'berry',
  'slate',
  // Added with the cover sheet's eight-swatch row; older keys above stay valid.
  'iris',
  'blue',
  'aqua',
  'green',
  'yellow',
  'orange',
] as const;

export type GroupCoverColor = (typeof GROUP_COVER_COLORS)[number];

/** The shape the database accepts — keep in step with `groups_cover_color_shape`. */
export const GROUP_COVER_COLOR_SHAPE = /^[a-z]{2,16}$/;

/** A key this build knows how to draw; anything else is treated as unset. */
export function isGroupCoverColor(value: unknown): value is GroupCoverColor {
  return typeof value === 'string' && (GROUP_COVER_COLORS as readonly string[]).includes(value);
}

/**
 * Reads a stored or typed value into a known key, or null. Trims and lowercases
 * so a hand-written PATCH or an older/newer client cannot park an unreadable
 * value in the column; unknown but well-shaped keys (a newer build's swatch)
 * come back null here and are left alone by the writer.
 */
export function normaliseGroupCoverColor(value: unknown): GroupCoverColor | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  return isGroupCoverColor(key) ? key : null;
}
