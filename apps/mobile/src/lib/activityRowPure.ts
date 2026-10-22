/**
 * What an Activity row wears: the glyph tile, the category it names in its
 * meta line, and how its amount is drawn. Pure, so the mapping is testable
 * without React; the screen only turns the answers into pixels.
 *
 * A bill being added or restored shows what it was for (the same category icon
 * and tint the expense lists use). A deleted bill keeps the red bin, since the
 * point of the row is that it is gone, but its meta still names the category.
 * Everything else (an edit, a settlement, a join) keeps the verb's own mark.
 */

import { guessCategory, resolveCategory, type CategoryMeta, type TintName } from '@waves/core';

import { groupChangeIcon, verbIcon, verbTint } from '@/data/activity';
import type { HomeHero } from '@/lib/homeHeroPure';

/** Ionicons carries almost every glyph; a fuel pump is only in Material
 *  Community Icons, which ships in the same package. */
export type GlyphFamily = 'ion' | 'mci';

export interface RowGlyph {
  family: GlyphFamily;
  name: string;
  tint: TintName;
}

export interface RowCategory {
  glyph: RowGlyph;
  label: string;
}

const FUEL_WORDS: ReadonlySet<string> = new Set(['petrol', 'diesel', 'fuel']);

const FUEL_GLYPH: RowGlyph = { family: 'mci', name: 'gas-station-outline', tint: 'mint' };

function isFuel(description: string): boolean {
  return description
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .some((token) => FUEL_WORDS.has(token));
}

/**
 * The category an expense event is about, or null when it has none to name.
 * A custom tag keeps its own icon, tint and label. A built-in follows its
 * stored key, or a guess from the description when none was stored; fuel words
 * in the description win over a stored built-in so "Petrol" is never a fork.
 */
export function activityCategory(
  description: string,
  stored: { key: string | null; meta: CategoryMeta | null } | null,
  labelForBuiltin: (id: string) => string | undefined,
): RowCategory | null {
  if (stored?.meta) {
    const resolved = resolveCategory(stored.key, stored.meta);
    return {
      glyph: { family: 'ion', name: resolved.icon, tint: resolved.tint },
      label: resolved.label,
    };
  }
  if (isFuel(description)) {
    return { glyph: FUEL_GLYPH, label: labelForBuiltin('travel') ?? 'Travel' };
  }
  const key = stored?.key ?? guessCategory(description);
  if (!key) return null;
  const resolved = resolveCategory(key, null);
  return {
    glyph: { family: 'ion', name: resolved.icon, tint: resolved.tint },
    label: labelForBuiltin(resolved.key) ?? resolved.label,
  };
}

/**
 * The tile glyph for an event, given the category it names (if any). A
 * settings change (`group_updated`) draws the setting that moved — `field` is
 * the row's `payload.field` — rather than one cog for all of them.
 */
export function activityTileGlyph(
  verb: string,
  objectType: string,
  category: RowCategory | null,
  field: string | null = null,
): RowGlyph {
  const billVerb = verb === 'added' || verb === 'restored';
  if (objectType === 'expense' && billVerb && category) return category.glyph;
  if (verb === 'group_updated') {
    return { family: 'ion', name: groupChangeIcon(field), tint: verbTint(verb) };
  }
  return { family: 'ion', name: verbIcon(verb), tint: verbTint(verb) };
}

export type AmountTone = 'positive' | 'negative';

/** A bill or a settlement reads in the theme's positive colour (the app's blue:
 *  its palette has no green), a deleted bill in the negative one, struck
 *  through. Not the reader's side of the bill: the row says what happened. */
export function activityAmountStyle(verb: string): { tone: AmountTone; strike: boolean } {
  if (verb === 'deleted') return { tone: 'negative', strike: true };
  return { tone: 'positive', strike: false };
}

/** Scenes whose sky is pale enough for dark title ink; the deep ones need white. */
const LIGHT_HEROES: ReadonlySet<HomeHero> = new Set<HomeHero>([
  'morning',
  'late-morning',
  'afternoon',
  'spring',
  'autumn',
  'rainy',
]);

/** Whether the title over this scene should be dark (true) or white (false). */
export function heroWantsDarkInk(hero: HomeHero): boolean {
  return LIGHT_HEROES.has(hero);
}
