'use client';

/**
 * Light, dark, or whatever the machine is set to.
 *
 * The phone has had this switch since `settings/theme`; the web had no dark
 * palette at all, so the same account was light-only on a laptop. The colours
 * now come from the design system in both schemes — see `tokens.css` — and this
 * is the small amount of state that decides which set applies.
 *
 * Three values, not two. "Device" is the default and stamps nothing on the
 * document, leaving `prefers-color-scheme` to decide; an explicit choice stamps
 * `data-theme`, which every token block is written to respect in both
 * directions (an explicit light must beat a dark operating system).
 *
 * The preference is per-browser, in `localStorage`. It is not on the profile:
 * the phone keeps its own preference locally too, and an account that dragged a
 * dark choice from a phone onto a shared desktop would be surprising rather
 * than helpful. Reading it can throw — a private window, blocked site data — so
 * every access is guarded and the page renders correctly without it.
 *
 * Both pieces of state are read through `useSyncExternalStore` rather than an
 * effect that calls `setState`. They are external state: one lives in the
 * browser's storage, the other in a media query, and neither is React's to own.
 * It is also what makes hydration correct — the server has no way to know
 * either answer, so it renders the neutral one and React swaps in the real one
 * on the client without a mismatch.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'waves.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Appearance is off the menu for now: the web is light, everywhere, always.
 * The mobile app hides it the same way, in its own `lib/theme`.
 *
 * Nothing is deleted — the dark token block, the picker page and whatever is
 * in `localStorage` all survive untouched, and come back the moment this is
 * false. What changes is the answer this module gives: `light`, stated, rather
 * than the stored choice.
 *
 * Stated matters here more than on the phone. Leaving it at `system` would let
 * `prefers-color-scheme` turn a dark laptop's page dark, which is the exact
 * thing being hidden — so the boot script stamps `data-theme="light"`, which
 * `tokens.css` is written to let win over a dark operating system.
 */
export const THEME_HIDDEN = true;

/**
 * Applied before first paint by the inline script in `layout.tsx`, and again by
 * `setChoice` below. Kept as a string rather than written out in the layout so
 * there is exactly one copy of the rule.
 */
export const THEME_BOOT_SCRIPT = THEME_HIDDEN
  ? `try{document.documentElement.setAttribute('data-theme','light')}catch(e){}`
  : `try{var c=localStorage.getItem('${KEY}');if(c==='light'||c==='dark'){document.documentElement.setAttribute('data-theme',c)}}catch(e){}`;

/** Anyone watching the stored choice — this tab's own writes do not fire `storage`. */
const watchers = new Set<() => void>();

function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Blocked site data. The device's own setting it is.
  }
  return 'system';
}

function subscribeChoice(onChange: () => void): () => void {
  watchers.add(onChange);
  // Another tab changing the preference should move this one too — and moving
  // means re-stamping the document, not only re-rendering. Without the stamp
  // the switch here would report Light while the page stayed dark until a
  // reload, because `data-theme` is only ever written by whoever made the
  // change. `setChoice` stamps for the tab it runs in; this stamps for the rest.
  const fromAnotherTab = () => {
    stamp(readChoice());
    onChange();
  };
  window.addEventListener('storage', fromAnotherTab);
  return () => {
    watchers.delete(onChange);
    window.removeEventListener('storage', fromAnotherTab);
  };
}

function subscribeSystem(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const systemIsDark = () => window.matchMedia(DARK_QUERY).matches;

/** The server knows neither answer, so it renders the neutral one. */
const noChoice = (): ThemeChoice => 'system';
const notDark = () => false;

function stamp(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

interface ThemeValue {
  choice: ThemeChoice;
  setChoice: (next: ThemeChoice) => void;
  /** What is actually on screen — the choice, or what the machine says. */
  resolved: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const choice = useSyncExternalStore(subscribeChoice, readChoice, noChoice);
  const systemDark = useSyncExternalStore(subscribeSystem, systemIsDark, notDark);

  const setChoice = useCallback((next: ThemeChoice) => {
    stamp(next);
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // The switch still works for this session; it just will not be remembered.
    }
    for (const notify of watchers) notify();
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({
      choice: THEME_HIDDEN ? 'light' : choice,
      setChoice,
      resolved: THEME_HIDDEN
        ? 'light'
        : choice === 'system'
          ? systemDark
            ? 'dark'
            : 'light'
          : choice,
    }),
    [choice, setChoice, systemDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
