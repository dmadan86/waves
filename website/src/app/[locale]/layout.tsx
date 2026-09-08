import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import {
  IBM_Plex_Mono,
  Noto_Sans_Arabic,
  Noto_Sans_Devanagari,
  Noto_Sans_Tamil,
} from 'next/font/google';
import localFont from 'next/font/local';

import '../globals.css';
import { dirFor, htmlLang, isLocale, locales, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { absoluteUrl, localeAlternates, site } from '@/lib/site';

/*
 * Three faces, all SIL OFL 1.1, all self-hosted. The licence text for the two
 * local ones sits next to the font file in `src/fonts`.
 *
 * Overused Grotesk is one variable file covering 300–900, so the whole weight
 * range costs a single 92 kB request. Departure Mono is the pixel face and is
 * used only for the wordmark and for Latin digits — it has no Tamil,
 * Devanagari or Arabic glyphs, so it must never be put on translated prose.
 */
const grotesk = localFont({
  src: '../../fonts/OverusedGrotesk-VF.woff2',
  weight: '300 900',
  variable: '--font-grotesk',
  display: 'swap',
  // Metrics from the file, so the fallback holds the same space and the
  // headline does not jump when the real face arrives.
  adjustFontFallback: 'Arial',
});

const departure = localFont({
  src: '../../fonts/DepartureMono-Regular.woff2',
  weight: '400',
  variable: '--font-departure',
  display: 'swap',
  adjustFontFallback: false,
});

const plex = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex',
  display: 'swap',
});

const notoArabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  variable: '--font-arabic',
  display: 'swap',
});

const notoDevanagari = Noto_Sans_Devanagari({
  subsets: ['devanagari'],
  variable: '--font-devanagari',
  display: 'swap',
});

const notoTamil = Noto_Sans_Tamil({
  subsets: ['tamil'],
  variable: '--font-tamil',
  display: 'swap',
});

/** Only the script this page is written in is loaded. */
const scriptFont: Record<Locale, string> = {
  en: '',
  ar: notoArabic.variable,
  hi: notoDevanagari.variable,
  ta: notoTamil.variable,
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  /* The browser chrome follows the page, both ways round. */
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafaf9' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0e10' },
  ],
  colorScheme: 'light dark',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getDictionary(locale);

  return {
    metadataBase: new URL(site.url),
    title: { default: t.meta.title, template: `%s · ${site.name}` },
    description: t.meta.description,
    applicationName: site.name,
    // The Markdown alternate is *not* declared here: this layout also wraps
    // /privacy, /terms and the 404, and none of them have a Markdown twin.
    // The home page adds it to its own copy of this block.
    alternates: localeAlternates(locale),
    openGraph: {
      type: 'website',
      siteName: site.name,
      title: t.meta.title,
      description: t.meta.description,
      url: absoluteUrl(`/${locale}`),
      locale: htmlLang[locale],
    },
    twitter: {
      card: 'summary_large_image',
      title: t.meta.title,
      description: t.meta.description,
    },
    robots: { index: true, follow: true },
    other: { 'og:image:alt': t.meta.ogAlt },
  };
}

/*
 * The theme is resolved before the first paint. Without this the page renders
 * in the OS theme and then snaps to the stored choice, which is a white flash
 * for anyone who chose dark. It is deliberately tiny and dependency-free, and
 * it fails closed: any error leaves the OS preference in charge.
 */
const themeScript = `try{var t=localStorage.getItem('waves-theme');if(t==='dark'||t==='light'){document.documentElement.classList.add('theme-'+t)}}catch(e){}`;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <html
      lang={htmlLang[locale]}
      dir={dirFor(locale)}
      className={`${grotesk.variable} ${departure.variable} ${plex.variable} ${scriptFont[locale]}`}
      suppressHydrationWarning
    >
      <head>
        {/* Our own literal, not user input. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
