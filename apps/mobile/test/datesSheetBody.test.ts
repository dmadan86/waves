/**
 * The Dates sheet follows the owner's mockup: a draft selection that only
 * Save commits, mirrored arrows, theme tokens, and strings in all four
 * languages. Source is pinned rather than mounting the native component.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const { STRINGS_BY_LANGUAGE } = await import('../src/i18n');

const BODY = readFileSync(join(process.cwd(), 'src/components/DatesSheetBody.tsx'), 'utf8');
const SCREEN = readFileSync(join(process.cwd(), 'src/app/group/[id]/settings.tsx'), 'utf8');

describe('DatesSheetBody', () => {
  it('holds a draft and commits only on Save, through the existing patch helper', () => {
    expect(BODY).toContain('tripDateRangePatch(start, end ?? start, group.time_zone)');
    expect(BODY).toContain('onSave({ start_date: null, end_date: null })');
    // Calendar taps never call onSave.
    const pick = BODY.slice(BODY.indexOf('const pick'), BODY.indexOf('const clear'));
    expect(pick).not.toContain('onSave');
  });

  it('is mounted only while open so closing discards the draft', () => {
    expect(SCREEN).toMatch(/\{datesOpen \? \(\s*<DatesSheetBody/);
  });

  it('mirrors arrows and chevrons and uses theme tokens only', () => {
    expect(BODY).toContain("directionalIcon('arrow-forward')");
    expect(BODY).toContain('directionalIcon(icon)');
    expect(BODY).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('has its strings in every language', () => {
    for (const lang of ['en', 'ta', 'hi', 'ar'] as const) {
      const p = STRINGS_BY_LANGUAGE[lang].pickers;
      for (const k of [
        'datesSheetSubtitle',
        'startDate',
        'endDate',
        'daysSelected',
        'noDatesSelected',
        'saveDates',
        'clearDates',
      ] as const) {
        expect(p[k], `${lang}.${k}`).toBeTruthy();
      }
    }
  });
});
