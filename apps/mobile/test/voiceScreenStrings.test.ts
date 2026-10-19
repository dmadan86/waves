import { describe, expect, it, vi } from 'vitest';
import { STRINGS_BY_LANGUAGE } from '../src/i18n';

vi.mock('react-native', () => ({}));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const en = STRINGS_BY_LANGUAGE.en.voiceScreen;
const keys = Object.keys(en) as (keyof typeof en)[];
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe('voice screen strings', () => {
  it('includes the capture, transcript, preview and recovery labels', () => {
    expect(keys).toEqual(
      expect.arrayContaining([
        'hearing',
        'youSaid',
        'editHeard',
        'suggestionsTitle',
        'category',
        'splitWith',
        'splitType',
        'permissionBody',
        'openSettings',
        'retry',
        'typeInstead',
      ]),
    );
  });
  for (const language of ['en', 'hi', 'ta', 'ar'] as const) {
    describe(language, () => {
      const strings = STRINGS_BY_LANGUAGE[language].voiceScreen;
      it('defines every English key with nonempty text', () => {
        expect(Object.keys(strings).sort()).toEqual([...keys].sort());
        for (const key of keys) {
          expect(typeof strings[key], key).toBe('string');
          expect(strings[key].trim().length, key).toBeGreaterThan(0);
        }
      });
      it('preserves placeholders', () => {
        for (const key of keys)
          expect(placeholders(strings[key]), key).toEqual(placeholders(en[key]));
      });
      it('uses the language’s own script and translates English', () => {
        const script = {
          en: /[A-Za-z]/,
          hi: /[\u0900-\u097f]/,
          ta: /[\u0b80-\u0bff]/,
          ar: /[\u0600-\u06ff]/,
        }[language];
        for (const key of keys) {
          expect(strings[key], key).toMatch(script);
          if (language !== 'en') expect(strings[key], key).not.toBe(en[key]);
        }
      });
    });
  }
});
