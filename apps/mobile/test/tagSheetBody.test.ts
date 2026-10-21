/** The Tag sheet follows the mockup: a draft, popular chips, and a Save button. Source-pinned. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { STRINGS_BY_LANGUAGE } from '../src/i18n';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const BODY = readFileSync(join(process.cwd(), 'src/components/TagSheetBody.tsx'), 'utf8');
const SCREEN = readFileSync(join(process.cwd(), 'src/app/group/[id]/settings.tsx'), 'utf8');

describe('TagSheetBody', () => {
  it('holds a draft, respects the max length and commits only on Save', () => {
    expect(BODY).toContain('useState(value)');
    expect(BODY).toContain('maxLength={GROUP_TAG_MAX}');
    expect(BODY).toContain('onSave(draft.trim())');
  });

  it('has the nine popular chips, with Other clearing and focusing the input', () => {
    for (const key of [
      'weekend',
      'roadTrip',
      'holiday',
      'officeOffsite',
      'birthday',
      'wedding',
      'family',
      'friends',
      'other',
    ]) {
      expect(BODY).toContain(`key: '${key}'`);
    }
    expect(BODY).toContain("setDraft('')");
    expect(BODY).toContain('input.current?.focus()');
    expect(BODY).toContain('borderWidth: 1.5');
  });

  it('is mounted by the settings Tag sheet, which commits through commitTag', () => {
    expect(SCREEN).toContain('<TagSheetBody');
    expect(SCREEN).toContain('commitTag(next)');
  });

  it('has the strings in every language', () => {
    for (const strings of Object.values(STRINGS_BY_LANGUAGE)) {
      expect(strings.extras.tagSheetSubtitle).toBeTruthy();
      expect(strings.extras.tagPopular).toBeTruthy();
      expect(strings.extras.saveTag).toBeTruthy();
      expect(Object.values(strings.extras.tagChips)).toHaveLength(9);
    }
  });
});
