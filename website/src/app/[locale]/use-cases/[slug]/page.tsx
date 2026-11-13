import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CompareShell, comparePageUrl, TickList } from '@/components/compare-page';
import { ReferralNote, TrustList } from '@/components/marketing-blocks';
import { StoreBadges } from '@/components/store-badges';
import { findUseCase, useCases } from '@/content/use-cases';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { socialMetadata } from '@/lib/compare-seo';
import { site } from '@/lib/site';
import { appNode, organizationNode } from '@/lib/structured-data';

export const dynamicParams = false;

export function generateStaticParams() {
  return useCases.map((u) => ({ locale: 'en', slug: u.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const u = findUseCase(slug);
  if (!u) return {};
  return socialMetadata({
    title: u.title,
    description: u.description,
    path: `/use-cases/${u.slug}`,
  });
}

export default async function UseCasePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const u = findUseCase(slug);
  if (!isLocale(locale) || locale !== 'en' || !u) notFound();
  const t = await getDictionary('en');
  const path = `/use-cases/${u.slug}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      organizationNode(),
      appNode({ description: u.description, url: comparePageUrl(path), priceCurrency: 'INR' }),
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { name: 'Waves', path: '' },
          { name: u.eyebrow, path },
        ].map((c, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: c.name,
          item: comparePageUrl(c.path),
        })),
      },
      {
        '@type': 'FAQPage',
        mainEntity: u.faq.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
  };
  const h2 = 'text-[1.25rem] font-semibold tracking-[-0.02em] text-ink';
  const card = 'rounded-xl bg-surface px-4 py-3 shadow-[var(--w-shadow-sm)]';

  return (
    <CompareShell t={t} jsonLd={jsonLd}>
      <article className="mx-auto max-w-3xl pt-4">
        <nav aria-label="Breadcrumb" className="text-[0.8rem] text-ink-3">
          <Link href="/en" className="hover:text-ink">
            Waves
          </Link>{' '}
          <span aria-hidden="true">/</span> <span aria-current="page">{u.eyebrow}</span>
        </nav>
        <p className="mt-6 text-xs font-semibold tracking-[0.18em] text-blue uppercase">
          {u.eyebrow}
        </p>
        <h1 className="display mt-3 text-[clamp(2rem,4.5vw,3.25rem)] text-ink">{u.h1}</h1>
        <p className="mt-4 text-base leading-relaxed text-ink-2">{u.intro}</p>
        <StoreBadges t={t.stores} className="mt-6" />
        <TickList
          items={[
            'Unlimited people and expenses',
            'Works offline',
            'Settle with any payment app',
            'Not a bank',
          ]}
        />

        <section className="mt-10" aria-labelledby="how-h">
          <h2 id="how-h" className={h2}>
            How it works
          </h2>
          <ol className="mt-3 space-y-3">
            {u.steps.map((s, i) => (
              <li key={s.title} className={card}>
                <h3 className="text-[0.95rem] font-semibold text-ink">
                  {i + 1}. {s.title}
                </h3>
                <p className="mt-1 text-[0.9rem] leading-[1.6] text-ink-2">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-10" aria-labelledby="why-h">
          <h2 id="why-h" className={h2}>
            Why people use Waves for this
          </h2>
          <ul className="mt-3 space-y-3">
            {u.points.map((s) => (
              <li key={s.title} className={card}>
                <h3 className="text-[0.95rem] font-semibold text-ink">{s.title}</h3>
                <p className="mt-1 text-[0.9rem] leading-[1.6] text-ink-2">{s.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <TrustList />
        <ReferralNote />

        <section className="mt-10" aria-labelledby="faq-h">
          <h2 id="faq-h" className={h2}>
            Questions
          </h2>
          <dl className="mt-3 space-y-3">
            {u.faq.map((f) => (
              <div key={f.q} className={card}>
                <dt className="text-[0.95rem] font-semibold text-ink">{f.q}</dt>
                <dd className="mt-1 text-[0.9rem] leading-[1.6] text-ink-2">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <p className="mt-8 text-[0.9rem] text-ink-2">
          Also see{' '}
          {useCases
            .filter((o) => o.slug !== u.slug)
            .map((o, i) => (
              <span key={o.slug}>
                {i ? ', ' : ''}
                <Link href={`/en/use-cases/${o.slug}`} className="text-blue underline">
                  {o.eyebrow}
                </Link>
              </span>
            ))}
          , or{' '}
          <Link href="/en/compare" className="text-blue underline">
            compare Waves with other apps
          </Link>
          .
        </p>
      </article>
    </CompareShell>
  );
}
