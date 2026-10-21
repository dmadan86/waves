/**
 * The create-group screen wears the group settings screen's clothes and uses
 * its very components, and nothing the old screen could do was lost. The source
 * is pinned rather than mounting the native screen.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');
const SCREEN = read('src/app/new-group.tsx');
const SETTINGS = read('src/app/group/[id]/settings.tsx');
const COVER = read('src/components/CoverEmojiPicker.tsx');
const FIELDS = read('src/components/EditGroupSheetBody.tsx');

describe('new group looks like group settings', () => {
  it('opens with the plain header and the New group title', () => {
    expect(SCREEN).toContain('<PlainHeader');
    expect(SCREEN).toContain('t.homeDash.newGroup');
    expect(SCREEN).not.toContain('NewGroupHeader');
    expect(SCREEN).not.toContain('HeroScene');
  });

  it('has one card: a 72 cover with a camera badge, the field cards, then circular-tile rows', () => {
    expect(SCREEN).toContain('<StandardCard style={{ paddingVertical');
    expect(SCREEN).toContain('size={72}');
    expect(SCREEN).toContain('name="camera"');
    expect(SCREEN).toContain('setIconOpen(true)');
    expect(SCREEN.match(/<GroupFieldCard/g)).toHaveLength(2);
    expect(FIELDS).toContain('export function GroupFieldCard');
    // The same card styling the settings edit sheet uses, in the same file.
    expect(FIELDS).toContain('StyleSheet.hairlineWidth');
    expect(FIELDS).toContain('theme.color.brandSoft');
    expect(SCREEN).toContain('<RowTile');
    expect(SCREEN).toContain('<PlainListRow');
    expect(SCREEN).not.toContain('FormCard');
  });

  it('opens the cover picker settings uses, icon-only because a photo needs a saved group', () => {
    expect(SCREEN).toContain('<GroupCoverSheet');
    expect(SCREEN).toContain('iconOnly');
    expect(COVER).toContain('iconOnly');
    expect(SETTINGS).toContain('<GroupCoverSheet');
  });

  it('has group type as a pill row with no chevron, opening the six-kind sheet', () => {
    const row = SCREEN.slice(
      SCREEN.indexOf('t.extras.groupTypeTitle}\n              trailing'),
      SCREEN.indexOf('setTypeOpen(true)'),
    );
    expect(row).toContain('currentType.label');
    expect(row).not.toContain('chevron');
    expect(SCREEN).toContain('GroupType.Friends');
    expect(SCREEN).toContain('typeOptions.map');
    expect(SCREEN).toContain('setPickedType(option.value)');
  });

  it('shows Dates for trips and events only, through DatesSheetBody', () => {
    expect(SCREEN).toContain('type === GroupType.Trip || type === GroupType.Event');
    expect(SCREEN).toContain('{hasDates ? (');
    expect(SCREEN).toContain('<DatesSheetBody');
    expect(SCREEN).toContain('setTripDates((current) => ({ ...current, ...patch }))');
  });

  it('opens Other currencies with an editable group currency and convert on', () => {
    expect(SCREEN).toContain('<OtherCurrenciesSheetBody');
    expect(SCREEN).toContain('currencyLocked={false}');
    expect(SCREEN).toContain('convertOn');
    expect(SCREEN).toContain('t.fx.otherCurrencies');
    expect(SCREEN).toContain('setPickedCurrency(next)');
    // Rates are quoted against the old currency, so a new one starts clean.
    expect(SCREEN).toContain('setPendingRates([])');
    expect(SCREEN).toContain('const currency = pickedCurrency ?? defaultCurrency');
  });

  it('has the Tag row opening TagSheetBody', () => {
    expect(SCREEN).toContain('<TagSheetBody');
    expect(SCREEN).toContain('t.extras.tagLabel');
    expect(SCREEN).not.toContain('<GroupTagField');
  });

  it('keeps the members section with the Add members pill', () => {
    expect(SCREEN).toContain('<SectionHeader');
    expect(SCREEN).toContain('t.group.membersTitle');
    expect(SCREEN).toContain('t.group.addMembers');
    expect(SCREEN).toContain('openContactPicker');
    expect(SCREEN).toContain('addTypedGhost');
    expect(SCREEN).toContain('MutationKind.MemberAddGhost');
  });

  it('ends in a full-width brand Create group button, 56 high, not black', () => {
    const button = SCREEN.slice(SCREEN.indexOf('accessibilityLabel={t.misc.createGroup}'));
    expect(button).toContain('height: 56');
    expect(button).toContain('theme.radius.pill');
    expect(button).toContain('backgroundColor: theme.color.brand');
    expect(button).toContain('void submit()');
    expect(SCREEN).not.toContain('<Gradient');
    expect(SCREEN).not.toContain('#000');
  });

  it('keeps every capability the old screen had', () => {
    for (const kept of [
      'MutationKind.GroupUpdate',
      'MutationKind.GroupBudgetSet',
      'MutationKind.GroupFxRateSet',
      'guard.blockAddGroup()',
      'assignCaptureHref',
      '/clone-group',
      'seeded.current',
      'event_template',
      'custom_tag',
      'cover_color',
      'normaliseGroupDescription',
      'effectiveSimplify',
      'isPhoneCountryError',
    ]) {
      expect(SCREEN, kept).toContain(kept);
    }
    // Event template, budget and simplify moved to rows of the same card.
    expect(SCREEN).toContain('<EventTemplateSheetBody');
    expect(SCREEN).toContain('t.extras.tripBudget');
    expect(SCREEN).toContain('t.group.simplifyDebts');
  });

  it('uses no spacing or colour of its own outside the theme tokens', () => {
    expect(SCREEN).not.toContain('SPEC_ACCENT');
    expect(SCREEN).not.toContain('#3D63E8');
    expect(SCREEN).toContain('paddingHorizontal: theme.spacing.lg, gap: theme.spacing.lg');
    expect(SETTINGS).toContain('paddingHorizontal: theme.spacing.lg, gap: theme.spacing.lg');
  });
});
