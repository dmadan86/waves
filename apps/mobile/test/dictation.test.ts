/**
 * Dictation, minus the microphone.
 *
 * The three things that can be wrong without anybody noticing on the device
 * they happen to be holding: recognising the wrong language, eating what was
 * already typed, and turning a platform error code into a blank screen.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  dictationError,
  englishSpeechLocale,
  mergeTranscript,
  offlineVoiceModels,
  onDeviceLocaleInstalled,
  speechLocale,
} from '@/lib/dictation';
import { Language, STRINGS_BY_LANGUAGE } from '@/i18n';

// The Language enum lives in the i18n module, which imports expo-localization
// (and through it react-native) at load. This test only needs the enum, so the
// native dependency is stubbed out — the same shim language.test.ts uses.
vi.mock('expo-localization', () => ({ getLocales: () => [] }));

describe('speechLocale', () => {
  it('keeps the phone’s own region when it agrees with the app language', () => {
    // Somebody in London is recognised as British English, not corrected to
    // Indian English because the app happens to be India-first.
    expect(speechLocale(Language.En, 'en-GB')).toBe('en-GB');
    expect(speechLocale(Language.Ta, 'ta-LK')).toBe('ta-LK');
  });

  it('falls back to India when the tag carries no region', () => {
    // Bare "ta" is a lottery on Android — some recognisers take it, some
    // return language-not-supported.
    expect(speechLocale(Language.Ta, 'ta')).toBe('ta-IN');
    expect(speechLocale(Language.Hi, 'hi')).toBe('hi-IN');
  });

  it('follows the app language, not the phone, when they disagree', () => {
    // The app is showing Tamil, so Tamil is what the user is about to speak.
    expect(speechLocale(Language.Ta, 'en-US')).toBe('ta-IN');
  });

  it('survives the shapes a locale tag actually arrives in', () => {
    expect(speechLocale(Language.En, 'en_IN')).toBe('en-IN');
    expect(speechLocale(Language.En, 'en-in')).toBe('en-IN');
    expect(speechLocale(Language.En, '')).toBe('en-IN');
  });
});

describe('englishSpeechLocale', () => {
  it('keeps the device region regardless of the UI language', () => {
    // The capture flow always recognises English, so an Arabic-UI phone in the
    // UAE should hear en-AE — not be forced to Indian English the way the
    // language-matching speechLocale would.
    expect(englishSpeechLocale('ar-AE')).toBe('en-AE');
    expect(englishSpeechLocale('ta-LK')).toBe('en-LK');
    expect(englishSpeechLocale('en-GB')).toBe('en-GB');
  });

  it('falls back to India only when there is no region', () => {
    expect(englishSpeechLocale('ar')).toBe('en-IN');
    expect(englishSpeechLocale('en')).toBe('en-IN');
    expect(englishSpeechLocale('')).toBe('en-IN');
  });

  it('survives the shapes a locale tag actually arrives in', () => {
    expect(englishSpeechLocale('ar_AE')).toBe('en-AE');
    expect(englishSpeechLocale('en-in')).toBe('en-IN');
    // A script subtag is skipped; the real region still wins.
    expect(englishSpeechLocale('zh-Hans-CN')).toBe('en-CN');
  });
});

describe('mergeTranscript', () => {
  it('adds to what was already typed', () => {
    expect(mergeTranscript('Dinner', 'at the beach shack')).toBe('Dinner at the beach shack');
  });

  it('does not double the space at the join', () => {
    expect(mergeTranscript('Dinner ', 'at the shack')).toBe('Dinner at the shack');
    expect(mergeTranscript('Dinner', '  at the shack ')).toBe('Dinner at the shack');
  });

  it('is the transcript alone when the field was empty', () => {
    expect(mergeTranscript('', 'Auto to the airport')).toBe('Auto to the airport');
  });

  it('leaves the field alone when nothing was heard', () => {
    expect(mergeTranscript('Dinner', '')).toBe('Dinner');
    expect(mergeTranscript('Dinner', '   ')).toBe('Dinner');
  });

  it('is stable across interim results, which arrive in full each time', () => {
    // This is the property that matters: interim results are re-issued whole,
    // so merging must be recomputed from the same starting text rather than
    // appended, or the note reads "Dinner dinner at dinner at the".
    const before = 'Dinner';
    const interim = ['at', 'at the', 'at the beach shack'];
    const rendered = interim.map((text) => mergeTranscript(before, text));
    expect(rendered.at(-1)).toBe('Dinner at the beach shack');
    expect(new Set(rendered).size).toBe(interim.length);
  });
});

describe('dictationError', () => {
  // The messages are now in the catalogue and threaded in from the caller, so
  // this passes the English table the same way the mic screen passes the
  // reader's own language.
  const messages = STRINGS_BY_LANGUAGE.en.misc.dictationErrors;

  it('says what to do about a refused microphone', () => {
    expect(dictationError('not-allowed', messages)).toMatch(/Settings/);
    expect(dictationError('service-not-allowed', messages)).toMatch(/Settings/);
  });

  it('stays quiet when the user stopped it themselves', () => {
    // Stopping emits `aborted`. Telling somebody their own tap was an error is
    // how an app teaches people to ignore its messages.
    expect(dictationError('aborted', messages)).toBe('');
  });

  it('still says something useful for a code it has never seen', () => {
    expect(dictationError('some-future-code', messages)).not.toBe('');
  });

  it('never leaves somebody without a way forward', () => {
    const codes = ['no-speech', 'audio-capture', 'network', 'language-not-supported', 'client'];
    for (const code of codes) {
      expect(dictationError(code, messages)).toMatch(/try again|Type the note|speak again/i);
    }
  });
});

describe('onDeviceLocaleInstalled', () => {
  it('does not let one region stand in for another', () => {
    // The bug this guards: asking for the en-IN on-device model on a phone that
    // only has en-US returns silence. Two regioned tags must match in full.
    expect(onDeviceLocaleInstalled('en-IN', ['en-US'])).toBe(false);
    expect(onDeviceLocaleInstalled('en-IN', ['en-US', 'en-GB'])).toBe(false);
    expect(onDeviceLocaleInstalled('en-IN', ['en-IN'])).toBe(true);
  });

  it('treats a language-only installed entry as the whole language', () => {
    // Android commonly lists an installed model as just `en` — the generic
    // model, which does cover any English region.
    expect(onDeviceLocaleInstalled('en-IN', ['en'])).toBe(true);
    expect(onDeviceLocaleInstalled('ta-IN', ['ta'])).toBe(true);
  });

  it('covers a language-only request with any installed region of it', () => {
    expect(onDeviceLocaleInstalled('en', ['en-US'])).toBe(true);
    expect(onDeviceLocaleInstalled('en', ['fr-FR'])).toBe(false);
  });

  it('normalises separators and case, and handles an empty probe', () => {
    expect(onDeviceLocaleInstalled('en_IN', ['EN-in'])).toBe(true);
    expect(onDeviceLocaleInstalled('en-IN', [])).toBe(false);
    expect(onDeviceLocaleInstalled('en-IN', null)).toBe(false);
    expect(onDeviceLocaleInstalled('', ['en'])).toBe(false);
  });
});

describe('offlineVoiceModels', () => {
  const languages = [Language.En, Language.Ta, Language.Hi, Language.Ar];

  it('lists every app language whether or not its model is there', () => {
    // The rows somebody came to this screen to fix are the missing ones, so
    // they cannot be filtered out for being missing.
    const models = offlineVoiceModels(languages, 'en-IN', [], [], 'reported');
    expect(models.app.map((model) => model.tag)).toEqual(['en-IN', 'ta-IN', 'hi-IN', 'ar-IN']);
    expect(models.app.every((model) => model.state === 'missing')).toBe(true);
  });

  it('reads an app row’s installed state the way the mic does', () => {
    // A bare `en` really is the generic model and covers en-IN; en-US really is
    // a different model and does not. The screen must give the same answer the
    // recogniser will, or it promises a model that then returns silence.
    const generic = offlineVoiceModels(languages, 'en-IN', [], ['en'], 'reported');
    expect(generic.app[0]?.state).toBe('installed');
    const wrongRegion = offlineVoiceModels(languages, 'en-IN', [], ['en-US'], 'reported');
    expect(wrongRegion.app[0]?.state).toBe('missing');
  });

  it('splits everything else by whether the phone already holds it', () => {
    const models = offlineVoiceModels(
      languages,
      'en-IN',
      ['fr-FR', 'de-DE', 'bn-IN'],
      ['de-DE', 'en-US'],
      'reported',
    );
    // en-US is installed but no app row claims it, so it belongs with the extras
    // rather than quietly satisfying the en-IN row above.
    expect(models.alsoInstalled.map((model) => model.tag)).toEqual(['de-DE', 'en-US']);
    expect(models.downloadable.map((model) => model.tag)).toEqual(['bn-IN', 'fr-FR']);
  });

  it('never lists the same model twice', () => {
    // The phone repeats tags across its two lists, and an app tag must not
    // reappear below as something still to download.
    const models = offlineVoiceModels(
      languages,
      'en-IN',
      ['en-IN', 'ta-IN', 'FR_fr'],
      ['fr-FR'],
      'reported',
    );
    expect(models.alsoInstalled.map((model) => model.tag)).toEqual(['fr-FR']);
    expect(models.downloadable).toEqual([]);
  });

  it('does not list a bare tag that an app row already covers', () => {
    // Android's usual way of saying it holds generic English is the bare `en`,
    // which is not the `en-IN` the app row names but is the very same model.
    // Listing both would put one model on the screen twice — once ticked at the
    // top and once again under "also on this phone".
    const models = offlineVoiceModels(languages, 'en-IN', ['en', 'fr-FR'], ['en'], 'reported');
    expect(models.app[0]?.state).toBe('installed');
    expect(models.alsoInstalled).toEqual([]);
    expect(models.downloadable.map((model) => model.tag)).toEqual(['fr-FR']);
  });

  it('claims nothing about a phone that cannot be asked what it holds', () => {
    // iOS returns its supported list under `installedLocales` too, so believing
    // it would tick every locale the phone can recognise at all — the silence
    // bug arriving through the UI. Nothing below the app rows is trustworthy
    // either, since the split between "here" and "on offer" comes from the same
    // answer.
    const models = offlineVoiceModels(
      languages,
      'en-IN',
      ['en-IN', 'fr-FR'],
      ['en-IN', 'fr-FR'],
      'unknowable',
    );
    expect(models.app.map((model) => model.tag)).toEqual(['en-IN', 'ta-IN', 'hi-IN', 'ar-IN']);
    expect(models.app.every((model) => model.state === 'unknown')).toBe(true);
    expect(models.alsoInstalled).toEqual([]);
    expect(models.downloadable).toEqual([]);
  });

  it('survives a phone that answers with nothing at all', () => {
    // Android 12 and below name no locales; the app rows must still draw.
    const models = offlineVoiceModels(languages, 'en-IN', null, null, 'reported');
    expect(models.app).toHaveLength(4);
    expect(models.alsoInstalled).toEqual([]);
    expect(models.downloadable).toEqual([]);
  });
});
