import Image from 'next/image';
import Link from 'next/link';
import { languageNames, locales } from '@/i18n/config';

import {
  CHECKED_MONTH,
  CHECKED_ON,
  competitors,
  compareSlug,
  disclaimer,
  type Cell,
  type Competitor,
} from '@/content/competitors';
import type { Dictionary } from '@/i18n/dictionaries';
import { absoluteUrl, site } from '@/lib/site';
import { DownloadBanner } from './download-banner';
import { ArrowRight } from './icons';
import { WaveMark, Wordmark } from './logo';
import { SiteFooter } from './site-footer';
import { Container } from './ui';

const LOCALE = 'en' as const;

/** The compare pages are English only, so every link on them points at /en. */
export const comparePageUrl = (path: string) => absoluteUrl(`/${LOCALE}${path}`);

function Mark({ value }: { value: Cell }) {
  if (value === true)
    return (
      <span
        role="img"
        aria-label="Yes"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 font-semibold text-white"
      >
        ✓
      </span>
    );
  if (value === false)
    return (
      <span
        role="img"
        aria-label="No"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-600 font-semibold text-white"
      >
        −
      </span>
    );
  return <>{value}</>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-[1.25rem] font-semibold tracking-[-0.02em] text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Points({ items }: { items: { title: string; body: string }[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li
          key={item.title}
          className="rounded-xl bg-surface px-4 py-3 shadow-[var(--w-shadow-sm)]"
        >
          <h3 className="text-[0.95rem] font-semibold text-ink">{item.title}</h3>
          <p className="mt-1 text-[0.9rem] leading-[1.6] text-ink-2">{item.body}</p>
        </li>
      ))}
    </ul>
  );
}

/** FAQPage, BreadcrumbList and the Waves app, as one graph. */
export function compareJsonLd(opts: {
  path: string;
  name: string;
  crumbs: { name: string; path: string }[];
  faq: Competitor['faq'];
  description: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'MobileApplication',
        name: site.name,
        applicationCategory: 'FinanceApplication',
        applicationSubCategory: 'Expense sharing',
        operatingSystem: 'Android, iOS, Web',
        description: opts.description,
        url: absoluteUrl(`/${LOCALE}`),
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: opts.crumbs.map((crumb, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: crumb.name,
          item: comparePageUrl(crumb.path),
        })),
      },
      {
        '@type': 'FAQPage',
        mainEntity: opts.faq.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      },
    ],
  };
}

/** The chrome every compare page shares: header, last-checked line, CTA, footer. */
export function CompareShell({
  t,
  children,
  jsonLd,
}: {
  t: Dictionary;
  children: React.ReactNode;
  jsonLd: object;
}) {
  return (
    <>
      <script
        type="application/ld+json"
        // Our own copy, not user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:start-4 focus-visible:top-4 focus-visible:z-[60] focus-visible:inline-flex focus-visible:h-11 focus-visible:items-center focus-visible:rounded-md focus-visible:bg-ink focus-visible:px-4 focus-visible:text-sm focus-visible:font-medium focus-visible:text-bg"
      >
        {t.nav.skip}
      </a>
      <header className="border-b border-divider bg-paper">
        <Container className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 py-3">
          <Link href="/en" aria-label="Waves home">
            <Wordmark />
          </Link>
          <nav
            aria-label="Primary"
            className="order-3 flex w-full items-center justify-between gap-4 text-sm sm:order-none sm:w-auto sm:justify-start sm:gap-7"
          >
            <Link href="/en#features" className="py-2 text-ink-2 hover:text-blue">
              Features
            </Link>
            <Link href="/en#how" className="py-2 text-ink-2 hover:text-blue">
              How it works
            </Link>
            <Link
              href="/en/compare"
              aria-current="page"
              className="border-b-2 border-blue py-2 font-medium text-blue"
            >
              Compare
            </Link>
            <Link href="/en#pricing" className="py-2 text-ink-2 hover:text-blue">
              Pricing
            </Link>
          </nav>
          <div className="flex items-center gap-4">
            <details className="relative">
              <summary
                aria-label="Choose language, English selected"
                className="cursor-pointer rounded-sm py-2 text-sm text-ink-2"
              >
                EN
              </summary>
              <ul className="absolute right-0 z-20 mt-2 w-40 rounded-md border border-line bg-paper p-2 shadow-lg">
                {locales.map((locale) => (
                  <li key={locale}>
                    <Link
                      href={`/${locale}`}
                      lang={locale}
                      hrefLang={locale}
                      className="block rounded-sm px-3 py-2 hover:bg-chip"
                    >
                      {languageNames[locale].endonym}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
            <a
              href={site.appUrl}
              className="inline-flex min-h-10 items-center rounded-sm bg-[#1d5ddd] px-4 text-sm font-semibold text-white hover:bg-[#174bb5]"
            >
              Get started
            </a>
          </div>
        </Container>
      </header>
      <main id="main" tabIndex={-1} className="bg-paper pb-14 pt-5 sm:pt-7">
        <Container>{children}</Container>
      </main>
      <DownloadBanner t={t.cta} stores={t.stores} />
      <SiteFooter
        locale={LOCALE}
        t={t.footer}
        legal={t.legal}
        appUrl={site.appUrl}
        anchorBase={`/${LOCALE}`}
      />
    </>
  );
}

export function CompareBody({
  c,
  h1,
  intro,
  crumbs,
}: {
  c: Competitor;
  h1: string;
  intro?: string;
  crumbs: { name: string; href?: string }[];
}) {
  const others = competitors.filter((o) => o.slug !== c.slug);
  const ticks = c.heroTicks ?? [
    'Unlimited people and expenses',
    'Free forever plan',
    'Settle with UPI',
    'Works globally',
  ];
  const stages =
    c.slug === 'splitwise'
      ? [[c.move.steps[0]], [c.move.steps[1], c.move.steps[2]], [c.move.steps[3]]]
      : c.move.steps.map((step) => [step]);
  const stageTitles =
    c.slug === 'splitwise'
      ? [`Export from ${c.name}`, 'Upload to Waves', 'Check your balances']
      : ['Start with your group', 'Bring it into Waves', 'Continue in Waves'];
  const buttonClass =
    'inline-flex min-h-12 items-center justify-center gap-2 rounded-sm px-6 text-sm font-semibold transition-colors';

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[0.8rem] text-ink-3">
        <ol className="flex flex-wrap items-center gap-1.5">
          {crumbs.map((crumb, i) => (
            <li key={crumb.name} className="flex items-center gap-1.5">
              {i > 0 ? <span aria-hidden="true">/</span> : null}
              {crumb.href ? (
                <Link href={crumb.href} className="hover:text-ink">
                  {crumb.name}
                </Link>
              ) : (
                <span aria-current="page">{crumb.name}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <section className="relative mt-5 grid items-center gap-8 overflow-hidden rounded-xl bg-[radial-gradient(ellipse_at_85%_40%,rgb(31_99_242_/_0.09),transparent_65%)] pt-6 lg:grid-cols-[1.05fr_1fr] lg:gap-4 lg:pt-10">
        <div className="relative z-10 pb-6 lg:pb-12">
          <p className="text-xs font-semibold tracking-[0.18em] text-blue uppercase">
            Waves vs {c.name}
          </p>
          <h1 className="mt-4 text-[clamp(2.5rem,5vw,4rem)] leading-[1.04] font-bold tracking-[-0.05em] text-ink">
            <span className="sr-only">{h1}. </span>Split expenses.
            <br />
            <span className="text-blue">Not your freedom.</span>
          </h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-ink-2">
            Unlimited people and expenses for free. Settle with UPI, scan receipts, and keep
            everyone in sync.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href={site.appUrl}
              className={`${buttonClass} bg-[#1d5ddd] text-white shadow-lg shadow-blue/10 hover:bg-[#174bb5]`}
            >
              Try Waves free <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="#table"
              className={`${buttonClass} border border-line-strong text-ink hover:bg-chip`}
            >
              See comparison <span aria-hidden="true">↓</span>
            </a>
          </div>
          <TickList items={ticks} />
        </div>
        <div className="relative mx-auto w-full max-w-[525px] self-end pt-8">
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-12 bottom-4 rounded-[45%] bg-blue/10"
          />
          <Image
            src="/home/app-screens.webp"
            width={525}
            height={510}
            sizes="(max-width: 1024px) 90vw, 48vw"
            preload
            alt="Two Waves phone screens showing shared expense groups and a trip’s balances with a settle-up button"
            className="relative h-auto w-full rounded-t-xl"
          />
          {c.heroChip ? (
            <div className="absolute top-0 right-2 flex items-center gap-3 rounded-md border border-line bg-paper px-4 py-3 shadow-lg">
              <span aria-hidden="true" className="text-2xl text-blue">
                ϟ
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">{c.heroChip}</p>
                <p className="text-xs text-ink-2">Split as much as you want</p>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section id="table" aria-labelledby="comparison-heading" className="pt-10 sm:pt-14">
        <div className="mb-6 grid items-end gap-6 sm:grid-cols-[1.3fr_1fr]">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-blue">COMPARISON</p>
            <h2
              id="comparison-heading"
              className="mt-2 text-4xl font-bold tracking-[-0.04em] text-ink sm:text-5xl"
            >
              See the difference
            </h2>
            <p className="mt-3 max-w-lg leading-relaxed text-ink-2">
              Compare the features, free plans and ways to settle.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <WaveMark className="mx-auto mb-2 h-10 w-10" />
              <p className="text-lg font-bold text-ink">Waves</p>
              <p className="text-xs text-ink-2">Your shared expenses, together.</p>
            </div>
            <div className="flex flex-col justify-end">
              <p className="text-lg font-bold text-ink">{c.name}</p>
              <p className="mt-1 text-xs text-ink-2">Compared from public sources.</p>
            </div>
          </div>
        </div>
        <div
          role="region"
          aria-label={`Waves and ${c.name} feature comparison`}
          tabIndex={0}
          className="overflow-x-auto rounded-md border border-line bg-surface"
        >
          <table className="w-full min-w-[620px] table-fixed border-collapse text-start text-[0.8rem] leading-[1.5] sm:text-[0.86rem]">
            <caption className="sr-only">Waves compared with {c.name}</caption>
            <thead>
              <tr className="border-b border-line bg-chip text-start">
                <th scope="col" className="w-[36%] px-5 py-4 text-start font-semibold text-ink">
                  Feature
                </th>
                <th
                  scope="col"
                  className="w-[32%] bg-blue/10 px-5 py-4 text-start font-semibold text-ink"
                >
                  Waves
                </th>
                <th scope="col" className="w-[32%] px-5 py-4 text-start font-semibold text-ink">
                  {c.name}
                </th>
              </tr>
            </thead>
            <tbody>
              {c.rows.map((row) => (
                <tr
                  id={/UPI|Settling up/.test(row.feature) ? 'settle' : undefined}
                  key={row.feature}
                  className="border-b border-divider align-top last:border-0"
                >
                  <th scope="row" className="px-5 py-4 text-start font-medium text-ink">
                    {row.feature}
                  </th>
                  <td className="bg-blue/10 px-5 py-4 break-words text-ink">
                    <Mark value={row.waves} />
                  </td>
                  <td className="px-5 py-4 break-words text-ink-2">
                    <Mark value={row.them} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 rounded-sm bg-blue/5 px-4 py-3 text-xs leading-relaxed text-ink-2">
          {disclaimer}
        </p>
        <p className="mt-3 text-xs text-ink-3">
          Last checked {CHECKED_MONTH}. Scroll horizontally on smaller screens to compare all
          columns.
        </p>
      </section>

      <section
        aria-label="Make more of your shared expenses"
        className="mt-7 grid gap-4 md:grid-cols-3"
      >
        <FeatureCard
          symbol="∞"
          title="Split without limits"
          body="People, expenses and currencies are unlimited on Waves Free."
          href="#table"
          label="Explore the comparison"
        />
        <FeatureCard
          symbol="↗"
          title="Pay your way"
          body="Waves opens your UPI app with the exact amount. Waves never holds money."
          href="#settle"
          label="See how settling works"
        />
        <FeatureCard
          symbol="▤"
          title="Bring your history"
          body={
            c.slug === 'splitwise'
              ? 'Import a Splitwise CSV via Settings > Your data > Import from Splitwise. Review the preview and check your balances.'
              : c.move.steps[0]
          }
          href="#move"
          label="See the move guide"
        />
      </section>

      <section
        id="move"
        aria-labelledby="move-heading"
        className="mt-7 rounded-md bg-blue/5 p-5 sm:p-6"
      >
        <h2 id="move-heading" className="text-2xl font-bold tracking-tight text-ink">
          Switch in 3 simple steps
        </h2>
        <p className="mt-1 text-sm text-ink-2">{c.move.title}</p>
        <ol className="mt-6 grid gap-6 md:grid-cols-3">
          {stages.map((steps, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue/10 text-sm font-semibold text-blue">
                {i + 1}
              </span>
              <div>
                <h3 className="text-sm font-semibold text-ink">{stageTitles[i]}</h3>
                {steps.map((step) => (
                  <p key={step} className="mt-2 text-sm leading-relaxed text-ink-2">
                    {step}
                  </p>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="relative mt-5 grid overflow-hidden rounded-lg bg-[#102442] px-6 pt-9 text-white sm:px-9 lg:grid-cols-[1.3fr_1fr]">
        <div className="relative z-10 pb-9">
          <p className="text-xs tracking-[0.18em] text-blue-200 uppercase">
            Ready for your next shared expense?
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Make the switch to Waves
          </h2>
          <p className="mt-3 text-sm text-slate-200">
            Keep your groups, expenses and balances together.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href={site.appUrl}
              className={`${buttonClass} bg-white text-[#102442] hover:bg-blue-100`}
            >
              Try Waves free <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="#table"
              className={`${buttonClass} border border-slate-400 text-white hover:bg-white/10`}
            >
              See comparison <span aria-hidden="true">↓</span>
            </a>
          </div>
          <TickList items={ticks} dark />
        </div>
        <div className="relative mx-auto h-64 w-full max-w-sm overflow-hidden lg:h-full">
          <Image
            src="/home/app-screens.webp"
            width={525}
            height={510}
            sizes="(max-width: 1024px) 380px, 35vw"
            alt="Waves app displaying expense groups and shared balances"
            className="h-auto w-full"
          />
        </div>
      </section>

      <div className="mx-auto max-w-3xl">
        <Section title="Why people switch to Waves">
          <Points items={c.switchReasons} />
        </Section>
        {intro ? <p className="mt-6 leading-relaxed text-ink-2">{intro}</p> : null}
        <div className="mt-5 space-y-3">
          {c.summary.map((line) => (
            <p key={line} className="leading-relaxed text-ink-2">
              {line}
            </p>
          ))}
        </div>
        <Section title={`Where ${c.name} is better`}>
          <Points items={c.theyAreBetter} />
        </Section>
        <Section title="Frequently asked questions">
          <div className="space-y-3">
            {c.faq.map((item) => (
              <details
                key={item.q}
                className="group rounded-xl bg-surface shadow-[var(--w-shadow-sm)]"
              >
                <summary className="cursor-pointer list-none px-4 py-3 text-[0.93rem] font-medium text-ink [&::-webkit-details-marker]:hidden">
                  {item.q}
                </summary>
                <p className="px-4 pb-3 text-[0.9rem] leading-[1.6] text-ink-2">{item.a}</p>
              </details>
            ))}
          </div>
        </Section>

        <Section title="Compare Waves with">
          <ul className="flex flex-wrap gap-2">
            {others.map((o) => (
              <li key={o.slug}>
                <Link
                  href={`/${LOCALE}/compare/${compareSlug(o)}`}
                  className="inline-flex min-h-9 items-center rounded-full bg-chip px-3 text-[0.82rem] text-ink-2 hover:text-ink"
                >
                  {o.name}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3">
            <Link
              href={`/${LOCALE}/compare`}
              className="inline-flex items-center gap-1.5 text-[0.88rem] font-semibold text-accent hover:underline"
            >
              All comparisons
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </p>
        </Section>

        <Section title="Sources">
          <ul className="space-y-1 text-[0.82rem] text-ink-2">
            {c.sources.map((s) => (
              <li key={s.url}>
                <a
                  href={s.url}
                  rel="noopener noreferrer nofollow"
                  className="underline decoration-line-strong underline-offset-4 hover:decoration-accent"
                >
                  {s.label}
                </a>{' '}
                <span className="text-ink-3">(checked {CHECKED_ON})</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[0.78rem] leading-[1.6] text-ink-3">{disclaimer}</p>
          <p className="mt-1 text-[0.78rem] leading-[1.6] text-ink-3">
            Waves details: free plan and Pro features as described in the app and on this site;
            Pro-only items are marked. See something out of date? Write to{' '}
            <a className="underline" href={`mailto:${site.supportEmail}`}>
              {site.supportEmail}
            </a>
            .
          </p>
        </Section>
      </div>
    </>
  );
}

export function TickList({ items, dark = false }: { items: string[]; dark?: boolean }) {
  return (
    <ul
      className={`mt-7 flex flex-wrap gap-x-5 gap-y-3 text-xs ${dark ? 'text-slate-200' : 'text-ink-2'}`}
    >
      {items.map((item) => (
        <li key={item} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${dark ? 'border-slate-400 text-white' : 'border-blue/30 text-blue'}`}
          >
            ✓
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

function FeatureCard({
  symbol,
  title,
  body,
  href,
  label,
}: {
  symbol: string;
  title: string;
  body: string;
  href: string;
  label: string;
}) {
  return (
    <article className="flex flex-col rounded-md border border-line bg-surface p-5">
      <span
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-full bg-blue/10 text-3xl text-blue"
      >
        {symbol}
      </span>
      <h2 className="mt-4 text-xl font-bold tracking-tight text-ink">{title}</h2>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-2">{body}</p>
      <a
        href={href}
        className="mt-5 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-blue hover:underline"
      >
        {label}
        <ArrowRight className="h-4 w-4" />
      </a>
    </article>
  );
}
