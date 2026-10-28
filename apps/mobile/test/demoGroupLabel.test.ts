import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en', languageTag: 'en-IN' }],
}));

const { groupLabel } = await import('../src/data/types');
const { Language, STRINGS_BY_LANGUAGE, setActiveLanguage } = await import('../src/i18n');

describe('groupLabel for the demo group', () => {
  it('shows "Demo group" whatever the stored name', () => {
    setActiveLanguage(Language.En);
    expect(groupLabel({ name: 'Goa trip', isDemo: true })).toBe('Demo group');
    expect(groupLabel({ name: null, isDemo: true })).toBe('Demo group');
  });

  it('localizes the label', () => {
    setActiveLanguage(Language.Hi);
    expect(groupLabel({ name: null, isDemo: true })).toBe(
      STRINGS_BY_LANGUAGE[Language.Hi].demo.groupName,
    );
    setActiveLanguage(Language.En);
  });

  it('leaves real groups alone', () => {
    expect(groupLabel({ name: 'Flat', isDemo: false })).toBe('Flat');
    expect(groupLabel({ name: 'Flat' })).toBe('Flat');
  });

  it('has a name and subtitle in every language', () => {
    for (const s of Object.values(STRINGS_BY_LANGUAGE)) {
      expect(s.demo.groupName.trim()).not.toBe('');
      expect(s.demo.rowSubtitle.trim()).not.toBe('');
    }
  });
});
