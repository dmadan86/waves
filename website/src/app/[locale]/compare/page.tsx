import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CompareShell, comparePageUrl, TickList } from '@/components/compare-page';
import { ArrowRight } from '@/components/icons';
import { WaveMark } from '@/components/logo';
import { CHECKED_MONTH, competitors, compareSlug, disclaimer } from '@/content/competitors';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { socialMetadata } from '@/lib/compare-seo';
import { site } from '@/lib/site';

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ locale: 'en' }];
}

const title = 'Compare Waves with other expense splitters';
const description =
  'Side-by-side comparisons of Waves with Splitwise, Tricount, Settle Up, Splid, Spliit, Kittysplit, Splitkaro, UPI apps, Venmo and spreadsheets, with sources.';

export const metadata: Metadata = socialMetadata({ title, description, path: '/compare' });

const ticks = ['No daily limits', 'UPI payments', 'Scan receipts', 'Works globally'];

const highlights = [
  {
    title: 'Daily limits',
    symbol: '∞',
    body: 'No limit on groups, people or expenses.',
    pill: 'Waves: Unlimited expenses',
    tint: 'bg-blue-50',
    icon: 'bg-blue-100 text-blue-700',
  },
  {
    title: 'Receipt scanning',
    symbol: '▤',
    body: 'Scan receipts to add expenses.',
    pill: 'Waves: 2 credits a scan',
    tint: 'bg-emerald-50',
    icon: 'bg-emerald-100 text-emerald-700',
  },
  {
    title: 'UPI payments',
    symbol: '↗',
    body: 'Settle with the exact amount filled in.',
    pill: 'Waves: Opens your UPI app',
    tint: 'bg-amber-50',
    icon: 'bg-amber-100 text-amber-700',
  },
  {
    title: 'Multiple currencies',
    symbol: '◎',
    body: 'Every ISO 4217 currency, free.',
    pill: 'Waves: Free',
    tint: 'bg-violet-50',
    icon: 'bg-violet-100 text-violet-700',
  },
  {
    title: 'Export / import',
    symbol: '↓',
    body: 'Export your data or bring a Splitwise CSV.',
    pill: 'Waves: JSON, CSV and PDF export, Splitwise CSV import',
    tint: 'bg-rose-50',
    icon: 'bg-rose-100 text-rose-700',
  },
];

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
      <section className="relative grid items-center gap-6 overflow-hidden rounded-xl bg-[radial-gradient(ellipse_at_85%_40%,rgb(31_99_242_/_0.09),transparent_65%)] pt-6 lg:grid-cols-[1.05fr_1fr] lg:pt-10">
        <div className="relative z-10 pb-6 lg:pb-12">
          <p className="text-xs font-semibold tracking-[0.18em] text-blue uppercase">
            Compare expense splitting apps
          </p>
          <h1 className="mt-4 text-[clamp(2.5rem,5vw,4rem)] leading-[1.04] font-bold tracking-[-0.05em] text-ink">
            Find the right app
            <br />
            <span className="text-blue">for your group</span>
          </h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-ink-2">
            How Waves stacks up against the apps and habits people use to split money, with the
            places each one is better. Every competitor fact is from their public site or store
            listing, and sourced at the bottom of its page.
          </p>
          <TickList items={ticks} />
        </div>
        <div className="relative mx-auto w-full max-w-[525px] self-end pt-20">
          <p className="absolute top-2 left-4 z-10 -rotate-6 text-lg leading-snug text-ink italic [font-family:cursive] sm:text-xl">
            More freedom.
            <br />
            Built for how you actually split.
            <span aria-hidden="true" className="ml-8 block text-3xl">
              ↘
            </span>
          </p>
          <Image
            src="/home/app-screens.webp"
            width={525}
            height={510}
            sizes="(max-width: 1024px) 90vw, 48vw"
            preload
            alt="Two Waves phones: an expense list with Goa Trip, dinner and groceries, and a trip balance screen with a Settle up button"
            className="relative h-auto w-full rounded-t-xl"
          />
        </div>
      </section>

      <nav aria-label="Choose an app to compare" className="mt-6">
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <li className="relative">
            <span className="absolute -top-2.5 right-3 rounded-full bg-blue px-3 py-1 text-xs font-medium text-white shadow-sm">
              Recommended
            </span>
            <a
              href={site.appUrl}
              className="flex h-full min-h-28 items-center gap-4 rounded-xl border border-blue bg-blue/5 p-5 transition-colors hover:bg-blue/10"
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-blue/10">
                <WaveMark className="h-9 w-9" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-bold text-ink">Waves</span>
                <span className="mt-1 block text-sm leading-relaxed text-ink-2">
                  Unlimited people and expenses.
                </span>
              </span>
              <ArrowRight className="h-5 w-5 shrink-0 text-blue" />
            </a>
          </li>
          {competitors.map((c) => (
            <li key={c.slug}>
              <Link
                href={`/en/compare/${compareSlug(c)}`}
                className="flex h-full min-h-28 items-center gap-4 rounded-xl border border-line bg-paper p-5 transition-colors hover:bg-chip"
              >
                <span
                  aria-hidden="true"
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-2xl font-semibold text-slate-600"
                >
                  {c.name.charAt(0)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-bold text-ink">{c.name}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-ink-2">{c.blurb}</span>
                </span>
                <ArrowRight className="h-5 w-5 shrink-0 text-ink-2" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="highlights-heading" className="pt-12 sm:pt-16">
        <div className="text-center">
          <p className="text-xs font-semibold tracking-[0.18em] text-blue uppercase">
            Quick comparison
          </p>
          <h2
            id="highlights-heading"
            className="mt-2 text-4xl font-bold tracking-[-0.04em] text-ink sm:text-5xl"
          >
            How Waves compares
          </h2>
          <p className="mt-3 text-base leading-relaxed text-ink-2">
            See the Waves features at a glance. Choose an app above for a detailed comparison.
          </p>
        </div>
        <ul className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {highlights.map((feature) => (
            <li
              key={feature.title}
              className={`flex flex-col items-center rounded-xl p-4 text-center ${feature.tint}`}
            >
              <span
                aria-hidden="true"
                className={`flex h-14 w-14 items-center justify-center rounded-full text-3xl ${feature.icon}`}
              >
                {feature.symbol}
              </span>
              <h3 className="mt-3 text-lg font-bold tracking-tight text-slate-950">
                {feature.title}
              </h3>
              <p className="mt-1 mb-4 text-sm leading-relaxed text-slate-600">{feature.body}</p>
              <p className="mt-auto flex w-full items-start justify-center gap-2 rounded-xl bg-white/75 p-3 text-xs leading-relaxed text-slate-950">
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${feature.icon}`}
                >
                  ✓
                </span>
                <span>{feature.pill}</span>
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10 rounded-lg bg-[#102442] px-6 py-9 text-white sm:px-9">
        <p className="text-xs tracking-[0.18em] text-blue-200 uppercase">
          Ready for your next shared expense?
        </p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          Find your flow with Waves
        </h2>
        <p className="mt-3 text-sm text-slate-200">
          Keep your groups, expenses and balances together.
        </p>
        <a
          href={site.appUrl}
          className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-sm bg-white px-6 text-sm font-semibold text-[#102442] transition-colors hover:bg-blue-100"
        >
          Try Waves free <ArrowRight className="h-4 w-4" />
        </a>
        <TickList items={ticks} dark />
      </section>
      <p className="mt-6 text-xs text-ink-3">Last checked {CHECKED_MONTH}</p>
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
