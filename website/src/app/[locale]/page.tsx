import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Audience } from '@/components/audience';
import { Comparison } from '@/components/comparison';
import { Currencies } from '@/components/currencies';
import { Custody } from '@/components/custody';
import { Faq } from '@/components/faq';
import { Features } from '@/components/features';
import { FinalCta } from '@/components/final-cta';
import { Hero } from '@/components/hero';
import { HowItWorks } from '@/components/how-it-works';
import { Pricing } from '@/components/pricing';
import { PrivacySection } from '@/components/privacy-section';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { currencyRows } from '@/lib/currencies';
import { absoluteUrl, localeAlternates, site } from '@/lib/site';

/**
 * `/{locale}/index.md` is a twin of *this* page and no other, so this is the
 * only route that may advertise it. Declaring it on the shared layout had
 * /privacy and /terms pointing at the home document as their own alternate
 * representation, which is a different claim and a false one. The HTTP `Link:`
 * header half is scoped the same way, in proxy.ts.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  return {
    alternates: {
      ...localeAlternates(locale),
      types: { 'text/markdown': absoluteUrl(`/${locale}/index.md`) },
    },
  };
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const t = await getDictionary(locale);

  /*
   * `SoftwareApplication` and `Organization` are the two types that still earn
   * their keep — the first for the app itself, the second because it is the
   * block search engines and language models use to resolve "Waves" to an
   * entity. `FAQPage` stays because it costs nothing, but Google retired FAQ
   * rich results in May 2026, so it is not doing SEO work any more.
   *
   * There is deliberately no `aggregateRating`: it must reflect real reviews,
   * and inventing one is a manual-action risk as well as a lie. The price is
   * zero and the currency is the locale's, not one country's.
   */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${site.url}#org`,
        name: site.name,
        url: site.url,
        email: site.supportEmail,
      },
      {
        '@type': 'MobileApplication',
        name: site.name,
        applicationCategory: 'FinanceApplication',
        applicationSubCategory: 'Expense sharing',
        operatingSystem: 'Android, iOS, Web',
        description: t.meta.description,
        url: absoluteUrl(`/${locale}`),
        inLanguage: locale,
        publisher: { '@id': `${site.url}#org` },
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: t.meta.priceCurrency,
        },
      },
      {
        '@type': 'FAQPage',
        mainEntity: t.faq.items.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      },
    ],
  };

  return (
    <>
      {/* A scroll animation must never be the reason a page is empty. */}
      <noscript>
        <style>{`.reveal{opacity:1;transform:none}`}</style>
      </noscript>

      <script
        type="application/ld+json"
        // The payload is our own copy, not user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <SiteHeader locale={locale} nav={t.nav} appUrl={site.appUrl} />

      {/* The skip link targets this, so it has to be able to take focus —
          without the tabindex the jump lands on <body> and nothing changes. */}
      <main id="main" tabIndex={-1}>
        <Hero t={t.hero} banner={t.banner} appUrl={site.appUrl} />
        <Custody t={t.custody} />
        <Features t={t.features} visuals={t.visuals} />
        <Currencies t={t.currencies} rows={currencyRows(locale)} />
        <HowItWorks t={t.how} />
        <Audience t={t.audience} />
        <PrivacySection t={t.privacy} />
        {/* Between "here is what we hold" and "here is what it costs" — the
            visitor has the product in their head by now and the next honest
            question is what else they could be using instead. */}
        <Comparison t={t.comparison} locale={locale} />
        <Pricing t={t.pricing} appUrl={site.appUrl} />
        <Faq t={t.faq} />
        <FinalCta t={t.cta} stores={t.hero.stores} appUrl={site.appUrl} />
      </main>

      <SiteFooter locale={locale} t={t.footer} appUrl={site.appUrl} />
    </>
  );
}
