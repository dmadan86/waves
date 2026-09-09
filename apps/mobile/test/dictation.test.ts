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
  offlineDownloadReason,
  offlineVoiceKnowledge,
  offlineVoiceModels,
  offlineVoiceRead,
  onDeviceLocaleInstalled,
  speechLocale,
  withConfirmedInstalls,
  type OfflineVoiceReadInput,
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

  it('falls back to a served default when the tag carries no region', () => {
    // Bare "ta" is a lottery on Android — some recognisers take it, some
    // return language-not-supported. Arabic cannot use the India fallback,
    // because `ar-IN` is not a recognizer-served locale.
    expect(speechLocale(Language.Ta, 'ta')).toBe('ta-IN');
    expect(speechLocale(Language.Hi, 'hi')).toBe('hi-IN');
    expect(speechLocale(Language.Ar, 'ar')).toBe('ar-SA');
  });

  it('follows the app language, not the phone, when they disagree', () => {
    // The app is showing Tamil, so Tamil is what the user is about to speak.
    expect(speechLocale(Language.Ta, 'en-US')).toBe('ta-IN');
    expect(speechLocale(Language.Ar, 'en-US')).toBe('ar-SA');
  });

  it('keeps an Arabic phone region when the app is Arabic', () => {
    expect(speechLocale(Language.Ar, 'ar-AE')).toBe('ar-AE');
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

  it('ignores script subtags when language and region match', () => {
    expect(onDeviceLocaleInstalled('ar-SA', ['ar-Arab-SA'])).toBe(true);
    expect(onDeviceLocaleInstalled('hi-IN', ['hi-Deva-IN'])).toBe(true);
    expect(onDeviceLocaleInstalled('en-IN', ['en-Latn-US'])).toBe(false);
  });
});

describe('offlineVoiceModels', () => {
  const languages = [Language.En, Language.Ta, Language.Hi, Language.Ar];

  it('lists every app language whether or not its model is there', () => {
    // The rows somebody came to this screen to fix are the missing ones, so
    // they cannot be filtered out for being missing.
    const models = offlineVoiceModels(languages, 'en-IN', [], [], 'reported');
    expect(models.app.map((model) => model.tag)).toEqual(['en-IN', 'ta-IN', 'hi-IN', 'ar-SA']);
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
    expect(models.app.map((model) => model.tag)).toEqual(['en-IN', 'ta-IN', 'hi-IN', 'ar-SA']);
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

describe('offlineDownloadReason', () => {
  // The rejection Expo hands back is a coded error: `{ code, message }`. These
  // are the codes the native module actually produces.
  const rejected = (code: unknown): unknown => ({ code, message: 'whatever' });

  it('tells "there is no such model" apart from "the model did not arrive"', () => {
    // The whole reason this function exists. Tapping Tamil on a phone whose
    // recogniser has no Tamil model rejects with ERROR_LANGUAGE_NOT_SUPPORTED
    // (12); a phone that has one and failed to fetch it rejects with
    // ERROR_LANGUAGE_UNAVAILABLE (13). One is "this will never work here", the
    // other is "try again on Wi-Fi", and the screen used to say the same dead
    // sentence to both.
    expect(offlineDownloadReason(rejected('error_12'))).toBe('language-missing');
    expect(offlineDownloadReason(rejected('error_13'))).toBe('not-downloaded');
  });

  it('does not call a started download a failure', () => {
    // ERROR_CANNOT_LISTEN_TO_DOWNLOAD_EVENTS (15) arrives as a rejection, but it
    // means the service took the request and will not narrate it.
    expect(offlineDownloadReason(rejected('error_15'))).toBe('started');
  });

  it('names the retryable causes separately', () => {
    // ERROR_NETWORK_TIMEOUT, ERROR_NETWORK, ERROR_SERVER, ERROR_SERVER_DISCONNECTED.
    for (const code of ['error_1', 'error_2', 'error_4', 'error_11']) {
      expect(offlineDownloadReason(rejected(code))).toBe('network');
    }
    // ERROR_RECOGNIZER_BUSY.
    expect(offlineDownloadReason(rejected('error_8'))).toBe('busy');
    // ERROR_INSUFFICIENT_PERMISSIONS — a switch in Settings, and nothing to do
    // with the phone, the language or the connection. It used to land in
    // `refused`, which is the sentence for a phone that would not say why.
    expect(offlineDownloadReason(rejected('error_9'))).toBe('permission');
  });

  it('keeps the platform’s own pre-Android-13 refusal', () => {
    expect(offlineDownloadReason(rejected('not_supported'))).toBe('too-old');
  });

  it('still answers for a code it has never seen, or no code at all', () => {
    // A future Android constant, an error thrown before the native call, a
    // rejection with nothing on it — none of these may throw here, and none may
    // be mistaken for one of the specific causes above.
    expect(offlineDownloadReason(rejected('error_99'))).toBe('refused');
    expect(offlineDownloadReason(rejected('error_'))).toBe('refused');
    expect(offlineDownloadReason(rejected('error_12x'))).toBe('refused');
    expect(offlineDownloadReason(rejected(12))).toBe('refused');
    expect(offlineDownloadReason(new Error('boom'))).toBe('refused');
    expect(offlineDownloadReason(null)).toBe('refused');
    expect(offlineDownloadReason(undefined)).toBe('refused');
  });
});

/**
 * The one question this screen kept getting wrong, now asked of a pure function.
 *
 * The bug in the field: a phone with working 5G, an English model already
 * downloaded, and a card reading "Couldn't load this — check your connection".
 * Reading the phone's models never touches a network, so that sentence could not
 * have been true; what had actually happened was that the recogniser service
 * refused the query, and every rejection was being poured into the app's generic
 * network empty-state. The same undefined answer then told the row below that
 * nothing was installed, so English offered a Download directly above its own
 * "Downloaded. The mic can use it now."
 */
describe('offlineVoiceRead', () => {
  // A modern Android that answers: the case everything else is a deviation from.
  const android: OfflineVoiceReadInput = {
    hasModule: true,
    supportsOnDevice: true,
    reportsInstalled: true,
    canDownload: true,
    query: 'success',
    namedAnything: true,
  };

  it('trusts a phone that answered with a list', () => {
    expect(offlineVoiceRead(android)).toBe('ready');
    expect(offlineVoiceKnowledge(offlineVoiceRead(android))).toBe('reported');
  });

  it('separates an answer of nothing from no answer at all', () => {
    // Answered, named nothing: an empty inventory is a fact, and believable.
    const empty = offlineVoiceRead({ ...android, namedAnything: false });
    expect(empty).toBe('empty');
    expect(offlineVoiceKnowledge(empty)).toBe('reported');

    // Refused: not an empty inventory, and emphatically not the connection.
    const refused = offlineVoiceRead({ ...android, query: 'error', namedAnything: false });
    expect(refused).toBe('unreadable');
    expect(offlineVoiceKnowledge(refused)).toBe('unknowable');
  });

  it('never calls a read still in flight an answer', () => {
    for (const query of ['idle', 'loading'] as const) {
      const state = offlineVoiceRead({ ...android, query, namedAnything: false });
      expect(state).toBe('loading');
      // The whole of the row bug: believing a not-yet-answered read is what drew
      // a Download button beside a model that was already there.
      expect(offlineVoiceKnowledge(state)).toBe('unknowable');
    }
  });

  it('puts the device facts ahead of the read, most disqualifying first', () => {
    // Each of these is true whatever the query does, so each outranks it.
    const broken = { query: 'error', namedAnything: false } as const;
    expect(offlineVoiceRead({ ...android, ...broken, hasModule: false })).toBe('no-module');
    expect(offlineVoiceRead({ ...android, ...broken, supportsOnDevice: false })).toBe(
      'no-on-device',
    );
    // iPhone answers, and its answer means nothing — see InstalledKnowledge.
    expect(offlineVoiceRead({ ...android, reportsInstalled: false })).toBe('unknowable');
    // Android 12: nothing to fetch, which is a truer sentence than a failed read.
    expect(offlineVoiceRead({ ...android, ...broken, canDownload: false })).toBe('too-old');
  });

  it('never lets iPhone’s echo be read as an inventory', () => {
    expect(offlineVoiceKnowledge(offlineVoiceRead({ ...android, reportsInstalled: false }))).toBe(
      'unknowable',
    );
  });
});

describe('withConfirmedInstalls', () => {
  const model = (tag: string, state: 'installed' | 'missing' | 'unknown') => ({
    tag,
    language: null,
    state,
  });

  it('ticks a model this screen watched land, whatever the phone says', () => {
    // The screenshot, exactly: the read failed, so every row reads `unknown`,
    // but English arrived a moment ago and we saw it arrive.
    const models = {
      app: [model('en-IN', 'unknown'), model('ta-IN', 'unknown')],
      alsoInstalled: [],
      downloadable: [],
    };
    const ticked = withConfirmedInstalls(models, ['en-IN']);
    expect(ticked.app.map((row) => row.state)).toEqual(['installed', 'unknown']);
  });

  it('matches the way tags are written, not the way they are typed', () => {
    const models = { app: [model('en-IN', 'missing')], alsoInstalled: [], downloadable: [] };
    expect(withConfirmedInstalls(models, ['EN_in']).app[0]?.state).toBe('installed');
  });

  it('only ever adds — it cannot untick anything', () => {
    const models = {
      app: [model('en-IN', 'installed')],
      alsoInstalled: [model('de-DE', 'installed')],
      downloadable: [model('fr-FR', 'missing')],
    };
    const same = withConfirmedInstalls(models, []);
    expect(same).toEqual(models);
    const one = withConfirmedInstalls(models, ['en-IN']);
    expect(one.alsoInstalled[0]?.state).toBe('installed');
    expect(one.downloadable[0]?.state).toBe('missing');
  });
});
