import Link from 'next/link';

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
import { Wordmark } from './logo';
import { SiteFooter } from './site-footer';
import { Container, Kicker } from './ui';

const LOCALE = 'en' as const;

/** The compare pages are English only, so every link on them points at /en. */
export const comparePageUrl = (path: string) => absoluteUrl(`/${LOCALE}${path}`);

function Mark({ value }: { value: Cell }) {
  if (value === true)
    return (
      <span role="img" aria-label="Yes" className="font-semibold text-accent">
        ✓
      </span>
    );
  if (value === false)
    return (
      <span role="img" aria-label="No" className="text-ink-3">
        ✗
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
      <header className="border-b border-line">
        <Container className="flex h-16 items-center justify-between">
          <Link href={`/${LOCALE}`} aria-label={site.name}>
            <Wordmark />
          </Link>
          <Link
            href={`/${LOCALE}/compare`}
            className="rounded-xs text-sm text-ink-2 transition-colors hover:text-ink"
          >
            All comparisons
          </Link>
        </Container>
      </header>
      <main id="main" tabIndex={-1} className="py-12 sm:py-16">
        <Container className="max-w-3xl">{children}</Container>
      </main>
      <DownloadBanner t={t.cta} stores={t.stores} />
      <SiteFooter locale={LOCALE} t={t.footer} legal={t.legal} appUrl={site.appUrl} />
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

      <Kicker className="mt-6">Last checked {CHECKED_MONTH}</Kicker>
      <h1 className="mt-2 text-[2rem] font-semibold tracking-[-0.035em] text-ink sm:text-[2.6rem]">
        {h1}
      </h1>
      {intro ? <p className="mt-3 text-[1rem] leading-[1.65] text-ink-2">{intro}</p> : null}
      <div className="mt-3 space-y-2">
        {c.summary.map((line) => (
          <p key={line} className="text-[1rem] leading-[1.65] text-ink-2">
            {line}
          </p>
        ))}
      </div>

      <div className="mt-8 overflow-hidden rounded-xl border border-line bg-surface">
        <table className="w-full table-fixed border-collapse text-start text-[0.8rem] leading-[1.5] sm:text-[0.86rem]">
          <caption className="sr-only">Waves compared with {c.name}</caption>
          <thead>
            <tr className="border-b border-line bg-chip text-start">
              <th scope="col" className="w-[26%] px-3 py-2.5 text-start font-semibold text-ink">
                Feature
              </th>
              <th scope="col" className="w-[37%] px-3 py-2.5 text-start font-semibold text-ink">
                Waves
              </th>
              <th scope="col" className="w-[37%] px-3 py-2.5 text-start font-semibold text-ink">
                {c.name}
              </th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((row) => (
              <tr key={row.feature} className="border-b border-divider align-top last:border-0">
                <th scope="row" className="px-3 py-2.5 text-start font-medium text-ink">
                  {row.feature}
                </th>
                <td className="px-3 py-2.5 break-words text-ink-2">
                  <Mark value={row.waves} />
                </td>
                <td className="px-3 py-2.5 break-words text-ink-2">
                  <Mark value={row.them} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Section title="Why people switch to Waves">
        <Points items={c.switchReasons} />
      </Section>
      <Section title={`Where ${c.name} is better`}>
        <Points items={c.theyAreBetter} />
      </Section>
      <Section title={c.move.title}>
        <ol className="list-decimal space-y-2 ps-5 text-[0.93rem] leading-[1.6] text-ink-2">
          {c.move.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
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
    </>
  );
}
