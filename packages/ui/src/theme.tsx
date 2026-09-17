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

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export { lightTheme, darkTheme };
