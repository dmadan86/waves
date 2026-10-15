import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AgentsBand } from '@/components/agents-band';
import { DownloadBanner } from '@/components/download-banner';
import { Faq } from '@/components/faq';
import { FeatureStrip } from '@/components/feature-strip';
import { Hero } from '@/components/hero';
import { Moments } from '@/components/moments';
import { OfflineBand } from '@/components/offline-band';
import { Pricing } from '@/components/pricing';
import { PrivacyBand } from '@/components/privacy-band';
import { Showcase } from '@/components/showcase';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { Steps } from '@/components/steps';
import { VoiceBand } from '@/components/voice-band';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
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
      <script
        type="application/ld+json"
        // The payload is our own copy, not user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <SiteHeader locale={locale} nav={t.nav} appUrl={site.appUrl} />

      {/* The skip link targets this, so it has to be able to take focus —
          without the tabindex the jump lands on <body> and nothing changes. */}
      <main id="main" tabIndex={-1}>
        <Hero t={t.hero} stores={t.stores} />
        <FeatureStrip t={t.features} />
        <Steps t={t.how} />
        <Showcase t={t.showcase} />
        <Moments t={t.moments} />
        <OfflineBand t={t.offline} />
        <VoiceBand t={t.voice} />
        <AgentsBand t={t.agents} locale={locale} />
        <Pricing t={t.pricing} />
        <PrivacyBand t={t.privacy} locale={locale} />
        <Faq t={t.faq} />
        <DownloadBanner t={t.cta} stores={t.stores} />
      </main>

      <SiteFooter locale={locale} t={t.footer} legal={t.legal} appUrl={site.appUrl} />
    </>
  );
}
