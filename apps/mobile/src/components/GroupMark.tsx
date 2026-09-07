/**
 * The little picture a group wears, drawn rather than typed.
 *
 * A group's cover used to be an emoji rendered as text, and that is exactly why
 * it looked wrong next to everything else on the screen: an emoji is a glyph
 * from the operating system's font, so it changes shape between Android
 * versions, sits on the text baseline instead of on the icon grid, carries its
 * own colours that answer to nobody's palette, and reads as a character dropped
 * in a box rather than as a mark somebody designed. Beside a screen full of
 * Ionicons it is the one thing that does not belong to the app.
 *
 * So the covers are drawn here instead: one family of vector marks on a 24×24
 * grid, one stroke weight, round caps and joins throughout, and a single colour
 * that comes from the theme — strokes at full strength, fills of the same
 * colour at `ACCENT_OPACITY`. Two weights of one colour rather than a second
 * hue, so a mark stays legible on white, on the dark surface, and on the
 * saturated cards without anybody having to pick a contrasting accent per
 * ground.
 *
 * **The stored data does not change.** `groups.cover_emoji` still holds an
 * emoji, and the picker still writes one; a mark is only a way of *drawing*
 * that value. `MARK_FOR_EMOJI` maps the emoji a group may already carry onto
 * the mark that means the same thing (🏝️ and ⛱️ both draw the beach), and an
 * emoji with no mark — an older pick, or one from the wider set the picker used
 * to offer — falls back to rendering the character itself. Nobody's group
 * changes identity because this file exists.
 */

import type { ReactElement } from 'react';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

import { Text, useTheme } from '@waves/ui';

/** The marks, in the order the picker lays them out. */
export const GROUP_MARK_IDS = [
  'beach',
  'mountain',
  'tent',
  'plane',
  'car',
  'boat',
  'home',
  'building',
  'bed',
  'key',
  'receipt',
  'coins',
  'plate',
  'pizza',
  'bowl',
  'coffee',
  'cake',
  'drinks',
  'party',
  'gift',
  'heart',
  'ball',
  'star',
  'people',
] as const;

export type GroupMarkId = (typeof GROUP_MARK_IDS)[number];

/**
 * The emoji each mark is stored as. This is the value written to
 * `cover_emoji`, so a group picked in this app is still readable by the web
 * client, the export, and any older build — all of which render the character.
 */
export const EMOJI_FOR_MARK: Readonly<Record<GroupMarkId, string>> = {
  beach: '🏖️',
  mountain: '⛰️',
  tent: '🏕️',
  plane: '✈️',
  car: '🚗',
  boat: '⛵',
  home: '🏠',
  building: '🏢',
  bed: '🛏️',
  key: '🔑',
  receipt: '🧾',
  coins: '💰',
  plate: '🍽️',
  pizza: '🍕',
  bowl: '🍜',
  coffee: '☕',
  cake: '🎂',
  drinks: '🍻',
  party: '🎉',
  gift: '🎁',
  heart: '💜',
  ball: '⚽',
  star: '⭐',
  people: '👥',
};

/**
 * Every emoji that draws as a mark, including the ones the picker no longer
 * offers. A group whose cover was set before the marks existed keeps the
 * picture it has always had wherever the two mean the same thing — 🏡 is a
 * home, 🏨 is a building, 🏀 is a ball. Anything not listed here is drawn as
 * the emoji itself, which is what it already was.
 *
 * The keys are matched with the variation selector stripped, so 🏖 and 🏖️ (the
 * same character with and without U+FE0F) both find their mark.
 */
export const MARK_FOR_EMOJI: Readonly<Record<string, GroupMarkId>> = {
  '🏖': 'beach',
  '🏝': 'beach',
  '⛱': 'beach',
  '⛰': 'mountain',
  '🏔': 'mountain',
  '🏕': 'tent',
  '✈': 'plane',
  '🚗': 'car',
  '🚕': 'car',
  '🚌': 'car',
  '🛵': 'car',
  '⛵': 'boat',
  '🏠': 'home',
  '🏡': 'home',
  '🏢': 'building',
  '🏬': 'building',
  '🏨': 'building',
  '🛏': 'bed',
  '🛋': 'bed',
  '🔑': 'key',
  '🧾': 'receipt',
  '💰': 'coins',
  '🍽': 'plate',
  '🍕': 'pizza',
  '🍜': 'bowl',
  '🥡': 'bowl',
  '☕': 'coffee',
  '🎂': 'cake',
  '🍩': 'cake',
  '🍻': 'drinks',
  '🎉': 'party',
  '🎈': 'party',
  '🎁': 'gift',
  '💜': 'heart',
  '❤': 'heart',
  '⚽': 'ball',
  '🏀': 'ball',
  '🏏': 'ball',
  '🏸': 'ball',
  '⭐': 'star',
  '👥': 'people',
};

/** U+FE0F, the variation selector that makes a character render in colour. */
const VARIATION_SELECTOR = /️/g;

/**
 * The mark a stored cover draws as, or `null` when the value is one this set
 * has no drawing for — which is the signal to render the character instead.
 */
export function markForEmoji(emoji: string | null | undefined): GroupMarkId | null {
  if (!emoji) return null;
  return MARK_FOR_EMOJI[emoji.replace(VARIATION_SELECTOR, '')] ?? null;
}

/**
 * Fills sit at a fraction of the stroke colour rather than in a second hue, so
 * one `color` prop is all a caller ever has to get right.
 */
const ACCENT_OPACITY = 0.28;
/** One stroke weight across the whole set, on the 24-unit grid. */
const STROKE = 1.8;

interface PartProps {
  color: string;
}

/**
 * The drawings themselves. Each is described in a sentence because a reader
 * cannot see path data — and because the point of the set is that the marks
 * agree with each other, which is a thing worth being able to check in words.
 */
const MARKS: Readonly<Record<GroupMarkId, (props: PartProps) => ReactElement>> = {
  // A sun over two lines of surf.
  beach: ({ color }) => (
    <>
      <Circle cx={12} cy={7} r={3.4} fill={color} fillOpacity={ACCENT_OPACITY} />
      <Circle cx={12} cy={7} r={3.4} stroke={color} strokeWidth={STROKE} fill="none" />
      <Path d="M2.5 15c1.6-1.6 3.2-1.6 4.8 0s3.2 1.6 4.8 0 3.2-1.6 4.8 0 3.2 1.6 4.8 0" />
      <Path d="M2.5 19.5c1.6-1.6 3.2-1.6 4.8 0s3.2 1.6 4.8 0 3.2-1.6 4.8 0 3.2 1.6 4.8 0" />
    </>
  ),
  // Two peaks, the taller one with a filled snow cap.
  mountain: ({ color }) => (
    <>
      <Path d="M11 19.5 16.2 10.8 21.5 19.5Z" />
      <Path d="M2.5 19.5 8.8 7.5 15.1 19.5Z" />
      <Path d="M8.8 7.5 6.5 11.9h4.6Z" fill={color} fillOpacity={ACCENT_OPACITY} stroke="none" />
    </>
  ),
  // A ridge tent: outline, centre pole, and a filled doorway.
  tent: ({ color }) => (
    <>
      <Path d="M12 4.5 21 19.5H3Z" />
      <Path d="M12 4.5V19.5" />
      <Path d="M12 11 15.4 19.5H8.6Z" fill={color} fillOpacity={ACCENT_OPACITY} stroke="none" />
    </>
  ),
  // A paper plane, its near wing filled.
  plane: ({ color }) => (
    <>
      <Path d="M21 3 3 10.6l7.4 3L13.4 21Z" />
      <Path d="M10.4 13.6 21 3" />
      <Path d="M10.4 13.6 13.4 21 21 3Z" fill={color} fillOpacity={ACCENT_OPACITY} stroke="none" />
    </>
  ),
  // A small car: cabin, body, two filled wheels.
  car: ({ color }) => (
    <>
      <Path d="M6.2 12 8 7.5h8l1.8 4.5" />
      <Rect x={3} y={12} width={18} height={5} rx={2} />
      <Circle cx={7.5} cy={18} r={1.9} fill={color} fillOpacity={ACCENT_OPACITY} />
      <Circle cx={7.5} cy={18} r={1.9} />
      <Circle cx={16.5} cy={18} r={1.9} fill={color} fillOpacity={ACCENT_OPACITY} />
      <Circle cx={16.5} cy={18} r={1.9} />
    </>
  ),
  // A sailboat: filled sail on a mast, hull below.
  boat: ({ color }) => (
    <>
      <Path d="M12 3.5V14" />
      <Path d="M12 5 19 13.5h-7Z" fill={color} fillOpacity={ACCENT_OPACITY} />
      <Path d="M3.5 16h17L18 20.5H6Z" />
    </>
  ),
  // A house: roof, walls, and a filled door.
  home: ({ color }) => (
    <>
      <Path d="M3 10.8 12 3.8l9 7" />
      <Path d="M5.4 9.4V20.2h13.2V9.4" />
      <Rect
        x={10}
        y={14.4}
        width={4}
        height={5.8}
        rx={1}
        fill={color}
        fillOpacity={ACCENT_OPACITY}
        stroke="none"
      />
    </>
  ),
  // A block of flats with six filled windows.
  building: ({ color }) => (
    <>
      <Rect x={4} y={3.5} width={16} height={17} rx={2} />
      {[7, 11, 15].map((y) => (
        <Rect
          key={y}
          x={7.2}
          y={y}
          width={3.4}
          height={2.6}
          rx={0.7}
          fill={color}
          fillOpacity={ACCENT_OPACITY}
          stroke="none"
        />
      ))}
      {[7, 11, 15].map((y) => (
        <Rect
          key={y}
          x={13.4}
          y={y}
          width={3.4}
          height={2.6}
          rx={0.7}
          fill={color}
          fillOpacity={ACCENT_OPACITY}
          stroke="none"
        />
      ))}
    </>
  ),
  // A bed seen from the side: headboard, mattress, filled pillow, two legs.
  bed: ({ color }) => (
    <>
      <Path d="M3 17.5V7.5" />
      <Rect x={3} y={11.5} width={18} height={6} rx={1.6} />
      <Rect
        x={5.2}
        y={13.2}
        width={5}
        height={2.8}
        rx={1.1}
        fill={color}
        fillOpacity={ACCENT_OPACITY}
        stroke="none"
      />
      <Path d="M4.4 17.5v3" />
      <Path d="M19.6 17.5v3" />
    </>
  ),
  // A key lying on its side, bit to the right.
  key: ({ color }) => (
    <>
      <Circle cx={7} cy={12} r={4} fill={color} fillOpacity={ACCENT_OPACITY} />
      <Circle cx={7} cy={12} r={4} />
      <Circle cx={7} cy={12} r={1.2} fill={color} stroke="none" />
      <Path d="M11 12h10" />
      <Path d="M17 12v3.6" />
      <Path d="M20 12v2.6" />
    </>
  ),
  // A till receipt with a torn foot and two filled lines of print.
  receipt: ({ color }) => (
    <>
      <Path d="M6 3.5h12v17l-2.5-1.6L13 20.5l-2.5-1.6L8 20.5l-2-1.3Z" />
      <Path d="M9 8h6" stroke={color} strokeOpacity={0.55} />
      <Path d="M9 12h6" stroke={color} strokeOpacity={0.55} />
    </>
  ),
  // Three coins in a stack, the top one filled.
  coins: ({ color }) => (
    <>
      <Ellipse cx={12} cy={17} rx={7} ry={2.8} />
      <Ellipse cx={12} cy={12} rx={7} ry={2.8} />
      <Ellipse cx={12} cy={7} rx={7} ry={2.8} fill={color} fillOpacity={ACCENT_OPACITY} />
      <Ellipse cx={12} cy={7} rx={7} ry={2.8} />
    </>
  ),
  // A plate with a fork beside it.
  plate: ({ color }) => (
    <>
      <Circle cx={14} cy={12} r={6.4} />
      <Circle cx={14} cy={12} r={3.2} fill={color} fillOpacity={ACCENT_OPACITY} stroke="none" />
      <Path d="M3 4v4.6h3.2V4" />
      <Path d="M4.6 8.6V20" />
    </>
  ),
  // A wedge of pizza with three toppings.
  pizza: ({ color }) => (
    <>
      <Path d="M12 3.5 20.5 19.5h-17Z" />
      <Path d="M4.6 17.2h14.8" stroke={color} strokeOpacity={0.55} />
      <Circle cx={10} cy={11.5} r={1.3} fill={color} fillOpacity={ACCENT_OPACITY} stroke="none" />
      <Circle cx={14.4} cy={13} r={1.3} fill={color} fillOpacity={ACCENT_OPACITY} stroke="none" />
      <Circle cx={11.6} cy={15.8} r={1.3} fill={color} fillOpacity={ACCENT_OPACITY} stroke="none" />
    </>
  ),
  // A noodle bowl with two curls of steam.
  bowl: ({ color }) => (
    <>
      <Path d="M3 11.5h18a9 9 0 0 1-18 0Z" fill={color} fillOpacity={ACCENT_OPACITY} />
      <Path d="M9 4.5v3.5" />
      <Path d="M13 4.5v3.5" />
    </>
  ),
  // A cup with a handle and two wisps of steam.
  coffee: ({ color }) => (
    <>
      <Path d="M4.5 8h12.5l-1.4 10H5.9Z" fill={color} fillOpacity={ACCENT_OPACITY} />
      <Path d="M17 10h1.6a2.6 2.6 0 0 1 0 5.2h-1.1" />
      <Path d="M9 2.5v2.6" />
      <Path d="M13 2.5v2.6" />
    </>
  ),
  // A cake with one lit candle.
  cake: ({ color }) => (
    <>
      <Rect x={3.5} y={12} width={17} height={8.2} rx={2} />
      <Path d="M3.5 15.6h17" stroke={color} strokeOpacity={0.55} />
      <Path d="M12 8V12" />
      <Circle cx={12} cy={5.8} r={1.7} fill={color} fillOpacity={ACCENT_OPACITY} />
      <Circle cx={12} cy={5.8} r={1.7} />
    </>
  ),
  // Two glasses raised together.
  drinks: ({ color }) => (
    <>
      <Path d="M4.5 4.5h6.4L7.7 11Z" fill={color} fillOpacity={ACCENT_OPACITY} />
      <Path d="M7.7 11v7" />
      <Path d="M5.2 18h5" />
      <Path d="M13.1 4.5h6.4L16.3 11Z" fill={color} fillOpacity={ACCENT_OPACITY} />
      <Path d="M16.3 11v7" />
      <Path d="M13.8 18h5" />
    </>
  ),
  // A party popper firing confetti.
  party: ({ color }) => (
    <>
      <Path d="M3 21 9.6 8.4 15.6 14.4Z" fill={color} fillOpacity={ACCENT_OPACITY} />
      <Circle cx={17.6} cy={5.4} r={1.4} fill={color} stroke="none" />
      <Circle cx={20.4} cy={9.6} r={1.1} fill={color} stroke="none" />
      <Circle cx={13.4} cy={3.6} r={1.1} fill={color} stroke="none" />
    </>
  ),
  // A wrapped box: lid, ribbon down the front, a bow of two loops.
  gift: ({ color }) => (
    <>
      <Rect x={3.8} y={9.6} width={16.4} height={10.9} rx={1.6} />
      <Rect
        x={2.6}
        y={5.8}
        width={18.8}
        height={4}
        rx={1.3}
        fill={color}
        fillOpacity={ACCENT_OPACITY}
      />
      <Path d="M12 5.8v14.7" />
      <Circle cx={9.6} cy={3.7} r={2.1} />
      <Circle cx={14.4} cy={3.7} r={2.1} />
    </>
  ),
  // A filled heart.
  heart: ({ color }) => (
    <Path
      d="M12 20.6C5 15.6 2.6 12 2.6 8.8a5.2 5.2 0 0 1 9.4-2.9 5.2 5.2 0 0 1 9.4 2.9c0 3.2-2.4 6.8-9.4 11.8Z"
      fill={color}
      fillOpacity={ACCENT_OPACITY}
    />
  ),
  // A football: a filled centre panel with seams running to the rim.
  ball: ({ color }) => (
    <>
      <Circle cx={12} cy={12} r={8.6} />
      <Path
        d="M12 7.4 16.2 10.5 14.6 15.4H9.4L7.8 10.5Z"
        fill={color}
        fillOpacity={ACCENT_OPACITY}
      />
      <Path d="M12 7.4V3.4" />
      <Path d="M16.2 10.5 20 9.2" />
      <Path d="M7.8 10.5 4 9.2" />
      <Path d="M14.6 15.4 17 18.7" />
      <Path d="M9.4 15.4 7 18.7" />
    </>
  ),
  // A five-pointed star, filled.
  star: ({ color }) => (
    <Path
      d="M12 2.8 14.9 9.1 21.7 9.9 16.7 14.6 18 21.3 12 18 6 21.3 7.3 14.6 2.3 9.9 9.1 9.1Z"
      fill={color}
      fillOpacity={ACCENT_OPACITY}
    />
  ),
  // Two people, one a step behind the other.
  people: ({ color }) => (
    <>
      <Circle cx={16} cy={8.4} r={2.8} />
      <Path d="M15.6 14.2a5.4 5.4 0 0 1 5 5.4" />
      <Circle cx={9.4} cy={8} r={3.4} fill={color} fillOpacity={ACCENT_OPACITY} />
      <Circle cx={9.4} cy={8} r={3.4} />
      <Path d="M3.4 19.6a6 6 0 0 1 12 0" />
    </>
  ),
};

export interface GroupMarkProps {
  /** The stored cover — an emoji, or null for a group that never picked one. */
  emoji?: string | null;
  /** Box size in points. The drawing scales; the stroke weight scales with it. */
  size?: number;
  /**
   * The mark's one colour. Strokes take it at full strength, fills at
   * `ACCENT_OPACITY`. Defaults to the brand accent.
   */
  color?: string;
}

/**
 * A group's cover, drawn when we have a mark for it and rendered as the stored
 * character when we do not.
 *
 * The fallback is deliberately the plain emoji rather than a generic
 * "unknown" mark: a group that picked 🍔 years ago should keep showing a
 * burger, not lose its identity to a placeholder because this set is finite.
 */
export function GroupMark({ emoji, size = 24, color }: GroupMarkProps) {
  const theme = useTheme();
  const ink = color ?? theme.color.brand;
  // A group that never picked a cover draws the two-people mark, which is the
  // 👥 it has always shown — only drawn rather than typed.
  const id = emoji ? markForEmoji(emoji) : 'people';

  if (!id) {
    // No mark for this cover: the character itself, sized to fill the same box
    // an icon would, so a mixed list still lines up.
    return <Text style={{ fontSize: size * 0.82 }}>{emoji}</Text>;
  }

  const Drawing = MARKS[id];
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={ink}
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Drawing color={ink} />
    </Svg>
  );
}
