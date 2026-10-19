import { it, expect, vi } from 'vitest';
import { STRINGS_BY_LANGUAGE } from '../src/i18n';
// No inline strings are identical by nature: every key must be translated.
const identicalByNature: string[] = [];
const en = STRINGS_BY_LANGUAGE.en.inline;
const placeholders = (s: string) => [...s.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort();
it.each(['en', 'hi', 'ta', 'ar'] as const)(
  'IN-S-01 %s has every inline key as a nonempty string',
  (language) => {
    const strings = STRINGS_BY_LANGUAGE[language].inline;
    expect(Object.keys(strings).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(typeof strings[key], key).toBe('string');
      expect(strings[key].trim(), key).not.toBe('');
    }
  },
);
it.each(['hi', 'ta', 'ar'] as const)(
  'IN-S-02 %s translates all keys and preserves placeholders',
  (language) => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      const value = STRINGS_BY_LANGUAGE[language].inline[key];
      if (!identicalByNature.includes(key)) expect(value, key).not.toBe(en[key]);
      expect(placeholders(value), key).toEqual(placeholders(en[key]));
    }
  },
);
it('IN-S-03 every Arabic inline string contains Arabic script', () => {
  for (const [key, value] of Object.entries(STRINGS_BY_LANGUAGE.ar.inline))
    expect(value, key).toMatch(/[\u0600-\u06ff]/);
});

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-localization', () => ({ getLocales: () => [] }));
