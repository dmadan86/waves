import { describe, expect, it } from 'vitest';
import { Language, LANGUAGES, STRINGS_BY_LANGUAGE } from '../src/i18n';
describe('pot translations', () => {
  it('provides every key and interpolation in every locale', () => {
    const english = STRINGS_BY_LANGUAGE[Language.En].pots;
    for (const language of LANGUAGES) {
      const translated = STRINGS_BY_LANGUAGE[language].pots;
      expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
      for (const key of Object.keys(english) as (keyof typeof english)[]) {
        expect(translated[key].trim()).not.toBe('');
        expect(translated[key].match(/\{\w+\}/g)?.sort() ?? []).toEqual(
          english[key].match(/\{\w+\}/g)?.sort() ?? [],
        );
        expect(translated[key]).not.toMatch(/verified/i);
      }
    }
  });
});
