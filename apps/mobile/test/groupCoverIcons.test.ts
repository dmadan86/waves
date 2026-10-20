/**
 * The icon-and-colour picker's data and decisions: what the catalog offers and
 * how a pick is found, what each stored colour key resolves to in each scheme,
 * and what pressing Done writes. The sheet itself is drawn, not asserted.
 */

import { describe, expect, it, vi } from 'vitest';

import { GROUP_COVER_COLORS } from '@waves/core';
import { darkTheme, lightTheme } from '@waves/ui/themes';

import { STRINGS_BY_LANGUAGE } from '../src/i18n';
import {
  GROUP_ICON_CATALOG,
  GROUP_ICON_CATEGORY_IDS,
  filterGroupIcons,
} from '../src/lib/groupIconCatalog';
import { coverTone, planCoverCommit } from '../src/lib/groupCoverTone';

// `GroupMark` draws with react-native-svg and the UI kit; only its pure lookup
// tables are under test here.
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
vi.mock('react-native-svg', () => ({ default: {}, Circle: {}, Ellipse: {}, Path: {}, Rect: {} }));
vi.mock('@waves/ui', () => ({ Text: {}, useTheme: () => lightTheme }));

const { GROUP_MARK_IDS, EMOJI_FOR_MARK, markForEmoji } =
  await import('../src/components/GroupMark');

const all = GROUP_ICON_CATEGORY_IDS.flatMap((id) => GROUP_ICON_CATALOG[id]);

describe('the icon catalog', () => {
  it('has nine categories of 12 to 20 icons each, and well over a hundred in all', () => {
    expect(GROUP_ICON_CATEGORY_IDS).toHaveLength(9);
    for (const id of GROUP_ICON_CATEGORY_IDS) {
      expect(GROUP_ICON_CATALOG[id].length).toBeGreaterThanOrEqual(12);
      expect(GROUP_ICON_CATALOG[id].length).toBeLessThanOrEqual(20);
    }
    expect(all.length).toBeGreaterThanOrEqual(120);
  });

  it('lists no emoji twice, and no two entries that draw as the same mark', () => {
    const emoji = all.map((entry) => entry.emoji);
    expect(new Set(emoji).size).toBe(emoji.length);
    const marks = all.map((entry) => markForEmoji(entry.emoji)).filter(Boolean);
    expect(new Set(marks).size).toBe(marks.length);
  });

  it('keeps every drawn mark reachable, under its canonical emoji', () => {
    const listed = new Set(all.map((entry) => entry.emoji));
    for (const id of GROUP_MARK_IDS) expect(listed.has(EMOJI_FOR_MARK[id])).toBe(true);
  });

  it('gives every category a label in every language', () => {
    for (const lang of Object.values(STRINGS_BY_LANGUAGE)) {
      for (const id of GROUP_ICON_CATEGORY_IDS) {
        expect(lang.groupIconPicker.categories[id]).toBeTruthy();
      }
      for (const key of GROUP_COVER_COLORS) {
        expect(lang.groupIconPicker.colours[key]).toBeTruthy();
      }
      expect(lang.groupIconPicker.colour).toBeTruthy();
      expect(lang.groupIconPicker.searchPlaceholder).toBeTruthy();
    }
  });
});

describe('searching icons', () => {
  it('finds by keyword, case-insensitively, across words', () => {
    const food = GROUP_ICON_CATALOG.food;
    expect(filterGroupIcons(food, 'PIZZA').map((entry) => entry.emoji)).toEqual(['🍕']);
    expect(filterGroupIcons(GROUP_ICON_CATALOG.travel, 'road trip').map((e) => e.emoji)).toContain(
      '🚗',
    );
  });

  it('returns everything for an empty search and nothing for nonsense', () => {
    expect(filterGroupIcons(GROUP_ICON_CATALOG.work, '  ')).toHaveLength(
      GROUP_ICON_CATALOG.work.length,
    );
    expect(filterGroupIcons(GROUP_ICON_CATALOG.work, 'zzzqqq')).toHaveLength(0);
  });

  it('also matches words the caller supplies, such as a translated mark name', () => {
    const hits = filterGroupIcons(GROUP_ICON_CATALOG.food, 'ஊட்டம்', (entry) =>
      entry.emoji === '🍕' ? 'ஊட்டம்' : '',
    );
    expect(hits.map((entry) => entry.emoji)).toEqual(['🍕']);
  });
});

describe('cover colour tones', () => {
  it('resolves every palette key to a tile and ink in both schemes', () => {
    for (const theme of [lightTheme, darkTheme]) {
      for (const key of GROUP_COVER_COLORS) {
        const tone = coverTone(key, theme);
        expect(tone?.bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(tone?.ink).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });

  it('maps the same key to a different tone in dark mode', () => {
    for (const key of GROUP_COVER_COLORS) {
      expect(coverTone(key, darkTheme)?.bg).not.toBe(coverTone(key, lightTheme)?.bg);
    }
  });

  it('leaves a group with no (or an unknown) colour on the default tile', () => {
    expect(coverTone(null, lightTheme)).toBeNull();
    expect(coverTone(undefined, lightTheme)).toBeNull();
    expect(coverTone('chartreuse', lightTheme)).toBeNull();
  });
});

describe('what Done writes', () => {
  const now = { icon: '🏖️', color: null };

  it('writes nothing when nothing changed', () => {
    expect(planCoverCommit(now, { ...now })).toEqual({});
  });

  it('writes only the icon when only the icon changed', () => {
    expect(planCoverCommit(now, { icon: '🍕', color: null })).toEqual({ icon: '🍕' });
  });

  it('writes only the colour when only the colour changed, and null to reset it', () => {
    expect(planCoverCommit(now, { icon: '🏖️', color: 'peach' })).toEqual({ color: 'peach' });
    expect(planCoverCommit({ icon: '🏖️', color: 'peach' }, { icon: '🏖️', color: null })).toEqual({
      color: null,
    });
  });

  it('never writes an emptied icon', () => {
    expect(planCoverCommit(now, { icon: null, color: 'mint' })).toEqual({ color: 'mint' });
  });
});
