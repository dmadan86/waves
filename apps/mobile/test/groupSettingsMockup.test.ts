/**
 * The group settings page follows the owner's mockup, and nothing that used to
 * live on it was lost: what is not in the mockup moved into the "Edit group"
 * sheet. The source is pinned rather than mounting the native screen.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { GROUP_COVER_COLORS } from '@waves/core';
import { darkTheme, lightTheme } from '@waves/ui/themes';

import { STRINGS_BY_LANGUAGE } from '../src/i18n';
import { COVER_SWATCHES, coverTone } from '../src/lib/groupCoverTone';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
vi.mock('react-native-svg', () => ({ default: {}, Circle: {}, Ellipse: {}, Path: {}, Rect: {} }));
vi.mock('@waves/ui', () => ({ Text: {}, useTheme: () => lightTheme }));

const { markForEmoji } = await import('../src/components/GroupMark');
const { QUICK_ICONS, quickIconFor } = await import('../src/lib/groupCoverQuick');
const { GROUP_ICON_CATALOG, GROUP_ICON_CATEGORY_IDS } = await import('../src/lib/groupIconCatalog');

const SCREEN = readFileSync(join(process.cwd(), 'src/app/group/[id]/settings.tsx'), 'utf8');
const COVER = readFileSync(join(process.cwd(), 'src/components/CoverEmojiPicker.tsx'), 'utf8');

const between = (source: string, from: string, to: string): string => {
  const start = source.indexOf(from);
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf(to, start));
};

describe('settings page layout', () => {
  it('uses the standard scenic header, left-aligned with a round back button and a Change pill', () => {
    expect(SCREEN).toContain('<ScenicHeader');
    expect(SCREEN).toContain('titleAlign="start"');
    expect(SCREEN).toContain('circleBack');
    expect(SCREEN).toContain('t.group.changePill');
    expect(SCREEN).toContain('setCoverOpen(true)');
  });

  it('puts fewer repayments and mute in one card, each with an info dot and a toggle', () => {
    const card = between(SCREEN, "leading={chip('swap-horizontal'", 'Members');
    expect(card).toContain('t.group.simplifyDebtsSub');
    expect(card).toContain('t.group.muteSub');
    expect(card).toContain("infoDot('simplify'");
    expect(card).toContain("infoDot('mute'");
    expect(card).toContain('simplify_debts: value');
    expect(card).toContain('setGroupMute.mutate');
  });

  it('opens the existing Add someone sheet from Add members, and invites from the last roster row', () => {
    expect(SCREEN).toContain('setAddOpen(true)');
    expect(SCREEN).toContain('`/group/${groupId}/invite`');
    expect(SCREEN.indexOf('t.group.inviteToGroup}')).toBeGreaterThan(
      SCREEN.indexOf('memberActions'),
    );
  });

  it('highlights the viewer and gives everyone else a ⋮ menu of the member actions', () => {
    expect(SCREEN).toContain('highlight={isMe ? theme.color.brandSoft : undefined}');
    expect(SCREEN).toContain('{isMe ? null : (');
    const actions = between(SCREEN, 'const memberActions', 'return (\n    <View style={{ flex: 1');
    expect(actions).toContain("key: 'open'");
    expect(actions).toContain("key: 'role'");
    expect(actions).toContain("key: 'remove'");
    // Link to a Waves user: placeholders only, admin only, with the waiting state.
    expect(actions).toContain("key: 'link'");
    expect(actions).toContain('ghost && isAdmin && !member.left_at');
    expect(SCREEN).toContain('<LinkMemberSheet');
    expect(SCREEN).toContain('t.link.waiting');
    // Only an admin can change a role or remove somebody, as on the member screen.
    expect(actions).toContain('isAdmin && !isMe');
    // The hook for PR #1355 is left in place.
    expect(SCREEN).toContain('Link to a Waves user');
  });

  it('keeps every group action, admin-gating delete and keeping the unsettled warning in the dialog', () => {
    const actions = between(SCREEN, 't.group.groupActions', '</ScenicBody>');
    for (const key of [
      't.clone.duplicateTitle',
      't.clone.favoriteTitle',
      't.group.archiveGroup',
      't.group.leaveGroup',
      't.group.deleteGroup',
    ]) {
      expect(actions).toContain(key);
    }
    expect(actions).toContain('{isAdmin ? (');
    expect(SCREEN).not.toContain('deleteUnsettledHint');
    expect(SCREEN).toContain('groupDeleteWarning(');
  });
});

describe('what moved into the Edit group sheet', () => {
  const sheet = between(SCREEN, 'title={t.group.editGroup}\n        closeLabel', '</Sheet>');

  it('is opened by the pencil beside the name', () => {
    expect(SCREEN).toContain('accessibilityLabel={t.group.editGroup}');
    expect(SCREEN).toContain('setEditOpen(true)');
  });

  it('still holds name, description, kind, tag, country, currency, trip rates and dates', () => {
    for (const piece of [
      'commitName',
      'commitDescription',
      '<ChipRow<GroupType>',
      '<GroupTagField',
      '<CountryRow',
      '<SettlesInRow',
      '<SettleInCurrencyRow',
      '<TripRatesCard',
      '<MissingRatesCard',
      '<TripDates',
      't.group.groupDetails',
    ]) {
      expect(sheet).toContain(piece);
    }
  });

  it('keeps the permission checks, and commits typed text when it closes', () => {
    expect(sheet).toContain('canEdit={isAdmin}');
    expect(sheet).toContain('isAdmin={isAdmin}');
    expect(sheet).toContain('locked={!canChangeCurrency}');
    expect(SCREEN).toMatch(/const closeEdit[\s\S]*commitName\(\);[\s\S]*commitDescription\(\);/);
  });

  it('steps out of the way for the country picker route and returns to it', () => {
    expect(sheet).toContain('onOpen={leaveEditForPicker}');
    expect(SCREEN).toContain('useFocusEffect');
  });
});

describe('group cover sheet', () => {
  it('is one sheet with the two tabs, steps 1 and 2, See all, and a pinned Done', () => {
    for (const piece of [
      't.group.coverSubtitle',
      't.group.coverTabIcon',
      't.group.coverTabPhoto',
      't.group.chooseIconStep',
      't.group.chooseColourStep',
      't.group.seeAll',
      '<QuickIconGrid',
      '<SwatchRow',
      '<CloudPreview',
    ]) {
      expect(COVER).toContain(piece);
    }
    const sheet = COVER.slice(COVER.indexOf('export function GroupCoverSheet'));
    // Done sits after the scrolling part, outside it.
    expect(sheet.indexOf('</ScrollView>')).toBeLessThan(sheet.lastIndexOf('t.common.done'));
  });

  it('keeps the photo gate on the Photo tab', () => {
    expect(COVER).toContain("photoStatus === 'locked'");
    expect(COVER).toContain('onUpgrade()');
  });

  it('offers the ten quick icons, every one a catalogue emoji or a plain mark', () => {
    expect(QUICK_ICONS.map((q) => q.id)).toEqual([
      'food',
      'travel',
      'home',
      'friends',
      'shopping',
      'event',
      'car',
      'wallet',
      'game',
      'other',
    ]);
    const catalogued = new Set(
      GROUP_ICON_CATEGORY_IDS.flatMap((id) => GROUP_ICON_CATALOG[id].map((e) => e.emoji)),
    );
    for (const quick of QUICK_ICONS) expect(catalogued.has(quick.emoji)).toBe(true);
  });

  it('draws every quick tile with the same mark the cover renders for its stored value', () => {
    // The tile renders <GroupMark emoji={quick.emoji}>; the preview, avatars and
    // lists render <GroupMark emoji={stored}> with stored === quick.emoji. So
    // the glyph is the same if the stored value resolves to a drawn mark.
    expect(COVER).toContain('<GroupMark emoji={quick.emoji}');
    expect(COVER).not.toContain('QuickGlyph');
    const marks = QUICK_ICONS.map((quick) => markForEmoji(quick.emoji));
    for (const mark of marks) expect(mark).not.toBeNull();
    expect(new Set(marks).size).toBe(QUICK_ICONS.length);
  });

  it('lights the quick tile for a stored emoji, and none for an icon only See all has', () => {
    expect(quickIconFor('🍽️')).toBe('food');
    expect(quickIconFor('🍽')).toBe('food');
    expect(quickIconFor('🚕')).toBe('car');
    expect(quickIconFor('🍕')).toBeNull();
    expect(quickIconFor(null)).toBeNull();
  });

  it('draws eight swatches that map to valid, distinct palette keys with tones in both schemes', () => {
    expect(COVER_SWATCHES).toHaveLength(8);
    expect(new Set(COVER_SWATCHES.map((s) => s.key)).size).toBe(8);
    for (const swatch of COVER_SWATCHES) {
      expect((GROUP_COVER_COLORS as readonly string[]).includes(swatch.key)).toBe(true);
      expect(swatch.hex).toMatch(/^#[0-9A-F]{6}$/);
      expect(coverTone(swatch.key, lightTheme)).not.toBeNull();
      expect(coverTone(swatch.key, darkTheme)).not.toBeNull();
    }
  });

  it('keeps the original twelve colour keys valid', () => {
    for (const key of [
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
    ]) {
      expect((GROUP_COVER_COLORS as readonly string[]).includes(key)).toBe(true);
    }
  });
});

describe('strings', () => {
  it('has every new string in every language', () => {
    for (const lang of Object.values(STRINGS_BY_LANGUAGE)) {
      for (const key of [
        'createdOn',
        'changePill',
        'editGroup',
        'groupDetails',
        'simplifyDebtsSub',
        'muteSub',
        'addMembers',
        'membersTitle',
        'inviteToGroup',
        'inviteToGroupHint',
        'groupActions',
        'archiveHintShort',
        'deleteHintShort',
        'adminTitle',
        'openMember',
        'memberMenu',
        'coverSubtitle',
        'coverTabIcon',
        'coverTabPhoto',
        'chooseIconStep',
        'chooseColourStep',
        'seeAll',
      ] as const) {
        expect(lang.group[key]).toBeTruthy();
      }
      for (const quick of QUICK_ICONS) expect(lang.groupIconPicker.quick[quick.id]).toBeTruthy();
    }
  });
});

describe('review fixes', () => {
  const PARTS = readFileSync(join(process.cwd(), 'src/components/standard/parts.tsx'), 'utf8');

  it('commits name, description and tag on close and before a picker route', () => {
    const pending = between(SCREEN, 'const commitPending', 'const leaveEditForPicker');
    for (const call of ['commitName()', 'commitDescription()', 'commitTag(tag)']) {
      expect(pending).toContain(call);
    }
    expect(between(SCREEN, 'const leaveEditForPicker', 'const closeEdit')).toContain(
      'commitPending()',
    );
    expect(between(SCREEN, 'const closeEdit', 'A member')).toContain('commitPending()');
  });

  it('keeps the ⓘ button and its explanation out of an accessible text group', () => {
    const trailing = between(PARTS, 'const body = trailing', ') : onPress ? (');
    expect(trailing).not.toContain('accessible\n');
    expect(trailing).not.toMatch(/accessible\s+accessibilityLabel/);
  });

  it('lets row titles shrink so they never reach accessories or trailing controls', () => {
    expect(PARTS).toMatch(/flexShrink: 1 \}/);
    expect(PARTS).toContain('minWidth: 0');
  });
});
