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
  it('uses a plain header with a back arrow, the title and a ⋮ that opens the exit sheet', () => {
    expect(SCREEN).toContain('<PlainHeader');
    expect(SCREEN).not.toContain('<ScenicHeader');
    const header = between(SCREEN, '<PlainHeader', '/>\n\n');
    expect(header).toContain('t.group.settings');
    expect(header).toContain('ellipsis-vertical');
    expect(header).toContain('setExitOpen(true)');
  });

  it('draws the header inside the one card: cover with a camera badge, name with a pencil, members then created', () => {
    const card = between(SCREEN, '<StandardCard style={{ paddingVertical', 'PlainListRow');
    expect(card).toContain('<GroupPhoto');
    expect(card).toContain('size={72}');
    expect(card).toContain('name="camera"');
    expect(card).toContain('setCoverOpen(true)');
    expect(card).toContain('setEditOpen(true)');
    expect(card.indexOf('t.memberCount')).toBeLessThan(card.indexOf('createdLabel'));
    expect(card).toContain("' • '");
    expect(SCREEN).not.toContain('t.group.changePill');
  });

  it('has group type as a pill row opening a sheet of the six kinds, and no inline chips', () => {
    const card = between(
      SCREEN,
      't.extras.groupTypeTitle}\n              trailing',
      'setTypeOpen(true)',
    );
    expect(card).toContain('currentType.label');
    // The pill is a label, not a navigation hint: no chevron.
    expect(card).not.toContain('chevron');
    expect(SCREEN).not.toContain('<ChipRow');
    const sheet = between(SCREEN, 'visible={typeOpen}', '</Sheet>');
    expect(sheet).toContain('typeOptions.map');
    expect(sheet).toContain('name="checkmark"');
    expect(sheet).toContain('updateGroup.mutate');
    expect(SCREEN).toContain('GroupType.Friends');
  });

  it('shows Dates for trips and events only, as a row that opens the embedded calendar in a sheet', () => {
    const row = between(SCREEN, '{hasDates ? (', 'setDatesOpen(true)');
    expect(row).toContain('t.extras.datesRow');
    expect(row).toContain('datesSummary');
    expect(SCREEN).toContain('groupType === GroupType.Trip || groupType === GroupType.Event');
    expect(between(SCREEN, 'visible={datesOpen}', '</Sheet>')).toContain('<DatesSheetBody');
  });

  it('shows Other currencies for every group type, as a row that opens the rates editor in a sheet', () => {
    const row = between(
      SCREEN,
      't.fx.otherCurrencies}\n              subtitle',
      'setRatesOpen(true)',
    );
    expect(row).toContain('t.fx.currencyOnly');
    expect(row).toContain('tripRateStore.rows');
    // Not inside the trip/event-only block.
    expect(between(SCREEN, '{hasDates ? (', ') : null}')).not.toContain('t.fx.otherCurrencies');
    expect(between(SCREEN, 'visible={ratesOpen}', '</Sheet>')).toContain('<OtherCurrenciesSheetBody');
  });

  it('keeps the tag as one row in the card that opens a sheet', () => {
    const card = between(SCREEN, 't.fx.otherCurrencies}', '</StandardCard>');
    expect(card).toContain('onPress={() => setTagOpen(true)}');
    expect(between(SCREEN, 'visible={tagOpen}', '</Sheet>')).toContain('<TagSheetBody');
  });

  it('folds group currency and the convert switch into the Other currencies sheet, and no country row', () => {
    const card = between(SCREEN, 't.fx.otherCurrencies}', '</StandardCard>');
    expect(card).not.toContain('<SettlesInRow');
    expect(card).not.toContain('<SettleInCurrencyRow');
    const sheet = between(SCREEN, 'visible={ratesOpen}', '</Sheet>');
    expect(sheet).toContain('currencyLocked={!canChangeCurrency}');
    expect(sheet).toContain('convertOn=');
    expect(SCREEN).not.toContain('CountryRow');
    expect(SCREEN).not.toContain('country_code');
    expect(SCREEN).not.toContain('t.fx.section');
    expect(SCREEN.match(/<StandardCard style=\{\{ paddingVertical/g)).toHaveLength(1);
  });

  it('makes every row tile a 44dp circle', () => {
    const tile = readFileSync(join(process.cwd(), 'src/components/standard/RowTile.tsx'), 'utf8');
    expect(tile).toContain('width: 44');
    expect(tile).toContain('borderRadius: 22');
  });

  it('sizes the dates sheet to its content, with Save right under the card', () => {
    const sheet = between(SCREEN, 'visible={datesOpen}', '</Sheet>');
    expect(sheet).toContain("maxHeight: '90%'");
    expect(sheet).not.toContain('windowHeight');
    const body = readFileSync(join(process.cwd(), 'src/components/DatesSheetBody.tsx'), 'utf8');
    expect(body).not.toContain('style={{ flex: 1 }}\n        contentContainerStyle');
    expect(body).toContain('flexShrink: 1');
  });

  it('names the sheet rows Balances in {currency} and Count foreign bills in {currency}', () => {
    const rates = readFileSync(join(process.cwd(), 'src/components/TripRates.tsx'), 'utf8');
    expect(rates).toContain('t.fx.balancesIn');
    expect(rates).toContain('t.fx.groupCurrencyLine');
    expect(STRINGS_BY_LANGUAGE.en.fx.settleInShort).toBe('Count foreign bills in {currency}');
    expect(STRINGS_BY_LANGUAGE.en.fx.balancesIn).toBe('Balances in {currency}');
  });

  it('has the new strings in every language', () => {
    for (const strings of Object.values(STRINGS_BY_LANGUAGE)) {
      expect(strings.fx.otherCurrencies).toBeTruthy();
      expect(strings.fx.currencyOnly).toContain('{currency}');
      expect(strings.fx.balancesIn).toContain('{currency}');
      expect(strings.fx.groupCurrencyLine).toContain('{name}');
      expect(strings.fx.groupCurrencies).toBeTruthy();
      expect(strings.fx.settleInShort).toContain('{currency}');
      expect(strings.extras.datesRow).toBeTruthy();
    }
  });

  it('puts fewer repayments and mute at the top of Group actions, each with an info dot and a toggle', () => {
    expect(SCREEN.indexOf("leading={chip('swap-horizontal'")).toBeGreaterThan(
      SCREEN.indexOf('t.group.groupActions'),
    );
    const card = between(SCREEN, "leading={chip('swap-horizontal'", "leading={chip('copy-outline'");
    expect(card).toContain('t.group.simplifyDebtsSub');
    expect(card).toContain('t.group.muteSub');
    expect(card).toContain("infoDot('simplify'");
    expect(card).toContain("infoDot('mute'");
    expect(card).toContain('simplify_debts: value');
    expect(card).toContain('setGroupMute.mutate');
  });

  it('opens the existing Add someone sheet from Add members, with no invite row under the roster', () => {
    expect(SCREEN).toContain('setAddOpen(true)');
    expect(SCREEN).not.toContain('t.group.inviteToGroup}');
  });

  it('draws every member row alike and gives everyone else a ⋮ menu of the member actions', () => {
    expect(SCREEN).not.toContain('highlight={isMe');
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

  it('keeps every group action, with archive, leave and delete behind one row and delete admin-gated', () => {
    const actions = between(SCREEN, 't.group.groupActions', 'visible={exitOpen}');
    for (const key of ['t.clone.duplicateTitle', 't.clone.favoriteTitle', 'setExitOpen(true)']) {
      expect(actions).toContain(key);
    }
    expect(actions).not.toContain('t.group.leaveGroup');
    const sheet = between(SCREEN, 'visible={exitOpen}', '</Sheet>');
    for (const key of ['t.group.archiveGroup', 't.group.leaveGroup', 't.group.deleteGroup']) {
      expect(sheet).toContain(key);
    }
    expect(sheet).toContain('{isAdmin ? (');
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

  it('holds only the name and description', () => {
    expect(sheet).toContain('commitName');
    expect(sheet).toContain('commitDescription');
    for (const piece of [
      'setTypeOpen(true)',
      'setTagOpen(true)',
      '<SettlesInRow',
      '<TripRatesCard',
    ]) {
      expect(sheet).not.toContain(piece);
    }
    expect(SCREEN).toMatch(/const closeEdit[\s\S]*commitName\(\);[\s\S]*commitDescription\(\);/);
  });
});

describe('group details on the page itself', () => {
  const details = between(SCREEN, 'One card: the group', 'The "Add someone" sheet');

  it('shows kind, tag, currency, other currencies and dates on the settings page', () => {
    for (const piece of [
      'setTypeOpen(true)',
      'setTagOpen(true)',
      't.fx.otherCurrencies',
      '<OtherCurrenciesSheetBody',
      '<MissingRatesCard',
      '<DatesSheetBody',
    ]) {
      expect(details).toContain(piece);
    }
  });

  it('keeps the permission checks', () => {
    expect(details).toContain('canEdit={isAdmin}');
    expect(details).toContain('isAdmin={isAdmin}');
    expect(details).toContain('currencyLocked={!canChangeCurrency}');
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

  it('commits name, description and tag when the edit sheet closes', () => {
    const pending = between(SCREEN, 'const commitPending', 'const closeEdit');
    for (const call of ['commitName()', 'commitDescription()', 'commitTag(tag)']) {
      expect(pending).toContain(call);
    }
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
