/**
 * The parts of dictation that are not the microphone.
 *
 * Kept free of React and of the native module so they can be tested without a
 * device: which language to recognise in, how a transcript joins whatever is
 * already in the field, and what to tell somebody when it fails. All three have
 * been quietly wrong in other apps — recognising English while somebody speaks
 * Tamil, replacing what they typed instead of adding to it, and showing
 * "error 7".
 */

import type { DictationErrorStrings, Language } from '@/i18n';

/**
 * The BCP-47 tag to recognise in.
 *
 * The device's own tag wins when it agrees with the language the app is showing
 * — somebody on `en-GB` should be recognised as `en-GB`, not corrected to
 * Indian English. When it disagrees, or carries no region, India is the
 * fallback: Waves is India-first, and `ta`/`hi` with no region is a recogniser
 * lottery on Android.
 */
export function speechLocale(language: Language, deviceLocale: string): string {
  const parts = deviceLocale.trim().split(/[-_]/);
  const tag = parts[0];
  // Skip a script subtag (e.g. `zh-Hans-CN`): only a two-letter region or a
  // three-digit UN M.49 code is a real region the recogniser can match.
  const region = parts.slice(1).find((part) => /^([A-Za-z]{2}|\d{3})$/.test(part));
  if (tag?.toLowerCase() === language && region) return `${language}-${region.toUpperCase()}`;
  return `${language}-IN`;
}

/**
 * The English tag to recognise in, keeping the device's region whatever the UI
 * language is.
 *
 * The capture flow always recognises English (its parser is English-only), so
 * the region must be taken from the device independently of the shown language:
 * a phone on `ar-AE` should hear `en-AE`, not be corrected to Indian English the
 * way {@link speechLocale} would (it keeps a region only when the tag already
 * matches the language). India is the fallback only when the device carries no
 * region at all.
 */
export function englishSpeechLocale(deviceLocale: string): string {
  const parts = deviceLocale.trim().split(/[-_]/);
  // A two-letter region or a three-digit UN M.49 code — never a script subtag.
  const region = parts.slice(1).find((part) => /^([A-Za-z]{2}|\d{3})$/.test(part));
  return region ? `en-${region.toUpperCase()}` : 'en-IN';
}

/**
 * Whether an on-device model for `langTag` is covered by the phone's list of
 * installed locales — kept pure (no native module) so the matching itself can be
 * tested without a device.
 *
 * The trap this avoids: matching on the language subtag alone treats every
 * regional model as interchangeable, so a phone with only `en-US` installed
 * would be told it has `en-IN` — and asking the recogniser for an on-device
 * model that is not there returns silence (the "did not catch anything" bug).
 * So two *regioned* tags must match in full: `en-US` does not satisfy `en-IN`.
 *
 * A language-only entry is the one wildcard: Android commonly lists an installed
 * model as just `en`, meaning the generic English model, which does cover any
 * region of English. So `en` (installed) covers `en-IN` (wanted), and a bare
 * `en` request is covered by any installed English. Only when both sides name a
 * region must those regions agree.
 */
export function onDeviceLocaleInstalled(
  langTag: string,
  installedLocales: readonly string[] | null | undefined,
): boolean {
  const norm = (tag: string): string => tag.trim().replace(/_/g, '-').toLowerCase();
  const want = norm(langTag);
  if (!want) return false;
  const wantLang = want.split('-')[0];
  const wantHasRegion = want.includes('-');
  return (installedLocales ?? []).some((raw) => {
    const tag = norm(raw);
    if (!tag) return false;
    if (tag.split('-')[0] !== wantLang) return false;
    const tagHasRegion = tag.includes('-');
    // A language-only entry on either side is the generic model: it covers the
    // whole language. Only when both carry a region must the regions match.
    if (!tagHasRegion || !wantHasRegion) return true;
    return tag === want;
  });
}

/**
 * Whether a phone can be asked which models it actually holds.
 *
 * Android answers this properly: `installedLocales` is a real list of models on
 * the device, separate from the ones it merely supports. iOS does not — its
 * module assigns the supported list to the installed one verbatim, so every
 * locale iOS can recognise at all comes back as "installed" whether or not its
 * dictation language has ever been downloaded. Believing that answer is the old
 * silence bug wearing a tick: the screen would promise a model the recogniser
 * then fails to find. So the phone that cannot be asked is marked `unknowable`
 * and the screen says nothing about installed state at all.
 */
export type InstalledKnowledge = 'reported' | 'unknowable';

/** Whether the phone holds a model — or whether it can even be asked. */
export type OfflineVoiceModelState = 'installed' | 'missing' | 'unknown';

/** One on-device speech model, as the offline-voice screen lists it. */
export interface OfflineVoiceModel {
  /** The BCP-47 tag the recogniser is asked for, and the tag a download names. */
  readonly tag: string;
  /**
   * The app language this model serves, or null for a model the phone offers
   * that Waves itself never asks for. The screen names an app language in its
   * own script; anything else can only be named by its tag.
   */
  readonly language: Language | null;
  /** Whether the phone holds this model, or `unknown` when it cannot say. */
  readonly state: OfflineVoiceModelState;
}

/** The three groups the offline-voice screen shows, in the order it shows them. */
export interface OfflineVoiceModels {
  /** One row per app language, present or not — these are the ones Waves uses. */
  readonly app: OfflineVoiceModel[];
  /**
   * Models already on the phone that no app language claims. Empty on a phone
   * that cannot be asked what it holds — see {@link InstalledKnowledge}.
   */
  readonly alsoInstalled: OfflineVoiceModel[];
  /**
   * Everything else the recogniser says it knows about, and so could fetch.
   * Also empty when the phone cannot be asked: without a trustworthy installed
   * list there is no way to tell an offer from something already there.
   */
  readonly downloadable: OfflineVoiceModel[];
}

/** Lower-cased, dash-separated — the one shape tags are compared in. */
function normaliseTag(tag: string): string {
  return tag.trim().replace(/_/g, '-').toLowerCase();
}

/**
 * The model list, built from what the app needs and what the phone reports.
 *
 * Kept pure (no native module, no React) for the same reason the rest of this
 * file is: the interesting part is the bookkeeping, and the bookkeeping is easy
 * to get wrong in ways a device would only reveal by staying silent.
 *
 * The app's four languages always lead, in the app's own order, whether or not
 * their model is installed — they are the rows somebody came here to fix, and a
 * missing one has to be visible to be downloadable. Their installed state goes
 * through {@link onDeviceLocaleInstalled} rather than a plain membership test,
 * because that is the matcher the mic itself uses: a phone listing a bare `en`
 * really does cover `en-IN`, and a phone listing only `en-US` really does not.
 *
 * Everything else the phone names is split by whether it is already there. That
 * split is not cosmetic — an installed model is a fact about the phone, while a
 * merely supported one is an offer, and putting them in one list would invite a
 * download of something already present.
 *
 * A tag an app row already *covers* is dropped from both other groups, which is
 * a wider test than an exact match and has to be: the phone's usual way of
 * saying it holds generic English is the bare tag `en`, which is not the `en-IN`
 * an app row names but is the very same model, and listing both puts one model
 * on the screen twice.
 *
 * On a phone that cannot be asked what it holds the two lower groups are empty
 * and every app row reads `unknown` — see {@link InstalledKnowledge} for why a
 * confident answer there would be a lie.
 */
export function offlineVoiceModels(
  languages: readonly Language[],
  deviceLocale: string,
  supported: readonly string[] | null | undefined,
  installed: readonly string[] | null | undefined,
  knowledge: InstalledKnowledge,
): OfflineVoiceModels {
  const installedTags = installed ?? [];
  const knowable = knowledge === 'reported';
  const app: OfflineVoiceModel[] = languages.map((language) => {
    const tag = speechLocale(language, deviceLocale);
    const state: OfflineVoiceModelState = !knowable
      ? 'unknown'
      : onDeviceLocaleInstalled(tag, installedTags)
        ? 'installed'
        : 'missing';
    return { tag, language, state };
  });

  const empty = { app, alsoInstalled: [], downloadable: [] };
  if (!knowable) return empty;

  const alsoInstalled: OfflineVoiceModel[] = [];
  const downloadable: OfflineVoiceModel[] = [];
  // The phone may name a tag in `installedLocales` that never appears in
  // `locales`, so both lists are walked; `seen` keeps a tag to one row.
  const seen = new Set(app.map((model) => normaliseTag(model.tag)));
  for (const raw of [...installedTags, ...(supported ?? [])]) {
    const tag = raw.trim();
    const key = normaliseTag(tag);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    // The same matcher the mic uses, asked backwards: does this one tag satisfy
    // any app row? A bare `en` satisfies `en-IN`, so it is that row's model and
    // not a second one. `en-US` satisfies nothing above and stays.
    if (app.some((model) => onDeviceLocaleInstalled(model.tag, [tag]))) continue;
    const isInstalled = installedTags.some((entry) => normaliseTag(entry) === key);
    (isInstalled ? alsoInstalled : downloadable).push({
      tag,
      language: null,
      state: isInstalled ? 'installed' : 'missing',
    });
  }

  const byTag = (a: OfflineVoiceModel, b: OfflineVoiceModel): number => a.tag.localeCompare(b.tag);
  return { app, alsoInstalled: alsoInstalled.sort(byTag), downloadable: downloadable.sort(byTag) };
}

/**
 * Why a request to fetch an on-device model ended the way it did.
 *
 * This exists because the honest answer to "why did Tamil fail?" was being
 * thrown away one layer down. `androidTriggerOfflineModelDownload` rejects with
 * a code, and on Android 14+ that code is `error_<n>` where `n` is a
 * `SpeechRecognizer.ERROR_*` constant handed straight through from
 * `ModelDownloadListener.onError`. The screen used to test for exactly one code
 * (`not_supported`, the pre-Android-13 refusal) and collapse every other cause
 * into "your phone couldn't download that one" — a sentence that is true of a
 * dead network, a busy service, a language the recogniser has never heard of
 * and a download that in fact started fine. Four different things to do, one
 * dead end.
 *
 * The distinctions that earn their own word:
 *
 *  - `language-missing` (12, ERROR_LANGUAGE_NOT_SUPPORTED) — "not available to
 *    be used with the current recognizer". There is no model to fetch and there
 *    never will be on this phone as it stands. This is the one that matters:
 *    the screen offers a Download button for all four app languages whether or
 *    not the recogniser has ever heard of them, and it cannot know better in
 *    advance (see {@link offlineVoiceModels} and the probe note in
 *    `speechModels.ts` — the supported list is a union that includes
 *    network-only languages, so a tag appearing there is no promise of a model).
 *    The tap *is* the probe, and this is the probe answering "no".
 *  - `not-downloaded` (13, ERROR_LANGUAGE_UNAVAILABLE) — the opposite, and it
 *    reads identically to a user: "supported, but not yet downloaded". The
 *    model exists; this attempt did not land it. Worth trying again.
 *  - `started` (15, ERROR_CANNOT_LISTEN_TO_DOWNLOAD_EVENTS) — not a failure at
 *    all. The service took the request and cannot report on it. Calling that
 *    "couldn't download" is simply false.
 *  - `network` (1, 2, 4, 11), `busy` (8) — ordinary, retryable, and each has a
 *    different thing for a person to go and do.
 *  - `too-old` — the module's own pre-API-33 refusal, which the screen already
 *    prevents by not drawing a button; kept because a rejection is a rejection.
 *  - `refused` — everything else, including a code that is not a code. A future
 *    Android constant lands here and gets a sentence that is still true.
 */
export type OfflineDownloadReason =
  'too-old' | 'language-missing' | 'not-downloaded' | 'started' | 'network' | 'busy' | 'refused';

/**
 * The reason behind a rejected download, read off the thrown value.
 *
 * Kept here rather than in `speechModels.ts` for the reason the rest of this
 * file is: it is pure decision-making over a string, it is easy to get subtly
 * wrong, and a device is a terrible place to find that out.
 */
export function offlineDownloadReason(caught: unknown): OfflineDownloadReason {
  const code = (caught as { code?: unknown } | null | undefined)?.code;
  if (code === 'not_supported') return 'too-old';
  if (typeof code !== 'string') return 'refused';
  const error = /^error_(\d+)$/.exec(code);
  if (!error) return 'refused';
  switch (Number(error[1])) {
    // ERROR_NETWORK_TIMEOUT, ERROR_NETWORK, ERROR_SERVER, ERROR_SERVER_DISCONNECTED.
    case 1:
    case 2:
    case 4:
    case 11:
      return 'network';
    // ERROR_RECOGNIZER_BUSY.
    case 8:
      return 'busy';
    // ERROR_LANGUAGE_NOT_SUPPORTED.
    case 12:
      return 'language-missing';
    // ERROR_LANGUAGE_UNAVAILABLE.
    case 13:
      return 'not-downloaded';
    // ERROR_CANNOT_LISTEN_TO_DOWNLOAD_EVENTS.
    case 15:
      return 'started';
    // ERROR_CLIENT (5), ERROR_INSUFFICIENT_PERMISSIONS (9),
    // ERROR_CANNOT_CHECK_SUPPORT (14), and whatever a later Android adds.
    default:
      return 'refused';
  }
}

/**
 * What the field should read while somebody is speaking.
 *
 * `before` is whatever was in the field when the mic was tapped, and it is
 * never thrown away: dictation adds to a note, it does not replace one. The
 * transcript is recomputed from `before` on every interim result rather than
 * appended, because interim results are re-issued in full — appending them
 * gives you "dinner dinner at dinner at the".
 */
export function mergeTranscript(before: string, transcript: string): string {
  const spoken = transcript.trim();
  if (!spoken) return before;
  const kept = before.trimEnd();
  return kept ? `${kept} ${spoken}` : spoken;
}

/**
 * Every error this can end on, in words.
 *
 * The codes are the Web Speech API's, which both native implementations are
 * mapped onto. Anything unrecognised gets a sentence that is still true, so a
 * new code in a future version is a vague message rather than a blank one.
 */
export function dictationError(code: string, messages: DictationErrorStrings): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return messages.notAllowed;
    case 'no-speech':
      return messages.noSpeech;
    case 'audio-capture':
      return messages.audioBusy;
    case 'network':
      return messages.network;
    case 'language-not-supported':
      return messages.languageNotSupported;
    // Not an error anybody needs telling about: it is what stopping produces.
    case 'aborted':
      return '';
    default:
      return messages.stopped;
  }
}
