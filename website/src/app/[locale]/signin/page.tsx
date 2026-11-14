import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Apple } from '@/components/icons';
import { Wordmark } from '@/components/logo';
import { Container } from '@/components/ui';
import { isLocale, locales } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { appHost, signInHref } from '@/lib/signin';
import { pageMetadata, site } from '@/lib/site';

/**
 * Sign-in on the marketing site, finished on the app.
 *
 * The two sites are different origins, so a session cannot be shared and the
 * app deliberately refuses tokens arriving in a URL (PKCE). This page is the
 * front door only: it holds no credentials and calls no auth API. Google and
 * Apple are links that make the app start the provider sign-in; the email form
 * is a plain GET that opens the app's own sign-in with the address filled in.
 */

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getDictionary(locale);
  return {
    ...pageMetadata({
      locale,
      path: '/signin',
      title: t.signin.title,
      description: t.signin.metaDescription,
    }),
    robots: { index: false },
  };
}

const field =
  'h-12 w-full rounded-lg border border-line-strong bg-surface px-4 text-base text-ink placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const social =
  'flex h-12 w-full items-center justify-center gap-3 rounded-lg border border-line-strong bg-surface text-[0.9375rem] font-medium text-ink transition-colors hover:bg-chip focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = (await getDictionary(locale)).signin;

  return (
    <>
      <header className="border-b border-line">
        <Container className="flex h-16 items-center justify-between">
          <Link href={`/${locale}`} aria-label={site.name}>
            <Wordmark />
          </Link>
        </Container>
      </header>

      <main id="main" tabIndex={-1} className="py-12 sm:py-20">
        <Container className="max-w-[25rem]">
          <h1 className="display text-[2rem] text-ink sm:text-[2.5rem]">{t.title}</h1>
          <p className="mt-3 text-[0.9375rem] leading-[1.6] text-ink-2">{t.lead}</p>

          <form method="get" action={site.appUrl} className="mt-8 space-y-3">
            <input type="hidden" name="signin" value="email" />
            <label htmlFor="signin-email" className="block text-sm font-medium text-ink">
              {t.emailLabel}
            </label>
            <input
              id="signin-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              dir="ltr"
              placeholder={t.emailPlaceholder}
              className={`${field} text-start`}
            />
            <button
              type="submit"
              className="h-12 w-full rounded-lg bg-accent text-[0.9375rem] font-semibold text-accent-ink transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {t.email}
            </button>
          </form>

          <div className="my-6 flex items-center gap-3 text-sm text-ink-3" aria-hidden="true">
            <span className="h-px flex-1 bg-line" />
            {t.or}
            <span className="h-px flex-1 bg-line" />
          </div>

          <div className="space-y-3">
            <a href={signInHref(site.appUrl, 'google')} className={social}>
              <GoogleMark />
              {t.google}
            </a>
            <a href={signInHref(site.appUrl, 'apple')} className={social}>
              <Apple className="h-[18px] w-[18px]" aria-hidden="true" />
              {t.apple}
            </a>
          </div>

          <p className="mt-6 text-[0.8125rem] leading-[1.6] text-ink-3">
            {t.handoff.replace('{host}', appHost(site.appUrl))}
          </p>
        </Container>
      </main>
    </>
  );
}

function GoogleMark() {
  return (
    <svg width={18} height={18} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
    </svg>
  );
}
