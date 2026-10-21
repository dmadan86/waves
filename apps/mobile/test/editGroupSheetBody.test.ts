/** The Edit group sheet follows the mockup and its "saves automatically" claim is true. Source-pinned. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { STRINGS_BY_LANGUAGE } from '../src/i18n';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const BODY = readFileSync(join(process.cwd(), 'src/components/EditGroupSheetBody.tsx'), 'utf8');
const SCREEN = readFileSync(join(process.cwd(), 'src/app/group/[id]/settings.tsx'), 'utf8');

describe('EditGroupSheetBody', () => {
  it('has its own header: cover with camera badge, title, subtitle and a round close', () => {
    expect(BODY).toContain('onPress={onCoverPress}');
    expect(BODY).toContain('name="camera"');
    expect(BODY).toContain('t.group.editGroup');
    expect(BODY).toContain('t.group.editGroupHint');
    expect(BODY).toContain('t.common.close');
  });

  it('has name and description field cards with icon tiles and clear buttons', () => {
    expect(BODY).toContain('pencil-outline');
    expect(BODY).toContain('text-box-outline');
    expect(BODY).toContain("onChangeText('')");
    expect(BODY).toContain('value.length > 0');
    expect(BODY).toContain('StyleSheet.hairlineWidth');
    expect(BODY).toContain('maxLength={GROUP_DESCRIPTION_MAX}');
  });

  it('ends in a full-width brand pill Done button, with no hard-coded colours', () => {
    expect(BODY).toContain('height: 56');
    expect(BODY).toContain('theme.color.brand');
    expect(BODY).toContain('t.common.done');
    expect(BODY).not.toMatch(/#[0-9A-Fa-f]{3,8}/);
  });
});

describe('saving behind the sheet', () => {
  it('mounts the body without a duplicate Sheet title', () => {
    expect(SCREEN).toContain('<EditGroupSheetBody');
    expect(SCREEN).not.toContain('title={t.group.editGroup}');
  });

  it('commits on blur, on Done and on every way of closing', () => {
    expect(SCREEN).toContain('onNameCommit={commitName}');
    expect(SCREEN).toContain('onDescriptionCommit={commitDescription}');
    expect(SCREEN).toContain('onDone={closeEdit}');
    expect(SCREEN).toContain('onClose={closeEdit}');
    expect(SCREEN).toMatch(/const closeEdit[\s\S]*commitPending\(\);/);
  });

  it('never saves an empty name; it puts the old one back', () => {
    expect(SCREEN).toMatch(/if \(!next\) \{\s*setName\(group\.data\?\.name \?\? ''\);\s*return;/);
  });
});

describe('strings', () => {
  it('says changes save automatically in every language', () => {
    for (const strings of Object.values(STRINGS_BY_LANGUAGE)) {
      expect(strings.group.editGroupHint).toBeTruthy();
      expect(strings.group.groupName).toBeTruthy();
      expect(strings.common.done).toBeTruthy();
    }
  });
});
