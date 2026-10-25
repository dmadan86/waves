import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CompareBody, CompareShell, compareJsonLd } from '@/components/compare-page';
import { competitors, compareSlug } from '@/content/competitors';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { socialMetadata } from '@/lib/compare-seo';

/**
 * English only, on purpose: the comparisons are written once, in English, and a
 * machine-translated copy of a "where they are better" page would be worse than
 * none. Only /en is built; every other locale gets the in-locale 404. There is
 * no hreflang for the same reason.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return competitors.map((c) => ({ locale: 'en', slug: compareSlug(c) }));
}

const find = (slug: string) => competitors.find((c) => compareSlug(c) === slug);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const c = find(slug);
  if (locale !== 'en' || !c) return {};
  return socialMetadata({
    title: c.seoTitle,
    description: c.seoDescription,
    path: `/compare/${slug}`,
  });
}

export default async function ComparePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const c = find(slug);
  if (!isLocale(locale) || locale !== 'en' || !c) notFound();
  const t = await getDictionary('en');

  const path = `/compare/${slug}`;
  const crumbs = [
    { name: 'Waves', path: '' },
    { name: 'Compare', path: '/compare' },
    { name: `Waves vs ${c.name}`, path },
  ];

  return (
    <CompareShell
      t={t}
      jsonLd={compareJsonLd({
        path,
        name: c.seoTitle,
        crumbs,
        faq: c.faq,
        description: c.seoDescription,
      })}
    >
      <CompareBody
        c={c}
        h1={`Waves vs ${c.name}`}
        crumbs={[
          { name: 'Waves', href: '/en' },
          { name: 'Compare', href: '/en/compare' },
          { name: `Waves vs ${c.name}` },
        ]}
      />
    </CompareShell>
  );
}
