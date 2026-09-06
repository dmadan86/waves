/**
 * The glyphs a custom tag may wear, typed against this app's own glyph map.
 *
 * The names themselves live in `@waves/core` so the sync edge function can
 * validate against the same list (see the note there). This module is what
 * proves they are real: `IoniconName` is `keyof typeof Ionicons.glyphMap`, so a
 * name that is not a glyph fails to compile, and `tagIcons.test.ts` walks the
 * whole list. Core holds the vocabulary; the app holds the guarantee.
 */

import Ionicons from '@expo/vector-icons/Ionicons';

import {
  DEFAULT_TAG_ICON as CORE_DEFAULT,
  TAG_ICON_GROUPS as CORE_GROUPS,
  TAG_ICONS as CORE_ICONS,
} from '@waves/core';

export type IoniconName = keyof typeof Ionicons.glyphMap;

/** Grouped for the picker; flattened into `TAG_ICONS` below. */
export const TAG_ICON_GROUPS = CORE_GROUPS as readonly (readonly IoniconName[])[];

/** The flat list the editor renders — every group, in order. */
export const TAG_ICONS = CORE_ICONS as readonly IoniconName[];

/** The default a new tag starts on. */
export const DEFAULT_TAG_ICON = CORE_DEFAULT as IoniconName;
