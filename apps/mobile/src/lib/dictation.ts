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
 * Indian English. When it disagrees, or carries no region, the fallback is the
 * app language's nearest supported default: India for en/ta/hi, and Saudi Arabia
 * for Arabic. `ar-IN` is not a real speech locale on Android, so using India for
 * every language made Arabic voice and offline-model rows fail before the user
 * could do anything useful.
 */
const SPEECH_FALLBACK_REGION: Readonly<Record<Language, string>> = {
  en: 'IN',
  ta: 'IN',
  hi: 'IN',
  ar: 'SA',
};

export function speechLocale(language: Language, deviceLocale: string): string {
  const parts = deviceLocale.trim().split(/[-_]/);
  const tag = parts[0];
  // Skip a script subtag (e.g. `zh-Hans-CN`): only a two-letter region or a
  // three-digit UN M.49 code is a real region the recogniser can match.
  const region = parts.slice(1).find((part) => /^([A-Za-z]{2}|\d{3})$/.test(part));
  if (tag?.toLowerCase() === language && region) return `${language}-${region.toUpperCase()}`;
  return `${language}-${SPEECH_FALLBACK_REGION[language]}`;
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
  const parse = (tag: string): { language: string; region: string | null } | null => {
    const parts = tag.trim().replace(/_/g, '-').toLowerCase().split('-').filter(Boolean);
    const language = parts[0];
    if (!language) return null;
    const region = parts.slice(1).find((part) => /^[a-z]{2}$/.test(part) || /^\d{3}$/.test(part));
    return { language, region: region ?? null };
  };

  const want = parse(langTag);
  if (!want) return false;
  return (installedLocales ?? []).some((raw) => {
    const tag = parse(raw);
    if (!tag) return false;
    if (tag.language !== want.language) return false;
    // A language-only entry on either side is the generic model: it covers the
    // whole language. Only when both carry a region must those regions match.
    if (!tag.region || !want.region) return true;
    return tag.region === want.region;
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
 * What the offline-voice screen has to say about this phone.
 *
 * This exists because the screen used to have no name for its own most common
 * failure, and borrowed the app's generic one instead: any rejection from the
 * inventory read drew "Couldn't load this — check your connection". That
 * sentence is not merely unhelpful here, it is false. Reading the phone's speech
 * models is a local call into the recogniser service on the device; there is no
 * server anywhere in it, so a connection cannot be the cause and checking one
 * cannot be the cure. On a phone whose service is slow, busy, or simply does not
 * implement the query — which is the OEM-ROM case this whole screen exists for —
 * the reader was told to go and look at their Wi-Fi.
 *
 * This answers exactly one question — *what should the screen say* — and it is
 * deliberately not asked the other one. Whether the installed list may be
 * believed is {@link offlineVoiceKnowledge}. Deriving that from this cost two
 * separate bugs, because a ranking of what most needs saying is the wrong
 * instrument for a question of evidence: a phone too old to *fetch* a model was
 * told it could not be *asked* what it holds (it can, and it just had), and a
 * refresh that failed on top of a perfectly good answer threw that answer away.
 *
 *  - `no-module` — an older binary with no native speech module at all.
 *  - `no-on-device` — a recogniser that only ever works over the network.
 *  - `unknowable` — iPhone, which returns its supported list under both names,
 *    so its answer about what is installed means nothing (see
 *    {@link InstalledKnowledge}).
 *  - `too-old` — Android 12 and below: nothing to *fetch*. It may still be asked
 *    what it holds, and on this path it usually answers.
 *  - `unreadable` — asked, refused, and nothing held from before. Its own words,
 *    never the connection's.
 *  - `stale` — asked again and refused, but an earlier answer is still in hand.
 *    A quieter thing entirely: the ticks stand, they are merely not fresh.
 *  - `loading` — asked, still waiting, nothing yet. A refresh *over* an answer is
 *    not this: the list stays on screen and keeps its own state.
 *  - `empty` — answered, and named nothing at all.
 *  - `ready` — answered with a list.
 */
export type OfflineVoiceRead =
  | 'no-module'
  | 'no-on-device'
  | 'unknowable'
  | 'too-old'
  | 'unreadable'
  | 'stale'
  | 'loading'
  | 'empty'
  | 'ready';

/** Everything both answers are decided from — no React, no native module. */
export interface OfflineVoiceReadInput {
  /** The native speech module imported on this build. */
  readonly hasModule: boolean;
  /** This phone can recognise speech with no connection. */
  readonly supportsOnDevice: boolean;
  /** The installed list is a fact rather than an echo — Android only. */
  readonly reportsInstalled: boolean;
  /** A model can be fetched from inside the app — Android 13 and up. */
  readonly canDownload: boolean;
  /** How the newest read went. */
  readonly query: 'loading' | 'error' | 'success';
  /**
   * An answer is in hand — from this read or an earlier one.
   *
   * The distinction the data layer draws, and this file has to draw too: a query
   * that answered and *then* failed a refresh is still holding its answer, and is
   * a different thing from one that has never answered at all. Reading only "did
   * the last fetch fail" turned a momentarily busy speech service into a screen
   * that forgot everything it knew — on a surface whose single best-known failure
   * mode is a momentarily busy speech service.
   */
  readonly hasData: boolean;
  /** The answer named at least one locale, supported or installed. */
  readonly namedAnything: boolean;
}

/**
 * The one sentence the screen leads with, most disqualifying fact first.
 *
 * The order is the point. A device that cannot recognise speech offline at all
 * is not also "still loading", and a phone too old to fetch a model is told that
 * rather than told its read failed — the older fact is the truer sentence, and
 * the one with something to do about it. What the order must never decide is
 * whether the rows below may be trusted; that is not a sentence, and it is not
 * here.
 */
export function offlineVoiceRead(input: OfflineVoiceReadInput): OfflineVoiceRead {
  if (!input.hasModule) return 'no-module';
  if (!input.supportsOnDevice) return 'no-on-device';
  if (!input.reportsInstalled) return 'unknowable';
  if (!input.canDownload) return 'too-old';
  // A refusal on top of an answer is not the same event as a refusal instead of
  // one, and must not wear the same words: the first costs freshness, the second
  // costs everything.
  if (input.query === 'error') return input.hasData ? 'stale' : 'unreadable';
  // Likewise a refresh in flight over an answer, which is not a blank screen
  // waiting to be filled — it is a list, being checked.
  if (input.query === 'loading' && !input.hasData) return 'loading';
  return input.namedAnything ? 'ready' : 'empty';
}

/**
 * Whether the installed list may be believed.
 *
 * Its own function over the same input, and emphatically not a reading of
 * {@link OfflineVoiceRead}. Deriving it from that answered "can this phone be
 * asked what it holds?" with "can this phone download?", and an Android 12
 * reader who had installed English through system settings — the one person the
 * screen exists to answer — was told the phone could not say, immediately after
 * it did.
 *
 * Three things make an answer trustworthy, and `canDownload` is not among them:
 * the module is here, the phone recognises on-device at all, and it reports
 * installed models as fact rather than echoing its supported list (iPhone does
 * the latter — see {@link InstalledKnowledge}). Then there must actually be an
 * answer in hand. That is `hasData`, never "the last fetch succeeded", so a
 * failed refresh over a good list keeps the list instead of blanking every row;
 * and never "the answer named something", because a phone that answers with
 * nothing has still answered, and an empty inventory is a fact like any other.
 */
export function offlineVoiceKnowledge(input: OfflineVoiceReadInput): InstalledKnowledge {
  if (!input.hasModule || !input.supportsOnDevice || !input.reportsInstalled) return 'unknowable';
  return input.hasData ? 'reported' : 'unknowable';
}

/**
 * Tick the models this screen watched land, whatever the phone will say.
 *
 * A download that resolved `download_success` is the strongest evidence there
 * is — stronger than the inventory, which on many phones under-reports and on
 * some cannot be read at all. Without this, finishing a download on a phone
 * whose service will not answer leaves the row exactly as it was, still offering
 * the Download that just worked.
 *
 * It only ever adds: a row already installed stays installed, and nothing here
 * can turn a tick off.
 */
export function withConfirmedInstalls(
  models: OfflineVoiceModels,
  confirmed: readonly string[],
): OfflineVoiceModels {
  if (confirmed.length === 0) return models;
  const tags = new Set(confirmed.map(normaliseTag));
  const tick = (model: OfflineVoiceModel): OfflineVoiceModel =>
    tags.has(normaliseTag(model.tag)) ? { ...model, state: 'installed' } : model;
  return {
    app: models.app.map(tick),
    alsoInstalled: models.alsoInstalled.map(tick),
    downloadable: models.downloadable.map(tick),
  };
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
 *    different thing for a person to go and do. `network` is the *only* reason
 *    on this screen that may mention a connection, because it is the only one
 *    that is about one.
 *  - `permission` (9, ERROR_INSUFFICIENT_PERMISSIONS) — the service will not act
 *    for an app that has not been given the microphone. Nothing about the phone,
 *    the language or the network; a switch in Settings, and previously filed
 *    under "refused without saying why", which was a dead end for a fixable
 *    thing.
 *  - `too-old` — the module's own pre-API-33 refusal, which the screen already
 *    prevents by not drawing a button; kept because a rejection is a rejection.
 *  - `refused` — everything else, including a code that is not a code. A future
 *    Android constant lands here and gets a sentence that is still true.
 */
export type OfflineDownloadReason =
  | 'too-old'
  | 'language-missing'
  | 'not-downloaded'
  | 'started'
  | 'network'
  | 'busy'
  | 'permission'
  | 'refused';

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
    // ERROR_INSUFFICIENT_PERMISSIONS.
    case 9:
      return 'permission';
    // ERROR_CLIENT (5), ERROR_CANNOT_CHECK_SUPPORT (14), and whatever a later
    // Android adds.
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
