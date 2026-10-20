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
    title: t.legal.termsTitle,
    alternates: { canonical: absoluteUrl(`/${locale}/terms`) },
  };
}

const sections: LegalSection[] = [
  {
    heading: 'Who you are agreeing with',
    body: [
      `Waves is run by Madan D, an individual, based in Bengaluru, Karnataka, India. In these terms, "we" and "us" mean him. Write to us at ${site.supportEmail}.`,
    ],
  },
  {
    heading: 'What Waves is',
    body: [
      'Waves is a record-keeping tool. It tracks what a group of people spent and works out who owes whom. It is not a bank, a payment institution, a lender or a financial adviser, and it does not hold, transfer or take custody of money at any point.',
      'When you settle up, Waves passes an amount and a recipient to a payment app you already use. What happens after that is between you and that provider.',
    ],
  },
  {
    heading: 'Your account',
    body: [
      'You must be 18 or over to use Waves. You need an account to keep a ledger across devices. Keep your sign-in secure; anyone who can reach your email or phone number can reach your account.',
      'You are responsible for what you put into the app, including that you have the right to add the people and the information you add.',
    ],
  },
  {
    heading: 'The ledger is a record, not a judgment',
    body: [
      'Balances are arithmetic over what the people in a group entered. If somebody enters the wrong number, the balance is wrong. Waves does not verify, adjudicate or enforce a debt between you and anyone else, and a balance in the app is not a legal instrument.',
      'Currency conversion uses whichever rate you chose or a published reference rate. It is an estimate for splitting a bill, not a quote.',
    ],
  },
  {
    heading: 'AI features',
    body: [
      'Waves uses AI to turn your voice, a receipt photo, a screenshot or a bank statement into proposed expenses. The result can be wrong or incomplete. Receipt, screenshot and statement results are shown for you to check before anything is added. Voice can save an expense by itself after a few seconds, with an Undo, when it is confident; otherwise it asks you to check. You can edit or delete anything later, and you are responsible for what ends up in your ledger.',
      'Advanced voice only runs after you agree to it in the app, and you can turn it off in Settings. The Privacy Policy says what is sent, and to whom.',
      'Do not use AI features on anything you have no right to share, and do not try to get around the monthly limits.',
    ],
  },
  {
    heading: 'Acceptable use',
    body: [
      'Do not use Waves to harass anyone, to store content you have no right to store, to break the law in your jurisdiction, or to attack the service — automated scraping, probing, or attempting to reach data belonging to a group you are not in.',
      'We may suspend an account that is doing any of the above, and will say why where we are permitted to.',
    ],
  },
  {
    heading: 'Free and paid',
    body: [
      'The core ledger — groups, expenses, splits, currencies, offline use and settling up — is free and unlimited, and the free plan does not expire. Paid features exist for the parts with a per-use cost behind them, such as advanced voice, receipt scans, screenshot and bank statement import, and more devices.',
      'Waves Pro is an auto-renewing subscription, billed through Google Play or the Apple App Store. In India it is \u20b979 a month or \u20b9699 a year; elsewhere the price shown in the store at purchase applies. The plan renews until you cancel it in the store, and cancelling does not delete your ledger.',
      'New accounts get 15 days of Pro free, once per person, with no card needed. When it ends without a subscription, the account goes back to Free and nothing is charged. We may change the plans, limits or prices, and a change to a price does not affect a period you have already paid for.',
      'Refunds follow the rules of the app store and our refund page.',
    ],
  },
  {
    heading: 'Ads and rewards',
    body: [
      'On Free, you may choose to watch a rewarded video ad for a few extra voice commands or receipt scans. It is optional, rewards expire at the end of the calendar month (UTC), have no cash value and cannot be transferred. We may limit how many you can earn in a day, or stop offering them. Using automation or tricks to fake an ad view or a referral may close the account.',
      'Inviting friends can earn free Pro days: 7 days for you and 7 for the friend, when the friend genuinely uses Waves. One account can earn at most 30 referral days in total, and we may withhold days if we think a referral is not genuine.',
    ],
  },
  {
    heading: 'Availability',
    body: [
      'Waves is designed to keep working with no network, so an outage on our side does not stop you adding an expense. It can still stop syncing, invitations and notifications. We do not promise uninterrupted service, and we do not promise that a feature available today will be available forever — though we will give notice before removing one that people depend on.',
    ],
  },
  {
    heading: 'Liability',
    body: [
      'To the extent the law allows, Waves is provided as-is, and we are not liable for indirect or consequential loss, or for a payment you made or failed to make on the strength of a balance in the app. Nothing here limits liability that cannot lawfully be limited.',
    ],
  },
  {
    heading: 'Governing law',
    body: [
      'These terms are governed by the laws of India. The courts at Bengaluru, Karnataka have exclusive jurisdiction, subject to any consumer-protection rights that cannot be waived.',
    ],
  },
  {
    heading: 'Ending it',
    body: [
      'You can delete your account from inside the app at any time (see the delete account page for what is removed and what stays in shared groups). Deleting your account does not cancel a store subscription; cancel it in Google Play or the App Store. We may close an account that breaches these terms. Either way, the parts of these terms that should survive — Liability and Governing law above — do.',
    ],
  },
  {
    heading: 'Changes and contact',
    body: [
      'If we change these terms in a way that matters, we will tell you in the app before it takes effect. Using Waves after that means you accept the change.',
      `Questions about these terms: ${site.supportEmail}.`,
    ],
  },
];

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getDictionary(locale);

  return (
    <LegalPage
      locale={locale}
      t={t.legal}
      title={t.legal.termsTitle}
      updated={UPDATED}
      intro={`These are the terms you agree to by using ${site.name}. They are written to be read, not to be survived.`}
      sections={sections}
    />
  );
}
