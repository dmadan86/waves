import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { LegalPage, type LegalSection } from '@/components/legal-page';
import { isLocale, locales } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { absoluteUrl, site } from '@/lib/site';

/**
 * How to delete a Waves account, on a page that can be read without one.
 *
 * Google Play requires this as a *web* URL, separate from the in-app route: the
 * point is that somebody who has already uninstalled the app, or who cannot get
 * past the sign-in screen, can still find out how to be forgotten. So this page
 * has to stand on its own — no link that only works inside the app, and the
 * email route stated plainly rather than as a footnote.
 *
 * Play also requires it to say what is deleted and what is kept. That is not
 * boilerplate here: an expense ledger genuinely cannot delete somebody's half of
 * a shared bill without changing what everyone else in the group is owed. The
 * wording below is the same wording the app's own delete screen uses
 * (`settings/delete-account`, `i18n` → `privacy.delete*`) and the retention
 * section of the privacy policy. Three copies of one promise, and they have to
 * agree — if you change one, change all three.
 */

const UPDATED = '10 September 2026';

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
    title: t.legal.deleteTitle,
    alternates: { canonical: absoluteUrl(`/${locale}/delete-account`) },
  };
}

const sections: LegalSection[] = [
  {
    heading: 'Delete it from inside the app',
    body: [
      'Open Waves, go to Settings — the face in the top corner of the home screen — and scroll to the bottom. The last card is "Delete my data".',
      'That screen shows you what you are about to lose before you lose it: how many groups you are in, how many expenses you wrote, how many settlements you were part of, and whether anything is still outstanding. It also offers to export everything first, which is worth doing — once the deletion runs there is nothing left to export.',
      'You then type DELETE to confirm. It happens immediately. There is no grace period and no way to undo it.',
    ],
  },
  {
    heading: 'If you cannot open the app',
    body: [
      `Write to ${site.supportEmail} from the email address the account uses, and ask for it to be deleted. We do the same thing from our side and confirm when it is done.`,
      'It has to come from that address, or be provable some other way. Anybody who can name an email address could otherwise delete a stranger\u2019s account, and this is not undoable.',
      'Uninstalling the app does not delete anything. It removes the copy on that phone; the account and the ledger stay, because the other people in your groups are still using them.',
    ],
  },
  {
    heading: 'What is deleted',
    body: [
      'Your name, photo, payment handle, country, language and notification settings.',
      'Your sign-in, so the account can never be opened again.',
      'Your devices, your notification history, your purchases, and anything the receipt scanner recorded about how you used it.',
      'The copy of the ledger on your phone is encrypted with a key held in that phone\u2019s keystore, and signing out destroys the key — which makes the local copy unreadable whether or not you go on to delete the account.',
    ],
  },
  {
    heading: 'What stays, and why',
    body: [
      'The expenses and settlements in your shared groups remain, along with the notes and comments on them and the images you added — receipts, proofs of payment, trip photos. They are also other people\u2019s records: they are what says who owes whom, and removing them would silently change somebody else\u2019s balance to settle a debt nobody paid.',
      'You become an unnamed former member of those groups. Your name is gone from them; your share of the dinner is not.',
      'Two smaller things follow from the same rule. Notifications and activity entries already delivered to other people can still carry the name you had when they were written — they are in somebody else\u2019s history, not yours. And if you give a reason when you delete, that text is kept with the link back to you removed.',
    ],
  },
  {
    heading: 'How long any of it takes',
    body: [
      'The deletion itself is immediate — it is one transaction, not a queued job, so by the time the screen says it is done, it is done.',
      'Two things outlive it by a fixed period and neither is under our control after the fact: crash reports, which are discarded after 90 days, and email delivery logs, which the provider keeps for at most a year. Neither carries the ledger.',
      'Nothing is retained for advertising, and nothing is retained because a law obliges us to.',
    ],
  },
];

export default async function DeleteAccountPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getDictionary(locale);

  return (
    <LegalPage
      locale={locale}
      t={t.legal}
      title={t.legal.deleteTitle}
      updated={UPDATED}
      intro={`You can delete your ${site.name} account and the personal data in it at any time, from inside the app or by writing to us. This page says how, and — the part worth reading — what stays behind in the groups you shared, and why it has to.`}
      sections={sections}
    />
  );
}
