/**
 * Which language the app is in, and which way it runs.
 *
 * The phone's language is the default and stays the default. This exists
 * because a phone is one setting for one person, and the two do not always
 * agree: somebody in Chennai whose phone is in English still reads Tamil
 * faster, and somebody visiting from Dubai has a phone in Arabic and a group
 * full of people who do not read it.
 *
 * ## The restart, and why it is not hidden
 *
 * Strings change instantly — they are React state and nothing else. Direction
 * does not. React Native decides right-to-left once, natively, before any
 * JavaScript runs, and `I18nManager.forceRTL` says so itself: *changes take
 * full effect on the next application start*. So the app restarts itself, via
 * `@/lib/restart` — and asks first, because throwing somebody out of the screen
 * they are standing on is not something to do without permission.
 *
 * A build that cannot restart itself — anything older than the one that added
 * `expo-updates`, and any reload the platform refuses — still gets the sentence
 * that was always true: close and open Waves again.
 *
 * Said in an alert, at the moment of the choice, and not only in a banner. A
 * banner lives on one screen; somebody who taps a language and walks away never
 * reads it, comes back to a mirrored English app and reports it as broken. It
 * is worth interrupting for, once, and only when the direction actually turns.
 *
 * `allowRTL` and `forceRTL` are both set, in step, because they answer
 * different halves of the question. Android computes RTL as
 * `forced || (allowed && the device is RTL)`, so `forceRTL(false)` alone would
 * not give an English reader on an Arabic phone a left-to-right app — it only
 * stops *forcing*, and the device pref would win. Setting both makes the choice
 * mean what it says in both directions.
 *
 * ## Icons follow the screen, not the choice
 *
 * `setLayoutDirection` takes the direction the app is *actually laid out in*,
 * which between choosing Arabic and restarting is still the old one. Mirroring
 * the arrows the moment the language changes would put backwards chevrons on an
 * unmirrored screen — a bug that looks exactly like the one it is trying to
 * prevent.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { I18nManager, Platform } from 'react-native';

import { setLayoutDirection } from '@waves/ui';

import { legacyKeysMigrated } from '@/lib/legacyKeys';

import {
  deviceLanguage,
  deviceLocale,
  isRtlLanguage,
  LanguageContext,
  localeFor,
  setActiveLanguage,
  type Language,
} from '@/i18n';

const KEY = 'waves.language';

/**
 * The direction the app actually launched in.
 *
 * Read once, at module scope, because that is when it was true. `isRTL` comes
 * from native constants captured at startup and does not move when `forceRTL`
 * is called, which is precisely what makes it the right thing to compare a new
 * choice against.
 *
 * Web has no `I18nManager` worth asking — the root view carries a `dir` instead
 * and CSS honours it the moment it changes, so there is nothing to restart and
 * nothing to compare.
 */
const LAUNCHED_RTL = Platform.OS === 'web' ? null : I18nManager.isRTL;

/**
 * The app has been put the other way round and cannot mirror itself until it is
 * opened again — raised by `setLanguage`, answered by `LanguageRestartPrompt`.
 *
 * It is a value rather than a dialog because of where this provider sits: it is
 * the outermost one in the tree, above the theme, above `DialogProvider`, and
 * so it cannot use the app's own dialog. It used to reach past all of that for
 * `Alert.alert`, which is exactly the borrowed native window this app stopped
 * using (A66). So the provider says *what happened* and something mounted
 * further in draws it.
 *
 * The language is carried along rather than read off the context by the
 * consumer, because the words have to be the ones just chosen — that is the one
 * language the person has said they read.
 */
export interface LanguageRestartPrompt {
  readonly language: Language;
  /** True when the layout is about to become right-to-left. */
  readonly rtl: boolean;
}

interface LanguageValue {
  /** The language the app is speaking. */
  language: Language;
  /** The explicit choice, or null when it is following the phone. */
  stored: Language | null;
  /** The locale money and dates are formatted in. */
  locale: string;
  /** True while the stored choice is still being read. */
  loading: boolean;
  /** Null puts it back under the phone's control. */
  setLanguage: (value: Language | null) => Promise<void>;
  /** What the phone itself is set to, for explaining the default. */
  phoneLanguage: Language;
  /**
   * True when the chosen language reads the other way from the layout on
   * screen. Only ever true on a device, and only until the app is opened again.
   */
  restartNeeded: boolean;
}

/**
 * The restart question, on its own context.
 *
 * It deliberately does not ride on {@link LanguageValue}: that value is what
 * `useStrings` hands to every screen in the app, so putting a piece of state
 * that changes on it would re-render the whole tree twice for a question one
 * component draws. `_layout` says the same thing about where `ToastProvider`
 * sits, for the same reason.
 */
interface RestartPromptValue {
  /** Set the moment a choice flips the direction; cleared once it is shown. */
  readonly prompt: LanguageRestartPrompt | null;
  readonly clear: () => void;
}

/**
 * The whole value, for the two screens that change it.
 *
 * Separate from `LanguageContext` in `./index` on purpose, and holding the very
 * same object. That one carries the two fields every screen in the app reads
 * through `useStrings`, and it lives beside the string tables — where a setter
 * and a restart flag have no business being, and would drag React Native and
 * AsyncStorage into a module the tests import for its data.
 */
const LanguageValueContext = createContext<LanguageValue | null>(null);
const RestartPromptContext = createContext<RestartPromptValue>({ prompt: null, clear: () => {} });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<Language | null>(null);
  const [loading, setLoading] = useState(true);
  const [restartPrompt, setRestartPrompt] = useState<LanguageRestartPrompt | null>(null);

  const phoneLanguage = deviceLanguage();
  const language = stored ?? phoneLanguage;

  useEffect(() => {
    let active = true;
    void (async () => {
      await legacyKeysMigrated;
      const saved = await AsyncStorage.getItem(KEY).catch(() => null);
      if (!active) return;
      setStored(isLanguage(saved) ? saved : null);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  // On web the layout mirrors the moment `dir` changes, so the icons have to
  // keep up with the choice. On a device they have to keep up with the launch.
  useEffect(() => {
    setLayoutDirection(LAUNCHED_RTL ?? isRtlLanguage(language));
  }, [language]);

  // The one writer of the module-level mirror in `@/i18n`, so the few callers
  // outside the React tree — `readFunctionError`, which has to turn a server
  // refusal into a sentence — say it in the language on screen.
  useEffect(() => {
    setActiveLanguage(language);
  }, [language]);

  const setLanguage = useCallback(async (value: Language | null) => {
    setStored(value);
    if (value === null) await AsyncStorage.removeItem(KEY).catch(() => undefined);
    else await AsyncStorage.setItem(KEY, value).catch(() => undefined);

    // Persisted natively and read before any JavaScript next time the app
    // opens. Nothing about the current session changes.
    if (Platform.OS !== 'web') {
      const chosen = value ?? deviceLanguage();
      const rtl = isRtlLanguage(chosen);
      I18nManager.allowRTL(rtl);
      I18nManager.forceRTL(rtl);

      // Said at the moment of the choice, and said in a way that has to be
      // dismissed, because the alternative has already failed twice: a banner
      // lives on one screen, and somebody who taps a language and walks away
      // never reads it.
      //
      // Compared against the direction the app *launched* in rather than the
      // language being replaced. Going Arabic → English → Arabic in one sitting
      // ends where it started, and there is nothing left to restart for.
      if (rtl !== LAUNCHED_RTL) setRestartPrompt({ language: chosen, rtl });
    }
  }, []);

  const clearRestartPrompt = useCallback(() => setRestartPrompt(null), []);

  const value = useMemo<LanguageValue>(
    () => ({
      language,
      stored,
      // Following the phone keeps the phone's own tag, which is richer than
      // anything reassembled from a language and a country.
      locale: stored === null ? deviceLocale() : localeFor(stored),
      loading,
      setLanguage,
      phoneLanguage,
      restartNeeded: LAUNCHED_RTL !== null && LAUNCHED_RTL !== isRtlLanguage(language),
    }),
    [language, stored, loading, setLanguage, phoneLanguage],
  );

  const restart = useMemo<RestartPromptValue>(
    () => ({ prompt: restartPrompt, clear: clearRestartPrompt }),
    [restartPrompt, clearRestartPrompt],
  );

  return (
    <LanguageContext.Provider value={value}>
      <LanguageValueContext.Provider value={value}>
        <RestartPromptContext.Provider value={restart}>{children}</RestartPromptContext.Provider>
      </LanguageValueContext.Provider>
    </LanguageContext.Provider>
  );
}

/** For `LanguageRestartPrompt`, which is the only thing that wants this. */
export function useRestartPrompt(): RestartPromptValue {
  return useContext(RestartPromptContext);
}

export function useLanguage(): LanguageValue {
  const value = useContext(LanguageValueContext);
  if (!value) throw new Error('useLanguage must be used inside LanguageProvider');
  return value;
}

function isLanguage(value: string | null): value is Language {
  return value === 'en' || value === 'ta' || value === 'hi' || value === 'ar';
}
