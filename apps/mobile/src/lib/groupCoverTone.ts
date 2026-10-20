/**
 * Turning a group's `cover_color` key into the tile colours behind its icon.
 *
 * The key list is `GROUP_COVER_COLORS` in `@waves/core`; this file owns the
 * tones. Six of them are the app's own pastel tints (`theme.tint`, which already
 * has a dark mapping); the other six are defined here with a light and a dark
 * pair, so the same stored key reads as a soft tile on a light screen and a
 * deep one on a dark screen. A null or unrecognised key resolves to null, which
 * every caller reads as "keep the tile you always drew" — that is how a group
 * that never picked a colour looks exactly as it did before this existed.
 */

import { isGroupCoverColor } from '@waves/core';
import type { Theme } from '@waves/ui';

export interface CoverTone {
  /** The tile behind the icon. */
  readonly bg: string;
  /** The icon's own colour on that tile. */
  readonly ink: string;
}

const OWN: Readonly<
  Record<
    | 'butter'
    | 'sage'
    | 'indigo'
    | 'teal'
    | 'berry'
    | 'slate'
    | 'iris'
    | 'blue'
    | 'aqua'
    | 'green'
    | 'yellow'
    | 'orange',
    Record<'light' | 'dark', CoverTone>
  >
> = {
  butter: {
    light: { bg: '#FFF1B8', ink: '#7A5B00' },
    dark: { bg: '#4A3F14', ink: '#F5DE8A' },
  },
  sage: {
    light: { bg: '#DDEBD3', ink: '#3F6B2E' },
    dark: { bg: '#28402A', ink: '#BFE0B2' },
  },
  indigo: {
    light: { bg: '#4F46E5', ink: '#FFFFFF' },
    dark: { bg: '#3B3799', ink: '#D9D7FF' },
  },
  teal: {
    light: { bg: '#0F9D94', ink: '#FFFFFF' },
    dark: { bg: '#0B5F5A', ink: '#A8EDE8' },
  },
  berry: {
    light: { bg: '#C2417A', ink: '#FFFFFF' },
    dark: { bg: '#7A2A52', ink: '#FFC4DD' },
  },
  slate: {
    light: { bg: '#475569', ink: '#F1F5F9' },
    dark: { bg: '#334155', ink: '#CBD5E1' },
  },
  // The cover sheet's eight-swatch row: soft tiles with a strong ink, so the
  // icon reads the way the mockup's preview does.
  iris: { light: { bg: '#E4DEFF', ink: '#4B3FD1' }, dark: { bg: '#2E2A66', ink: '#C9C3FF' } },
  blue: { light: { bg: '#DCEBFF', ink: '#2563C9' }, dark: { bg: '#1E3358', ink: '#AFCDFF' } },
  aqua: { light: { bg: '#D4F3EF', ink: '#0F8A80' }, dark: { bg: '#123F3B', ink: '#9FE6DF' } },
  green: { light: { bg: '#DDF5DF', ink: '#2E8B3F' }, dark: { bg: '#1E3D24', ink: '#B3E8BA' } },
  yellow: { light: { bg: '#FFF0C2', ink: '#A56A00' }, dark: { bg: '#4A3A10', ink: '#F5D98A' } },
  orange: { light: { bg: '#FFE3CC', ink: '#C25A10' }, dark: { bg: '#4A2A14', ink: '#FFC9A0' } },
};

/**
 * The cover sheet's colour row, in order: the solid circle each key is drawn as
 * (the same in both schemes — it is a swatch, not a tile). `iris` is also what
 * a group with no colour chosen shows as selected.
 */
export const COVER_SWATCHES: readonly { key: string; hex: string }[] = [
  { key: 'iris', hex: '#5B4FD8' },
  { key: 'blue', hex: '#5AA9F5' },
  { key: 'aqua', hex: '#4DD0C4' },
  { key: 'green', hex: '#8EDB9A' },
  { key: 'yellow', hex: '#FFC857' },
  { key: 'orange', hex: '#FFA566' },
  { key: 'coral', hex: '#FF8A94' },
  { key: 'lilac', hex: '#C9A0F5' },
];

/** The tone for a key in a theme, or null for "the default tile". */
export function coverTone(key: string | null | undefined, theme: Theme): CoverTone | null {
  if (!isGroupCoverColor(key)) return null;
  if (key in OWN) return OWN[key as keyof typeof OWN][theme.scheme];
  const tint = theme.tint[key as keyof Theme['tint']];
  return { bg: tint.bg, ink: tint.ink };
}

/**
 * What pressing Done changes. The icon and the colour are separate columns, so
 * only the one that moved is written: a colour tweak never rewrites the icon
 * (and the other way round), and Done with nothing changed writes nothing.
 * A cleared icon is never written — an emoji column is not emptied from here.
 */
export function planCoverCommit(
  current: { icon: string | null; color: string | null },
  draft: { icon: string | null; color: string | null },
): { icon?: string; color?: string | null } {
  const plan: { icon?: string; color?: string | null } = {};
  if (draft.icon && draft.icon !== current.icon) plan.icon = draft.icon;
  if (draft.color !== current.color) plan.color = draft.color;
  return plan;
}
