import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CompareBody, CompareShell, compareJsonLd } from '@/components/compare-page';
import { bySlug } from '@/content/competitors';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { socialMetadata } from '@/lib/compare-seo';

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ locale: 'en' }];
}

const path = '/alternatives/splitwise-alternative';
const title = 'A Splitwise alternative with no daily expense limit';
const description =
  'Looking for a Splitwise alternative? Waves keeps expenses, people and currencies unlimited on Free, works offline and imports your Splitwise export.';

export const metadata: Metadata = socialMetadata({ title, description, path });

export default async function SplitwiseAlternative({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const c = bySlug('splitwise');
  if (!isLocale(locale) || locale !== 'en' || !c) notFound();
  const t = await getDictionary('en');

  const crumbs = [
    { name: 'Waves', path: '' },
    { name: 'Compare', path: '/compare' },
    { name: 'Splitwise alternative', path },
  ];

  return (
    <CompareShell
      t={t}
      jsonLd={compareJsonLd({ path, name: title, crumbs, faq: c.faq, description })}
    >
      <CompareBody
        c={c}
        h1="A Splitwise alternative: Waves"
        intro="People look for a Splitwise alternative when the free plan's daily expense limit gets in the way, when ads or paywalled scanning bother them, or when the group needs UPI and Indian languages. Here is how Waves compares, and where Splitwise is still the better pick."
        crumbs={[
          { name: 'Waves', href: '/en' },
          { name: 'Compare', href: '/en/compare' },
          { name: 'Splitwise alternative' },
        ]}
      />
    </CompareShell>
  );
}
