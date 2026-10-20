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
    title: t.legal.refundTitle,
    alternates: { canonical: absoluteUrl(`/${locale}/refund`) },
  };
}

const sections: LegalSection[] = [
  {
    heading: 'What you pay for',
    body: [
      'The core ledger — groups, expenses, splits, currencies, offline use and settling up — is free and has nothing to cancel or refund.',
      `${site.name} Pro is an auto-renewing subscription, monthly or yearly, bought inside the app through Google Play or the Apple App Store. We do not take card or bank details ourselves, and Waves never holds, moves or settles money between you and the people you split with.`,
    ],
  },
  {
    heading: 'Free trial',
    body: [
      'New accounts get 15 days of Pro free with no card needed. When the trial ends without a subscription, the account simply returns to Free. Nothing is charged, so there is nothing to cancel.',
    ],
  },
  {
    heading: 'How to cancel',
    body: [
      'Android: open Google Play, tap your profile picture, then Payments & subscriptions › Subscriptions › Waves › Cancel subscription.',
      'iPhone and iPad: open Settings, tap your name, then Subscriptions › Waves › Cancel Subscription.',
      'Uninstalling the app or deleting your account does not cancel a store subscription on its own — cancel it in the store as well.',
    ],
  },
  {
    heading: 'What happens when you cancel',
    body: [
      'Cancelling stops the next renewal. Pro stays on until the end of the period you have already paid for, and then the account returns to Free.',
      'Your ledger is untouched: groups, expenses and balances stay exactly as they were, and everything you made with Pro remains readable.',
    ],
  },
  {
    heading: 'Refunds',
    body: [
      'Because the purchase is made through the app store, refunds are issued by that store and follow its rules.',
      'Google Play: within 48 hours of a charge you can request a refund directly from Google Play (play.google.com › Order history). After that, write to us and we can refund an eligible purchase through Google Play.',
      'Apple App Store: refunds are decided by Apple. Request one at reportaproblem.apple.com. We cannot issue Apple refunds ourselves, but we are happy to help if something went wrong.',
      'We generally refund a charge that was duplicated, made in error, or made for a period in which Pro did not work because of a fault on our side. We do not usually refund the unused part of a period after a cancellation, unless the law where you live requires it.',
    ],
  },
  {
    heading: 'Processing time',
    body: [
      'An approved refund goes back to the payment method used for the purchase. Google and Apple usually process it within 3–5 business days; how long it takes to appear depends on your bank or card provider and can be up to 10 business days.',
    ],
  },
  {
    heading: 'Contact',
    body: [
      `Write to ${site.supportEmail} with the email on your account and the order number from your store receipt (it starts with GPA. on Google Play). We reply within 2 business days.`,
      'Nothing in this policy limits rights you have under consumer protection law where you live.',
    ],
  },
];

export default async function RefundPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getDictionary(locale);

  return (
    <LegalPage
      locale={locale}
      t={t.legal}
      title={t.legal.refundTitle}
      updated={UPDATED}
      intro={`How to cancel a ${site.name} subscription, and how refunds work.`}
      sections={sections}
    />
  );
}
