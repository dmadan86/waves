/**
 * The assistant's own copy, in every language the app ships: nothing missing,
 * placeholders intact, and real translations rather than English left behind.
 */

import { describe, expect, it, vi } from 'vitest';

import { STRINGS_BY_LANGUAGE } from '../src/i18n';

vi.mock('react-native', () => ({}));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const en = STRINGS_BY_LANGUAGE.en.assistant;
const KEYS = Object.keys(en) as (keyof typeof en)[];
// Strings that are the same in every language on purpose.
const SAME_EVERYWHERE = new Set<string>(['planRowPill']);
const placeholders = (text: string): string[] => (text.match(/\{\w+\}/g) ?? []).sort();

describe('assistant strings', () => {
  it('has the keys the screens use', () => {
    for (const key of [
      'introBody',
      'introAction',
      'teaserLine',
      'composerPlaceholder',
      'proSheetTitle',
      'completeRow',
      'tryWhoOwes',
    ] as const)
      expect(KEYS).toContain(key);
  });

  for (const language of ['en', 'hi', 'ta', 'ar'] as const) {
    describe(language, () => {
      const strings = STRINGS_BY_LANGUAGE[language].assistant;

      it('defines every key with text', () => {
        for (const key of KEYS) {
          expect(typeof strings[key], key).toBe('string');
          expect(strings[key].trim().length, key).toBeGreaterThan(0);
        }
        expect(Object.keys(strings).sort()).toEqual([...KEYS].sort());
      });

      it('keeps the same placeholders as English', () => {
        for (const key of KEYS)
          expect(placeholders(strings[key]), key).toEqual(placeholders(en[key]));
      });

      if (language !== 'en') {
        it('is translated, not English', () => {
          for (const key of KEYS) {
            if (SAME_EVERYWHERE.has(key)) continue;
            expect(strings[key], key).not.toBe(en[key]);
          }
        });

        it('is written in the language’s own script', () => {
          const script = { hi: /[ऀ-ॿ]/, ta: /[஀-௿]/, ar: /[؀-ۿ]/ }[language];
          for (const key of KEYS) {
            if (SAME_EVERYWHERE.has(key)) continue;
            expect(strings[key], key).toMatch(script);
          }
        });
      }
    });
  }

  it('composer placeholder shows an example in every language', () => {
    for (const language of ['en', 'hi', 'ta', 'ar'] as const)
      expect(STRINGS_BY_LANGUAGE[language].assistant.composerPlaceholder).toMatch(/800|٨٠٠/);
  });
});
