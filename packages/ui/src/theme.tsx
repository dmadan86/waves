/**
 * Serving a theme to the phone.
 *
 * The themes themselves are data and live in `./themes`, which imports nothing
 * platform-shaped — the web reads that file to emit the same colours as CSS.
 * What is left here is the React half: a context, a provider that follows the
 * system scheme unless a screen overrides it, and the hook every component
 * calls. The types and both theme objects are re-exported so `@waves/ui` keeps
 * the surface it has always had.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { darkTheme, lightTheme, type Theme, type TintPair } from './themes';
import { scenic } from './tokens';

export type { Theme, TintPair };

const ThemeContext = createContext<Theme>(lightTheme);

export function ThemeProvider({
  children,
  forceScheme,
}: {
  children: ReactNode;
  forceScheme?: 'light' | 'dark';
}) {
  const systemScheme = useColorScheme();
  const theme = useMemo(() => {
    const scheme = forceScheme ?? (systemScheme === 'dark' ? 'dark' : 'light');
    return scheme === 'dark' ? darkTheme : lightTheme;
  }, [forceScheme, systemScheme]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

const scenicCache = new WeakMap<Theme, Theme>();

function scenicOf(theme: Theme): Theme {
  const cached = scenicCache.get(theme);
  if (cached) return cached;
  const made: Theme = {
    ...theme,
    scenic: true,
    radius: scenic.radius,
    typography: scenic.typography,
    shadow: { ...theme.shadow, soft: scenic.shadowSoft },
    color:
      theme.scheme === 'light'
        ? { ...theme.color, bg: scenic.bg, border: scenic.border }
        : theme.color,
  };
  scenicCache.set(theme, made);
  return made;
}

/**
 * Serves the pre-redesign look (bigger radii, soft shadow, larger type, vivid
 * gradients) to a subtree. Wrap the personal social screens in it; the rest of
 * the app keeps the calm tokens.
 */
export function ScenicTheme({ children }: { children: ReactNode }) {
  const parent = useContext(ThemeContext);
  const value = useMemo(() => scenicOf(parent), [parent]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export { lightTheme, darkTheme };
