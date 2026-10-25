import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CompareShell, comparePageUrl } from '@/components/compare-page';
import { Kicker } from '@/components/ui';
import { CHECKED_MONTH, competitors, compareSlug, disclaimer } from '@/content/competitors';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { socialMetadata } from '@/lib/compare-seo';

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ locale: 'en' }];
}

const title = 'Compare Waves with other expense splitters';
const description =
  'Side-by-side comparisons of Waves with Splitwise, Tricount, Settle Up, Splid, Spliit, Kittysplit, Splitkaro, UPI apps, Venmo and spreadsheets, with sources.';

export const metadata: Metadata = socialMetadata({ title, description, path: '/compare' });

export default async function CompareIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale) || locale !== 'en') notFound();
  const t = await getDictionary('en');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Waves', item: comparePageUrl('') },
          { '@type': 'ListItem', position: 2, name: 'Compare', item: comparePageUrl('/compare') },
        ],
      },
      {
        '@type': 'ItemList',
        itemListElement: competitors.map((c, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: `Waves vs ${c.name}`,
          url: comparePageUrl(`/compare/${compareSlug(c)}`),
        })),
      },
    ],
  };

  return (
    <CompareShell t={t} jsonLd={jsonLd}>
      <Kicker>Last checked {CHECKED_MONTH}</Kicker>
      <h1 className="mt-2 text-[2rem] font-semibold tracking-[-0.035em] text-ink sm:text-[2.6rem]">
        Compare Waves
      </h1>
      <p className="mt-3 text-[1rem] leading-[1.65] text-ink-2">
        How Waves stacks up against the apps and habits people use to split money, with the places
        each one is better. Every competitor fact is from their public site or store listing, and
        sourced at the bottom of its page.
      </p>
      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {competitors.map((c) => (
          <li key={c.slug}>
            <Link
              href={`/en/compare/${compareSlug(c)}`}
              className="block h-full rounded-xl bg-surface px-4 py-3 shadow-[var(--w-shadow-sm)] transition-colors hover:bg-raise"
            >
              <h2 className="text-[1rem] font-semibold text-ink">Waves vs {c.name}</h2>
              <p className="mt-1 text-[0.86rem] leading-[1.55] text-ink-2">{c.blurb}</p>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-[0.9rem] text-ink-2">
        Looking for the biggest name?{' '}
        <Link href="/en/alternatives/splitwise-alternative" className="text-accent hover:underline">
          Splitwise alternative
        </Link>
        .
      </p>
      <p className="mt-6 text-[0.78rem] leading-[1.6] text-ink-3">{disclaimer}</p>
    </CompareShell>
  );
}
