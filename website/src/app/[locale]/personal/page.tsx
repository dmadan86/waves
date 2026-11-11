import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { DownloadBanner } from '@/components/download-banner';
import { FilmTabs } from '@/components/film-tabs';
import { Check } from '@/components/icons';
import { LazyVideo } from '@/components/lazy-video';
import {
  BudgetMock,
  LoanMock,
  PersonalDemo,
  ReceiptMock,
  RecurringMock,
  SmsMock,
  SpendingMock,
  StatementMock,
  TransactionsMock,
  VoiceMock,
} from '@/components/personal-mocks';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { Button, Container, Kicker } from '@/components/ui';
import { htmlLang, isLocale, locales } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { absoluteUrl, site } from '@/lib/site';

/**
 * Waves for your own money. Every claim is read from the shipped app:
 *   - spending by category, month picker, pie / bars: app/personal/spending.tsx,
 *     packages/core/src/personal/spending.ts
 *   - monthly budgets (overall + per category): app/personal/budgets.tsx,
 *     components/CategoryBudgets.tsx, core personal/{budgetContext,compute}.ts
 *   - loans lent / borrowed, shared with the other person: app/personal/loans.tsx,
 *     LoanPersonPicker.tsx, core personal/syncedLoan.ts
 *   - recurring rules (weekly / twice a month / monthly / yearly):
 *     app/personal/recurring.tsx, core personal/frequency.ts, types.ts (Cadence)
 *   - transactions and sources: app/personal/{transactions,source/[id]}.tsx,
 *     core personal/sources.ts
 *   - bank messages: pasting works on every phone; reading the inbox is Android
 *     only, on-device, behind a build flag and a server flag:
 *     apps/mobile/src/lib/smsFeature.ts, smsReader.ts, core sms/*
 *   - statement import: Pro 30 files a month, Free 2 on-device previews:
 *     core billing/plans.ts (PRO_MONTHLY_STATEMENT_IMPORTS, FREE_MONTHLY_STATEMENT_PREVIEWS)
 *   - receipt scans 20 (Free) / 300 (Pro) a month: core billing/plans.ts
 *   - private ledger, owner-scoped, server relays opaque rows, local copy sealed at
 *     rest: packages/db schema (personal_records), supabase/functions/sync,
 *     docs/rewarded-coins-economy.md (A48), apps/mobile/src/lib/personalReceipt.ts
 * Prices are deliberately absent: the store sets them per country.
 * Film files live in infra/art/videos, served from R2 (see LazyVideo); a film
 * whose file is not there is simply left out, never an empty box.
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
  const p = t.personalPage;
  const url = absoluteUrl(`/${locale}/personal`);
  return {
    title: p.metaTitle,
    description: p.metaDescription,
    alternates: {
      canonical: url,
      languages: {
        ...Object.fromEntries(locales.map((l) => [htmlLang[l], absoluteUrl(`/${l}/personal`)])),
        'x-default': absoluteUrl('/en/personal'),
      },
    },
    openGraph: {
      type: 'website',
      siteName: site.name,
      title: p.metaTitle,
      description: p.metaDescription,
      url,
      locale: htmlLang[locale],
    },
    twitter: { card: 'summary_large_image', title: p.metaTitle, description: p.metaDescription },
  };
}

const card = 'rounded-2xl bg-surface shadow-[var(--w-shadow-card)]';
const h2 = 'text-[1.35rem] font-bold tracking-[-0.025em] text-ink sm:text-[1.6rem]';

/**
 * Films published to R2 (infra/art/videos). A film not listed leaves its slot
 * out. A list, not a file check: Vercel builds from website/ alone.
 * TODO: add 'transactions' once infra/art/publish.sh has uploaded personal-transactions.
 */
const PUBLISHED = new Set(
  ['hero', 'spending', 'voice', 'receipt', 'sms', 'statement', 'budgets', 'recurring', 'loans'].map(
    (n) => `personal-${n}`,
  ),
);
const hasFilm = (name: string) => PUBLISHED.has(name);

export default async function PersonalPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getDictionary(locale);
  const p = t.personalPage;
  const m = t.personalMock;

  const mocks: Record<string, React.ReactNode> = {
    spending: <SpendingMock m={m} />,
    budgets: <BudgetMock m={m} />,
    loans: <LoanMock m={m} />,
    recurring: <RecurringMock m={m} />,
    transactions: <TransactionsMock m={m} />,
    sms: <SmsMock m={m} />,
    statement: <StatementMock m={m} />,
    voice: <VoiceMock m={m} />,
    receipt: <ReceiptMock m={m} />,
  };
  const filmName = (id: string) => `personal-${id}`;
  const tabs = p.films.tabs.filter((f) => hasFilm(f.video));
  const heroFilm = hasFilm('personal-hero');

  return (
    <>
      <SiteHeader locale={locale} nav={t.nav} appUrl={site.appUrl} anchorBase={`/${locale}`} />

      <main id="main" tabIndex={-1}>
        <section className="agents-card border-b border-line/60 pt-24 pb-8 sm:pt-28 sm:pb-10">
          <Container>
            <div className="grid items-center gap-8 lg:grid-cols-[1.15fr_1fr]">
              <div className="min-w-0">
                <Kicker>{p.eyebrow}</Kicker>
                <h1 className="mt-2.5 text-balance text-[2rem] leading-[1.08] font-bold tracking-[-0.035em] text-ink sm:text-[2.8rem]">
                  {p.titleStart} <span className="text-accent">{p.titleAccent}</span>
                </h1>
                <p className="mt-3 max-w-xl text-pretty text-[0.98rem] leading-[1.6] text-ink-2">
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
              <PersonalDemo m={m} />
            </div>
            {heroFilm ? (
              <LazyVideo name="personal-hero" label={p.videos.hero} className="mt-8 aspect-video" />
            ) : null}
          </Container>
        </section>

        <Container className="py-8 sm:py-10">
          <h2 className="text-[1.15rem] font-bold tracking-[-0.02em] text-ink">{p.avail.title}</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-3">
            {p.avail.items.map((item) => (
              <li key={item.name} className={`${card} p-4`}>
                <p className="flex items-center justify-between gap-2 text-[0.95rem] font-semibold text-ink">
                  {item.name}
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold ${
                      item.status === 'all' ? 'bg-accent-wash text-accent' : 'bg-chip text-ink-2'
                    }`}
                  >
                    {p.avail.labels[item.status as keyof typeof p.avail.labels]}
                  </span>
                </p>
                <p className="mt-1.5 text-[0.86rem] leading-[1.5] text-ink-2">{item.text}</p>
              </li>
            ))}
          </ul>
        </Container>

        {tabs.length > 0 ? (
          <Container className="pb-10">
            <div id="films" className="scroll-mt-24">
              <h2 className={h2}>{p.films.title}</h2>
              <p className="mt-1.5 mb-4 text-[0.9rem] leading-[1.6] text-ink-2">{p.films.lead}</p>
              <FilmTabs films={tabs} label={p.films.label} square />
            </div>
          </Container>
        ) : null}

        <Container className="pb-10">
          <div id="features" className="scroll-mt-24 space-y-8">
            <h2 className={h2}>{p.featuresTitle}</h2>
            {p.features.map((f) => {
              const video = hasFilm(filmName(f.id)) ? filmName(f.id) : null;
              return (
                <article
                  key={f.id}
                  aria-labelledby={`f-${f.id}`}
                  className="border-t border-line/70 pt-6"
                >
                  <Kicker>{f.eyebrow}</Kicker>
                  <h3
                    id={`f-${f.id}`}
                    className="mt-1.5 text-balance text-[1.2rem] leading-[1.2] font-bold tracking-[-0.02em] text-ink sm:text-[1.4rem]"
                  >
                    {f.title}
                  </h3>
                  <p className="mt-2 max-w-2xl text-[0.92rem] leading-[1.6] text-ink-2">{f.body}</p>
                  <ul className="mt-3 space-y-1.5">
                    {f.points.map((pt) => (
                      <li key={pt} className="flex items-start gap-2 text-[0.88rem] text-ink">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                        {pt}
                      </li>
                    ))}
                  </ul>
                  {f.note ? <p className="mt-2 text-[0.8rem] text-ink-3">{f.note}</p> : null}
                  <div className="mt-4 grid items-start gap-4 sm:grid-cols-2">
                    {mocks[f.id]}
                    {video ? (
                      <LazyVideo
                        name={video}
                        label={p.videos[f.id as keyof typeof p.videos]}
                        className="aspect-square"
                      />
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </Container>

        <Container className="pb-10">
          <h2 className={h2}>{p.plansTitle}</h2>
          <p className="mt-1.5 max-w-3xl text-[0.9rem] leading-[1.6] text-ink-2">{p.plansLead}</p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {p.plans.map((plan) => (
              <li key={plan.name} className={`${card} p-4`}>
                <h3 className="text-[1rem] font-semibold text-ink">{plan.name}</h3>
                <ul className="mt-2 space-y-1.5">
                  {plan.points.map((pt) => (
                    <li key={pt} className="flex items-start gap-2 text-[0.86rem] text-ink-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                      {pt}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[0.8rem] text-ink-3">{p.plansNote}</p>
        </Container>

        <Container className="pb-10">
          <h2 id="privacy" className={`${h2} scroll-mt-24`}>
            {p.privacyTitle}
          </h2>
          <p className="mt-1.5 max-w-3xl text-[0.9rem] leading-[1.6] text-ink-2">{p.privacyLead}</p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {p.privacy.map((item) => (
              <li key={item.title} className={`${card} p-4`}>
                <h3 className="text-[0.95rem] font-semibold text-ink">{item.title}</h3>
                <p className="mt-1.5 text-[0.86rem] leading-[1.5] text-ink-2">{item.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[0.86rem]">
            <a href={`/${locale}/privacy`} className="font-semibold text-accent hover:underline">
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
