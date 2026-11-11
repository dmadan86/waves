import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  ApprovalDemo,
  AllowanceMock,
  ApproveMock,
  AttendanceMock,
  TaskMock,
  BillMock,
  TicketMock,
  WagesMock,
} from '@/components/company-mocks';
import { FilmTabs } from '@/components/film-tabs';
import { CompanyContact, CompanyFaq, CompanySteps } from '@/components/company-sales';
import { DownloadBanner } from '@/components/download-banner';
import { LazyVideo } from '@/components/lazy-video';
import { RoleSwitcher } from '@/components/role-switcher';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { Check } from '@/components/icons';
import { Button, Container, Kicker } from '@/components/ui';
import { htmlLang, isLocale, locales } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { absoluteUrl, site } from '@/lib/site';

/**
 * Waves for companies. Every claim below is read from the shipped app, not
 * imagined:
 *   - roles, who may review / record advances / pay wages:
 *     packages/core/src/company/phase4.ts
 *   - expenses, bata (daily allowance), mileage (distance_rate), net-due maths:
 *     packages/core/src/company/index.ts + apps/mobile company-entry screens
 *   - attendance (tap cycles present / half / absent, approved leave shown, day, week
 *     and month views, mark all present, "n of total present", feeds the wage run) and
 *     tasks (assign to people, deadline, photos, #number, site, To do / Doing / Done /
 *     Blocked with a reason): core company/workday.ts, components/company/work/*
 *   - calendar, leave, holidays: CompanyCalendarSheets.tsx
 *   - estimates and bills, UPI QR for the amount due, "NOT a tax invoice - no
 *     GST": core company/documents.ts + billUpi.ts (so no GST claim here)
 *   - vendors, clients, inquiries, tickets: core company/{vendors,vendorOrders,
 *     clients,inquiries,tickets}.ts; sites and budgets: CompanySites.tsx
 *   - import (file, contacts, Google Sheet) and export (PDF, Excel):
 *     company-import.tsx, CompanyExport.tsx; storage packs: company-storage.tsx
 *   - AI assistant access (master switch, approval, revocable links):
 *     AgentAccessSection.tsx
 *   - availability: apps/mobile/src/lib/companiesEnabled.ts (off on iPhone). The
 *     web company routes (apps/web /c) are still on their feature branches, so
 *     the web app is shown as available (its pages were merging when this was written).
 * Plans and prices are deliberately absent: the extra-company price comes from
 * the store at purchase time.
 * Film files live in infra/art/videos, served from R2 (see LazyVideo).
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
  const p = t.companiesPage;
  const url = absoluteUrl(`/${locale}/companies`);
  return {
    title: p.metaTitle,
    description: p.metaDescription,
    alternates: {
      canonical: url,
      languages: {
        ...Object.fromEntries(locales.map((l) => [htmlLang[l], absoluteUrl(`/${l}/companies`)])),
        'x-default': absoluteUrl('/en/companies'),
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

/**
 * Films cut but not yet uploaded to R2: their slot stays empty so the page never
 * shows a broken video. TODO: empty this once infra/art/publish.sh has run.
 */
const NOT_UPLOADED = new Set(['companies-allowance']);

export default async function CompaniesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getDictionary(locale);
  const p = t.companiesPage;
  const m = t.companyMock;

  // wide: a 16:9 film (the films-tab cuts), shown at its own shape, not cropped square.
  const visuals: Record<string, { mock: React.ReactNode; video?: string; wide?: boolean }> = {
    approvals: { mock: <ApproveMock m={m} />, video: 'companies-approvals' },
    allowance: { mock: <AllowanceMock m={m} />, video: 'companies-allowance' },
    attendance: { mock: <AttendanceMock m={m} />, video: 'companies-attendance' },
    tasks: { mock: <TaskMock m={m} />, video: 'companies-tasks' },
    wages: { mock: <WagesMock m={m} />, video: 'companies-wages' },
    bills: { mock: <BillMock m={m} />, video: 'companies-bills' },
    tickets: { mock: <TicketMock m={m} />, video: 'companies-complaints', wide: true },
  };
  const filmOf: Record<string, string> = {
    approvals: 'approvals',
    bills: 'bills',
    tickets: 'complaints',
  };
  const videoLabel: Record<string, string> = {
    'companies-approvals': p.videos.approvals,
    'companies-wages': p.videos.wages,
    'companies-attendance': p.videos.attendance,
    'companies-tasks': p.videos.tasks,
    'companies-bills': p.videos.bills,
    'companies-allowance': p.videos.allowance,
    'companies-complaints': p.films.tabs.find((f) => f.id === 'complaints')?.alt ?? '',
  };

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
                  <Button href="#contact" size="lg" variant="secondary" arrow={false}>
                    {p.ctaSecondary}
                  </Button>
                </div>
              </div>
              <ApprovalDemo m={m} />
            </div>
            <LazyVideo name="companies-hero" label={p.videos.hero} className="mt-8 aspect-video" />
          </Container>
        </section>

        <Container className="py-8 sm:py-10">
          <h2 className="text-[1.15rem] font-bold tracking-[-0.02em] text-ink">{p.avail.title}</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-3">
            {p.avail.items.map((item) => {
              const label = p.avail.labels[item.status as keyof typeof p.avail.labels];
              const live = item.status === 'available';
              return (
                <li key={item.name} className={`${card} p-4`}>
                  <p className="flex items-center justify-between gap-2 text-[0.95rem] font-semibold text-ink">
                    {item.name}
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold ${
                        live ? 'bg-accent-wash text-accent' : 'bg-chip text-ink-2'
                      }`}
                    >
                      {label}
                    </span>
                  </p>
                  <p className="mt-1.5 text-[0.86rem] leading-[1.5] text-ink-2">{item.text}</p>
                </li>
              );
            })}
          </ul>
        </Container>

        <Container className="pb-10">
          <div id="films" className="scroll-mt-24">
            <h2 className="text-[1.35rem] font-bold tracking-[-0.025em] text-ink sm:text-[1.6rem]">
              {p.films.title}
            </h2>
            <p className="mt-1.5 mb-4 text-[0.9rem] leading-[1.6] text-ink-2">{p.films.lead}</p>
            <FilmTabs films={p.films.tabs} label={p.films.label} />
          </div>
        </Container>

        <Container className="pb-10">
          <div className="grid gap-8 lg:grid-cols-[22rem_1fr] lg:items-start lg:gap-10">
            <div className="lg:sticky lg:top-24">
              <h2 className="text-[1.35rem] font-bold tracking-[-0.025em] text-ink sm:text-[1.6rem]">
                {p.rolesTitle}
              </h2>
              <p className="mt-1.5 mb-4 text-[0.9rem] leading-[1.6] text-ink-2">{p.rolesLead}</p>
              <RoleSwitcher roles={p.roles} label={p.rolesLabel} />
            </div>

            <div id="features" className="scroll-mt-24 space-y-8">
              <h2 className="text-[1.35rem] font-bold tracking-[-0.025em] text-ink sm:text-[1.6rem]">
                {p.featuresTitle}
              </h2>
              {p.features.map((f) => {
                const v = visuals[f.id];
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
                    <p className="mt-2 max-w-2xl text-[0.92rem] leading-[1.6] text-ink-2">
                      {f.body}
                    </p>
                    <ul className="mt-3 space-y-1.5">
                      {f.points.map((pt) => (
                        <li key={pt} className="flex items-start gap-2 text-[0.88rem] text-ink">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                          {pt}
                        </li>
                      ))}
                    </ul>
                    {f.id === 'bills' ? (
                      <p className="mt-2 text-[0.8rem] text-ink-3">{p.billsNote}</p>
                    ) : null}
                    {filmOf[f.id] ? (
                      <a
                        href={`#film-${filmOf[f.id]}`}
                        className="mt-3 inline-block text-[0.86rem] font-semibold text-accent hover:underline"
                      >
                        {p.films.watch}
                      </a>
                    ) : null}
                    <div className="mt-4 grid items-start gap-4 sm:grid-cols-2">
                      {v.mock}
                      {v.video && !NOT_UPLOADED.has(v.video) ? (
                        <LazyVideo
                          name={v.video}
                          label={videoLabel[v.video]}
                          className={v.wide ? 'aspect-video' : 'aspect-square'}
                        />
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </Container>

        <Container className="pb-10">
          <h2 className="text-[1.35rem] font-bold tracking-[-0.025em] text-ink sm:text-[1.6rem]">
            {p.moreTitle}
          </h2>
          <p className="mt-1.5 max-w-3xl text-[0.9rem] leading-[1.6] text-ink-2">{p.moreLead}</p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {p.more.map((item) => (
              <li key={item.title} className={`${card} p-4`}>
                <h3 className="text-[0.95rem] font-semibold text-ink">{item.title}</h3>
                <p className="mt-1.5 text-[0.86rem] leading-[1.5] text-ink-2">{item.body}</p>
              </li>
            ))}
          </ul>
        </Container>

        <CompanySteps t={p.steps} />
        <CompanyFaq t={p.faq} />
        <CompanyContact t={p.contact} />
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
