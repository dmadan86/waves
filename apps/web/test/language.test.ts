/**
 * Which language the server renders in.
 *
 * This decides `<html lang>` and `dir` before the first byte reaches the
 * browser, so getting it wrong is not a late correction — it is an Arabic page
 * laid out left to right, or somebody's chosen language quietly ignored on
 * every reload. The cookie is client-supplied text, so the interesting cases
 * are the ones where it is nonsense.
 */

import { describe, expect, it } from 'vitest';

import { Language } from '../src/i18n';
import {
  LANGUAGE_COOKIE,
  chooseLanguage,
  isLanguage,
  rememberedLanguage,
} from '../src/lib/language';

describe('chooseLanguage', () => {
  it('prefers what somebody chose over what the browser asked for', () => {
    expect(chooseLanguage('ta', 'en-GB,en;q=0.9')).toBe(Language.Ta);
  });

  it('falls back to the browser when nothing was chosen', () => {
    expect(chooseLanguage(null, 'hi-IN,hi;q=0.9,en;q=0.8')).toBe(Language.Hi);
    expect(chooseLanguage(undefined, 'ar')).toBe(Language.Ar);
  });

  it('ignores a cookie carrying a language this app does not speak', () => {
    // Client-supplied text. The alternative to ignoring it is rendering the
    // page in nothing at all.
    for (const bad of ['fr', 'en-US', '', 'null', '<script>', 'ta ']) {
      expect(chooseLanguage(bad, 'hi')).toBe(Language.Hi);
    }
  });

  it('ends at English when neither the cookie nor the browser offers one', () => {
    expect(chooseLanguage(null, 'fr-FR,de;q=0.8')).toBe(Language.En);
    expect(chooseLanguage(null, null)).toBe(Language.En);
  });
});

describe('rememberedLanguage', () => {
  it('finds the cookie among others', () => {
    expect(rememberedLanguage(`theme=dark; ${LANGUAGE_COOKIE}=ar; sb-access-token=xyz`)).toBe(
      Language.Ar,
    );
  });

  it('is not fooled by a cookie whose name merely ends the same way', () => {
    expect(rememberedLanguage(`not-${LANGUAGE_COOKIE}=ta`)).toBeNull();
  });

  it('answers null for no cookie header, and for a value it does not speak', () => {
    expect(rememberedLanguage('')).toBeNull();
    expect(rememberedLanguage(`${LANGUAGE_COOKIE}=fr`)).toBeNull();
  });
});

describe('isLanguage', () => {
  it('accepts exactly the four', () => {
    expect(['en', 'ta', 'hi', 'ar'].every(isLanguage)).toBe(true);
    expect(['EN', 'en-GB', 'fr', '', null, undefined].some(isLanguage)).toBe(false);
  });
});
