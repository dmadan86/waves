import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Plus_Jakarta_Sans } from 'next/font/google';

import { StringsProvider } from '@/i18n-context';
import { AuthProvider } from '@/lib/auth';
import { ThemeProvider, THEME_BOOT_SCRIPT } from '@/lib/theme';
import { isRtlLanguage, localeFor, pickLanguage, stringsFor } from '@/i18n';

import './globals.css';

/**
 * One face, self-hosted by Next at build time so there is no request to a font
 * CDN and no layout shift. Plus Jakarta Sans is a humanist geometric with a
 * true tabular figure set — which matters more here than anywhere else, since
 * most of this app is a column of amounts that has to line up on the decimal.
 */
const waves = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-waves',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Waves',
  description: 'Split expenses without the argument at the end.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // The browser chrome follows the page rather than sitting in a colour the
  // page stopped using two themes ago.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F3F1FB' },
    { media: '(prefers-color-scheme: dark)', color: '#0E0E1A' },
  ],
};

/**
 * The language is read from `Accept-Language` here and nowhere else.
 *
 * Doing it on the server is what lets `lang` and `dir` be right in the first
 * paint. A guest opening an invite on an Arabic phone should find the page
 * already the right way round, not watch it turn around after hydration —
 * and unlike the app, the web has no restart problem: `dir` on `<html>` is
 * honoured by CSS the moment it is set.
 *
 * The theme cannot be read on the server — it lives in the browser's own
 * storage — so it is stamped by a blocking inline script instead. That script
 * runs before the first paint, which is the only way to avoid a white flash on
 * a dark-themed machine.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const accept = (await headers()).get('accept-language');
  const language = pickLanguage(accept);
  const locale = localeFor(language, accept);
  const t = stringsFor(language);

  return (
    <html
      lang={language}
      dir={isRtlLanguage(language) ? 'rtl' : 'ltr'}
      className={waves.variable}
      suppressHydrationWarning
    >
      <head>
        <title>{t.home.title}</title>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <StringsProvider language={language} locale={locale}>
          <ThemeProvider>
            <AuthProvider>{children}</AuthProvider>
          </ThemeProvider>
        </StringsProvider>
      </body>
    </html>
  );
}
