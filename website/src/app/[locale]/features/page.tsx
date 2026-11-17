import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AgentsBand } from '@/components/agents-band';
import { DownloadBanner } from '@/components/download-banner';
import { ExploreGrid } from '@/components/explore-grid';
import { OfflineBand } from '@/components/offline-band';
import { OpenSourceBand } from '@/components/open-source-band';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { Container, Kicker } from '@/components/ui';
import { VoiceBand } from '@/components/voice-band';
import { WearablesBand } from '@/components/wearables-band';
import { WhoFor } from '@/components/who-for';
import { htmlLang, isLocale, locales } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { absoluteUrl, site } from '@/lib/site';

/** The detail that used to sit on the home page: voice, offline, watch, AI assistant, open source. */
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
  const p = t.featuresPage;
  return {
    title: p.metaTitle,
    description: p.metaDescription,
    alternates: {
      canonical: absoluteUrl(`/${locale}/features`),
      languages: {
        ...Object.fromEntries(locales.map((l) => [htmlLang[l], absoluteUrl(`/${l}/features`)])),
        'x-default': absoluteUrl('/en/features'),
      },
    },
  };
}

export default async function FeaturesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getDictionary(locale);
  const p = t.featuresPage;

  return (
    <>
      <SiteHeader locale={locale} nav={t.nav} appUrl={site.appUrl} anchorBase={`/${locale}`} />

      <main id="main" tabIndex={-1}>
        <section className="agents-card border-b border-line/60 pt-24 pb-8 sm:pt-28 sm:pb-10">
          <Container>
            <Kicker>{p.eyebrow}</Kicker>
            <h1 className="display mt-2.5 text-balance text-[2.4rem] text-ink sm:text-[3.4rem]">
              {p.title}
            </h1>
            <p className="mt-3 max-w-2xl text-pretty text-[1rem] leading-[1.6] text-ink-2">
              {p.lead}
            </p>
          </Container>
        </section>
        <ExploreGrid t={t.explore} wearables={t.wearables} locale={locale} />
        <VoiceBand t={t.voice} />
        <OfflineBand t={t.offline} />
        <WearablesBand t={t.wearables} />
        <AgentsBand t={t.agents} locale={locale} />
        <WhoFor t={t.whoFor} locale={locale} />
        <OpenSourceBand t={t.openSource} />
        <DownloadBanner t={t.cta} stores={t.stores} />
      </main>

      <SiteFooter
        locale={locale}
        t={t.footer}
        legal={t.legal}
        appUrl={site.appUrl}
        anchorBase={`/${locale}`}
      />
    </>
  );
}
