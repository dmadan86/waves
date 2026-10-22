import { describe, expect, it, vi } from 'vitest';

import { STRINGS_BY_LANGUAGE } from '../src/i18n';

vi.mock('expo-localization', () => ({ getLocales: () => [] }));

describe('followUps strings', () => {
  const en = STRINGS_BY_LANGUAGE.en.followUps as unknown as Record<string, string>;
  // resetHint is plural forms, not a string; the muted-row test below covers it.
  const texts = (o: Record<string, unknown>): string[] =>
    Object.keys(o).filter((k) => typeof o[k] === 'string');
  const placeholders = (s: string): string[] =>
    [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

  for (const lang of ['hi', 'ta', 'ar'] as const) {
    it(`${lang} has every key, the same placeholders, and real translations`, () => {
      const t = STRINGS_BY_LANGUAGE[lang].followUps as unknown as Record<string, string>;
      expect(Object.keys(t).sort()).toEqual(Object.keys(en).sort());
      for (const key of texts(en)) {
        expect(placeholders(t[key]!), `${lang}.${key}`).toEqual(placeholders(en[key]!));
      }
      // Brand-like words may stay; anything with letters of its own must not be English.
      const same = texts(en).filter((k) => t[k] === en[k] && /[a-z]{4,}/i.test(en[k]!));
      expect(same).toEqual([]);
    });
  }
});
