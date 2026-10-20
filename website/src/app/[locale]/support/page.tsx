import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { LegalPage, type LegalSection } from '@/components/legal-page';
import { isLocale, locales } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { absoluteUrl, site } from '@/lib/site';

const UPDATED = '20 October 2026';

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
  return {
    title: t.legal.supportTitle,
    alternates: { canonical: absoluteUrl(`/${locale}/support`) },
  };
}

const sections: LegalSection[] = [
  {
    heading: 'Talk to a person',
    body: [
      `Email ${site.supportEmail}. A person reads every message, and we reply within 2 business days.`,
      'It helps to include the email on your account, your phone model and app version, and a screenshot if something looks wrong.',
    ],
  },
  {
    heading: 'Account and sign-in',
    body: [
      'Waves signs you in with a one-time code sent to your email or phone, or with Google or Apple. If a code does not arrive, check spam and ask for a new one after a minute; codes expire after a short time.',
      `To delete your account and your data, follow the steps at ${site.url}/en/delete-account.`,
    ],
  },
  {
    heading: 'Groups, expenses and balances',
    body: [
      'Balances are worked out from what the people in a group entered. If a balance looks wrong, open the group and check the expense list and Activity for an entry that was added, changed or deleted.',
      'Waves works offline. Anything added without signal syncs on its own once you are back online.',
    ],
  },
  {
    heading: 'Subscriptions and refunds',
    body: [
      'Pro is billed through Google Play or the Apple App Store and is managed there.',
      `How to cancel, and how refunds work: ${site.url}/en/refund.`,
    ],
  },
  {
    heading: 'Privacy and security',
    body: [
      `What we hold and what we do not: ${site.url}/en/privacy. To report a security problem, write to ${site.supportEmail} with "Security" in the subject.`,
    ],
  },
];

export default async function SupportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getDictionary(locale);

  return (
    <LegalPage
      locale={locale}
      t={t.legal}
      title={t.legal.supportTitle}
      updated={UPDATED}
      intro={`Help with ${site.name}, and how to reach us.`}
      sections={sections}
    />
  );
}
