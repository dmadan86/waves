import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { DownloadBanner } from '@/components/download-banner';
import { Check } from '@/components/icons';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { Button, Container, Kicker } from '@/components/ui';
import { htmlLang, isLocale, locales } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { absoluteUrl, site } from '@/lib/site';

/**
 * Waves for a couple's or family's shared home money. Read from the app:
 * Split it / Share it (LedgerModeCards), household budget, shared bills,
 * income, Only me, Move to family, bill reminders (components/household/*,
 * MoveToFamily.tsx, i18n household / spacePrivacy).
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
  const p = (await getDictionary(locale)).homePage;
  return {
    title: p.metaTitle,
    description: p.metaDescription,
    alternates: {
      canonical: absoluteUrl(`/${locale}/family`),
      languages: {
        ...Object.fromEntries(locales.map((l) => [htmlLang[l], absoluteUrl(`/${l}/family`)])),
        'x-default': absoluteUrl('/en/family'),
      },
    },
  };
}

const card = 'rounded-2xl bg-surface shadow-[var(--w-shadow-card)]';
const h2 = 'text-[1.35rem] font-bold tracking-[-0.025em] text-ink sm:text-[1.6rem]';

export default async function HomeMoneyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getDictionary(locale);
  const p = t.homePage;

  return (
    <>
      <SiteHeader locale={locale} nav={t.nav} appUrl={site.appUrl} anchorBase={`/${locale}`} />

      <main id="main" tabIndex={-1}>
        <section className="agents-card border-b border-line/60 pt-24 pb-8 sm:pt-28 sm:pb-10">
          <Container>
            <div className="max-w-2xl">
              <Kicker>{p.eyebrow}</Kicker>
              <h1 className="display mt-2.5 text-balance text-[2rem] text-ink sm:text-[2.8rem]">
                {p.titleStart} <span className="text-accent">{p.titleAccent}</span>
              </h1>
              <p className="mt-3 text-pretty text-[0.98rem] leading-[1.6] text-ink-2">
                {p.subtitle}
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <Button href={`/${locale}#download`} size="lg">
                  {p.ctaPrimary}
                </Button>
                <Button href="#features" size="lg" variant="secondary" arrow={false}>
                  {p.ctaSecondary}
                </Button>
              </div>
            </div>
          </Container>
        </section>

        <Container className="py-8 sm:py-10">
          <h2 className={h2}>{p.modesTitle}</h2>
          <p className="mt-1.5 max-w-3xl text-[0.9rem] leading-[1.6] text-ink-2">{p.modesLead}</p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {p.modes.map((m) => (
              <li key={m.title} className={`${card} p-5`}>
                <h3 className="text-[1.05rem] font-semibold text-ink">{m.title}</h3>
                <p className="mt-1.5 text-[0.88rem] leading-[1.5] text-ink-2">{m.body}</p>
                <ul className="mt-3 space-y-1.5">
                  {m.points.map((pt) => (
                    <li key={pt} className="flex items-start gap-2 text-[0.86rem] text-ink">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                      {pt}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Container>

        <Container className="pb-10">
          <h2 id="features" className={`${h2} scroll-mt-24`}>
            {p.featuresTitle}
          </h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {p.features.map((f) => (
              <li key={f.title} className={`${card} p-4`}>
                <h3 className="text-[0.95rem] font-semibold text-ink">{f.title}</h3>
                <p className="mt-1.5 text-[0.86rem] leading-[1.5] text-ink-2">{f.body}</p>
              </li>
            ))}
          </ul>
        </Container>

        <Container className="pb-10">
          <h2 className="text-[1.15rem] font-bold tracking-[-0.02em] text-ink">{p.availTitle}</h2>
          <p className="mt-1.5 max-w-3xl text-[0.9rem] leading-[1.6] text-ink-2">{p.availText}</p>
        </Container>

        <Container className="pb-10">
          <h2 className={h2}>{p.privacyTitle}</h2>
          <p className="mt-1.5 max-w-3xl text-[0.9rem] leading-[1.6] text-ink-2">{p.privacyBody}</p>
          <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[0.86rem] font-semibold">
            <a href={`/${locale}/personal`} className="text-accent hover:underline">
              {p.personalLink}
            </a>
            <a href={`/${locale}/privacy`} className="text-accent hover:underline">
              {p.privacyLink}
            </a>
          </p>
        </Container>

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
