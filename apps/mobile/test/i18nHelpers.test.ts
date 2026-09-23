/**
 * The i18n helpers that are not string tables: plural forms, template filling,
 * and the device-derived answers — language, locale, country, currency, the
 * dialing prefix, UPI and direction — that every screen quietly depends on.
 *
 * `language.test.ts` covers the language list and `localeFor`; `rtl.test.ts`
 * covers mirroring. What is pinned here is each fallback, because each one is
 * a sentence about what the app assumes when the phone will not say: a country
 * is never guessed from a language, an unknown region is not the US, and a
 * locale Intl refuses still gets a number rather than a blank.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  activeStrings,
  deviceCountry,
  deviceDefaultCurrency,
  deviceDialingCode,
  deviceLanguage,
  deviceLocale,
  deviceSupportsUpi,
  fill,
  isRtl,
  Language,
  LanguageContext,
  plural,
  setActiveLanguage,
  STRINGS_BY_LANGUAGE,
  useStrings,
} from '@/i18n';

import { provide, renderHook, resetContexts } from './mocks/fakeReact';

vi.mock('react', () => import('./mocks/fakeReact'));

interface FakeLocale {
  languageCode?: string | null;
  regionCode?: string | null;
  languageRegionCode?: string | null;
  languageTag?: string | null;
}
const h = vi.hoisted(() => ({ locales: [] as FakeLocale[] }));
vi.mock('expo-localization', () => ({ getLocales: () => h.locales }));

beforeEach(() => {
  h.locales = [{ languageCode: 'en', regionCode: 'IN', languageTag: 'en-IN' }];
});

afterEach(() => {
  resetContexts();
  vi.restoreAllMocks();
});

describe('plural', () => {
  const forms = {
    zero: 'z {n}',
    one: 'one {n}',
    two: 'two {n}',
    few: 'few {n}',
    many: 'many {n}',
    other: 'other {n}',
  };

  it('follows Arabic through all six categories', () => {
    expect(plural('ar', 0, forms)).toMatch(/^z /);
    expect(plural('ar-AE', 1, forms)).toMatch(/^one /);
    expect(plural('ar', 2, forms)).toMatch(/^two /);
    expect(plural('ar', 103, forms)).toMatch(/^few /);
    expect(plural('ar', 11, forms)).toMatch(/^many /);
    expect(plural('ar', 100, forms)).toMatch(/^other /);
  });

  it('gives Hindi `one` for zero too, and English and Tamil only for one', () => {
    expect(plural('hi-IN', 0, forms)).toMatch(/^one /);
    expect(plural('en-IN', 0, forms)).toBe('other 0');
    expect(plural('ta', 1, forms)).toBe('one 1');
  });

  it('asks Intl for a language Waves does not ship', () => {
    expect(plural('fr', 1, forms)).toBe('one 1');
    expect(plural('de-DE', 1000, forms)).toBe('other 1.000');
  });

  it('falls back to one/other when Intl refuses the locale', () => {
    expect(plural('!!', 1, forms)).toBe('one 1');
    expect(plural('!!', 3, forms)).toBe('other 3');
  });

  it('uses `other` when the form for the rule is missing', () => {
    expect(plural('ar', 2, { other: '{n} things' })).toMatch(/ things$/);
  });
});

describe('fill', () => {
  it('fills named slots and leaves unknown ones visible', () => {
    expect(fill('{name} owes {amount}', { name: 'Ravi', amount: 12 })).toBe('Ravi owes 12');
    expect(fill('{name} owes {amount}', { name: 'Ravi' })).toBe('Ravi owes {amount}');
  });
});

describe('the device language and locale', () => {
  it('maps the phone language onto one Waves speaks, English otherwise', () => {
    for (const [code, language] of [
      ['ta', Language.Ta],
      ['hi', Language.Hi],
      ['ar', Language.Ar],
      ['fr', Language.En],
    ] as const) {
      h.locales = [{ languageCode: code }];
      expect(deviceLanguage()).toBe(language);
    }
    h.locales = [];
    expect(deviceLanguage()).toBe(Language.En);
  });

  it('reads right to left only for Arabic', () => {
    h.locales = [{ languageCode: 'ar' }];
    expect(isRtl()).toBe(true);
    h.locales = [{ languageCode: 'hi' }];
    expect(isRtl()).toBe(false);
  });

  it('falls back to en-IN when the phone gives no locale tag', () => {
    expect(deviceLocale()).toBe('en-IN');
    h.locales = [];
    expect(deviceLocale()).toBe('en-IN');
    h.locales = [{ languageTag: 'ta-LK' }];
    expect(deviceLocale()).toBe('ta-LK');
  });

  it('serves the chosen language from outside React once one is set', () => {
    h.locales = [{ languageCode: 'hi' }];
    setActiveLanguage(Language.Ta);
    expect(activeStrings()).toBe(STRINGS_BY_LANGUAGE[Language.Ta]);
    setActiveLanguage(Language.En);
    expect(activeStrings()).toBe(STRINGS_BY_LANGUAGE[Language.En]);
  });
});

describe('the device country', () => {
  it('prefers the region setting, then the language region, then the tag', () => {
    h.locales = [{ regionCode: 'ae' }];
    expect(deviceCountry()).toBe('AE');
    h.locales = [{ regionCode: null, languageRegionCode: 'GB' }];
    expect(deviceCountry()).toBe('GB');
    h.locales = [{ regionCode: null, languageTag: 'hi-IN' }];
    expect(deviceCountry()).toBe('IN');
  });

  it('walks past a locale with no region to a later one', () => {
    h.locales = [{ languageTag: 'en' }, { languageTag: 'en-US' }];
    expect(deviceCountry()).toBe('US');
  });

  it('never reads a bare language, or junk, as a country', () => {
    h.locales = [{ languageTag: 'en' }, { regionCode: 'XYZ' }, {}];
    expect(deviceCountry()).toBeNull();
    h.locales = [];
    expect(deviceCountry()).toBeNull();
  });
});

describe('what the device country decides', () => {
  it('starts groups in the local currency, INR when unknown', () => {
    h.locales = [{ regionCode: 'AE' }];
    expect(deviceDefaultCurrency()).toBe('AED');
    h.locales = [];
    expect(deviceDefaultCurrency()).toBe('INR');
  });

  it('offers UPI in India and where the region is unknown, not elsewhere', () => {
    expect(deviceSupportsUpi()).toBe(true);
    h.locales = [];
    expect(deviceSupportsUpi()).toBe(true);
    h.locales = [{ regionCode: 'US' }];
    expect(deviceSupportsUpi()).toBe(false);
  });

  it('opens a phone field on the local dialing code, or a bare +', () => {
    expect(deviceDialingCode()).toBe('+91');
    h.locales = [{ regionCode: 'AE' }];
    expect(deviceDialingCode()).toBe('+971');
    h.locales = [];
    expect(deviceDialingCode()).toBe('+');
  });
});

describe('useStrings', () => {
  it('follows the phone before any provider has said otherwise', () => {
    h.locales = [{ languageCode: 'ta', languageTag: 'ta-IN' }];
    const { result } = renderHook(() => useStrings());
    expect(result.current.language).toBe(Language.Ta);
    expect(result.current.locale).toBe('ta-IN');
    expect(result.current.t).toBe(STRINGS_BY_LANGUAGE[Language.Ta]);
  });

  it('speaks the chosen language once a provider supplies one', () => {
    provide(LanguageContext, { language: Language.Ar, locale: 'ar-AE' });
    const { result } = renderHook(() => useStrings());
    expect(result.current).toEqual({
      t: STRINGS_BY_LANGUAGE[Language.Ar],
      locale: 'ar-AE',
      language: Language.Ar,
    });
  });
});
