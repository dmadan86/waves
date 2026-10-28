import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { LegalPage, type LegalSection } from '@/components/legal-page';
import { isLocale, locales } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { absoluteUrl, site } from '@/lib/site';

const UPDATED = '22 October 2026';

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
    title: t.legal.privacyTitle,
    alternates: { canonical: absoluteUrl(`/${locale}/privacy`) },
  };
}

const sections: LegalSection[] = [
  {
    heading: 'Who is responsible',
    body: [
      `Waves is run by Madan D, an individual, based in Bengaluru, Karnataka, India, who is responsible for your data as described here. Write to us at ${site.supportEmail}.`,
    ],
  },
  {
    heading: 'What we collect',
    body: [
      'An account needs an email address or a phone number, and a display name if you set one. Signing in with Google or Apple gives us the email address and name that provider returns; we ask for nothing else from them. A phone number is verified with a one-time code sent through Google Firebase or Twilio (by SMS or WhatsApp) and is stored with your account. It is also used so friends who already know it can find you; you can turn that off under Privacy in Settings.',
      'The ledger itself — groups, the people in them, expenses, amounts, currencies, splits, comments, settlements and any notes you write — is stored so it can be shared with the people you share a group with, and so it survives losing your phone.',
      'Optional things you choose to add: receipt images and expense photos, a payment handle such as a UPI ID — or, in some countries, a bank account number or IBAN — so a settlement can be handed to a payment app, and your voice. How voice and photos are handled is set out under Voice and AI below.',
      'Location. Once you have allowed location access, a new expense is stamped with where you are — the coordinates and a place name — when you open the form, so you can remember where you spent. You can move or remove the pin on each expense before saving, and you can withdraw the permission in your phone’s settings at any time. Location is never read in the background.',
      'Contacts. When you tap to pick someone from your contacts, the app reads your address book on the phone to show and match names. Only the person you tap — their name and, if you choose one, their phone number or email — is sent to us and stored in the group. The rest of your contacts never leave the phone.',
      'Your subscription status, which we receive from Google Play or the App Store through RevenueCat. We never see your card or bank details.',
      'Technical data we cannot avoid: the device model, operating system and app version, a random device ID for the list of your signed-in devices, a push notification token if you turn notifications on, crash reports, and a few app steps (an install, a sign-up started, onboarding finished, the plans screen opened). These steps are always on — they are not a setting — and are counted against a random install ID that is not your advertising ID and, once you have an account, against that account. The IP address on those steps is hashed and the hash is dropped within two days. If you arrived through a referral or campaign link, we also keep which link it was.',
    ],
  },
  {
    heading: 'What we do not do',
    body: [
      'We do not sell your data, and we do not share it with data brokers. We never share your expenses, groups or balances with advertisers. The only advertising in the app is the optional reward ad described under Advertising below; there are no tracking pixels.',
      'We do not read your SMS, contacts, camera roll, location or microphone in the background. Contacts are opened only when you tap to pick someone, and only the person you pick is sent to us. The microphone is used only after you tap or hold the mic button, and recording stops when you stop it or when a time limit is reached. Location is read only while the app is open, as described above. Where the app offers to read a payment SMS, it happens on your device, when you ask for it, and only for the message in front of you.',
      'We never take custody of your money. Waves works out who owes whom and hands the amount to your payment app; the payment itself happens between you and that provider.',
    ],
  },
  {
    heading: 'Advertising',
    body: [
      'On the Free plan, you can choose to watch a short rewarded video ad in exchange for credits, which pay for AI voice commands, receipt scans, exports and extra groups. Ads only appear when you choose to watch one, and only on Free. Pro, and the 15-day Pro trial, see none. We never show ads on balances, groups, expenses or settling up.',
      'Ads are served by Google AdMob and are non-personalized only. The AdMob software in the app can read your device\u2019s advertising ID, which Google uses to serve the ad and prevent fraud. We do not use it to personalize ads, we do not ask to track you across other companies\u2019 apps and websites, and we never share your expenses, groups or balances with advertisers.',
      'To serve an ad and prevent fraud, AdMob receives device and IP-level information, as described in Google\u2019s policy. In the European Economic Area, the United Kingdom and Switzerland, Google\u2019s consent form is shown first, and you can change your choice later.',
      'When you finish an ad, Google confirms it to our server so the reward can be credited; the app never grants a reward by itself. To match the reward to you, we give Google an internal account ID with the ad request. It is not your name or email address.',
    ],
  },
  {
    heading: 'Voice and AI',
    body: [
      'AI is used in four places: advanced voice, receipt scanning, screenshot import and bank statement import. In each one the AI only proposes. Receipt, screenshot and statement results are shown for you to check before anything is added. Voice can save an expense by itself, after a few seconds with an Undo, when it is confident; otherwise it asks you to check first. You can edit or delete anything later. AI can be wrong, so check the amounts, names and dates.',
      'Voice. Without advanced voice, your phone writes down what you say with its own speech recognition, which on some phones uses the phone maker\u2019s speech service. When advanced voice is on, and only after you agree to it in the app, the sound is streamed to our server and on to Deepgram to be turned into text, from when you start recording until you stop or the time limit is reached, along with the names of your groups and their members so they are spelt right. We do not store the recording, and Deepgram is told not to use it for training. If you use the watch app, the short clip you record on the watch is sent the same way while the voice assistant is enabled for your account. The text, along with the names of your groups and their members and the balances in them, is then sent to a language model (currently Google Gemini or Anthropic Claude) to work out the expense. It normally goes through OpenRouter, which is told to route it only to providers that do not store it or train on it. If OpenRouter is unavailable, it can instead go directly to Google (Gemini), DeepSeek or Anthropic under their own API terms; those direct calls carry no no-storage setting of their own. You can switch advanced voice off in Settings at any time, and voice then stays on the phone.',
      'Receipt scanning. A receipt you scan is uploaded to our object storage and read by an AI model through OpenRouter, under the same no-storage, no-training routing rule. The photo stays in our storage, attached to the expense, until you delete it, and we keep the lines it found against a fingerprint of the photo, so the same photo is not read twice.',
      'Screenshot import (Pro). The image is sent through OpenRouter to be read and is not kept. Only a record that it happened is logged: no image, no names and no amounts.',
      'Bank statements (Pro). When you choose to import a bank statement, the file is opened on your phone. A PDF password stays on the phone and is never sent, stored or logged. For a statement whose text can be read on the phone, account and card numbers are masked to their last four digits and the header block (your name and address) is dropped before anything is sent. A scanned or image-only statement cannot be masked that way: its page images are sent as they are. The pages go to our AI provider, OpenRouter, which is told to route them only to model providers that do not store them or train on them, to read the transactions. We keep none of it: not the file, not the pages, not the result \u2014 only a record that an import happened. Bank messages (SMS) are different and stay on your phone: they are never sent from it.',
      'We keep a count of how many voice commands and scans you have used this month, so the monthly limits can be applied. We keep no text of what you said or scanned for that.',
    ],
  },
  {
    heading: 'Where it is stored',
    body: [
      'The copy on your phone is encrypted at rest. The key lives in the device keystore, never leaves it and is destroyed when you sign out, which makes the local copy unreadable.',
      'The server copy lives in a managed Postgres database with row-level security, so a request can only ever reach rows belonging to a group you are in.',
      'Receipt and expense photos, proofs of payment, group covers, profile photos and trip photos are stored in our object storage (Cloudflare R2) and fetched through short-lived signed links. Your private "Me" ledger lives on the phone; if you turn on backup, an encrypted copy of it goes to a private app folder in your own Google Drive, and we read only your Google account’s email and name to connect it. No other cloud drive is supported.',
    ],
  },
  {
    heading: 'Who processes it for us',
    body: [
      'We use a small number of providers, each for one job: Supabase for the managed database, sign-in and server functions; Cloudflare R2 for object storage of images and receipts; Resend for email (invitations, settlement receipts, sign-in codes and digests); Google Firebase and Twilio for phone verification, to send sign-in codes by SMS or WhatsApp, and Firebase App Check to confirm a request comes from the real app; Google and Apple for sign-in; Expo for push notifications and app updates; RevenueCat, Google Play and the Apple App Store for subscriptions; Sentry for crash reports and performance traces, with your account ID attached and personal details scrubbed; Google AdMob for the optional reward ads on Free; Google Maps, Apple Maps and OpenStreetMap for the map behind a place on an expense; Google Drive, only if you turn on backup; and a hosting provider that serves this website and processes standard web request logs. The AI providers — Deepgram, OpenRouter and the model providers behind it — are named under Voice and AI above.',
      'Optional session recordings. If you turn on the session-replay switch under Privacy in Settings, Microsoft Clarity records how you use the app screens to help us fix problems. It is off unless you turn it on, and with it on, voice commands the phone could not understand are also sent to us as text so we can improve them.',
      'These providers process data on our instructions and are not permitted to use it for their own purposes, except that Google AdMob acts as described under Advertising.',
      'Exchange rates for bills in a foreign currency come from public rate services: the European Central Bank reference rates (through Frankfurter), the open-source currency-api, and ExchangeRate-API (Rates By Exchange Rate API, exchangerate-api.com). A rate lookup is made by our server and sends only the two currency codes and, for a past bill, its date — never your name, your amounts or anything else about you or your groups. We keep the rates we fetch, by day, so the same lookup does not have to be made again.',
    ],
  },
  {
    heading: 'How long we keep it',
    body: [
      'Ledger data is kept while your account exists, because the other people in a group depend on it being there. Deleting your account removes your rows and your sign-in identity. What you added inside a shared group stays rather than being deleted, so the group balance does not silently change for everyone else: the expenses and settlements, the notes and comments on them, and the images you added — receipts, proofs of payment, trip photos — are kept as they are, with your name detached from them. Notifications and activity entries already delivered to other people can still carry the name you had when they were written, and if you give a reason when you delete, that text is kept with the link back to you removed. Nothing is retained for advertising, and nothing is retained because a law obliges us to.',
      'App-step counts are kept as long as they are useful for measuring the app, and are not tied to what you spent; when you delete your account they are detached from it. Crash reports are kept for 90 days. Email delivery logs are kept for as long as the provider retains them, and no longer than a year.',
    ],
  },
  {
    heading: 'Your choices',
    body: [
      'You can export your data at any time from inside the app, delete your account from inside the app, turn notification categories on and off individually, and unsubscribe from any email with one click. Under Privacy in Settings you can also switch off advanced voice and session replay, and change the ad privacy choices where they apply. Location, contacts, camera and microphone access can each be withdrawn in your phone’s settings. A cancelled or deleted account does not cancel a store subscription; do that in Google Play or the App Store (see the refund page).',
      'If you are in a jurisdiction with a statutory right to access, correction, portability or erasure, those requests are honoured — write to us and we will action them.',
    ],
  },
  {
    heading: 'Children',
    body: [
      'Waves is for people aged 18 and over, and we do not knowingly collect data from anyone younger. If you believe someone under 18 has created an account, write to us and we will remove it.',
    ],
  },
  {
    heading: 'Governing law',
    body: [
      'This policy is governed by the laws of India, and the courts at Bengaluru, Karnataka have jurisdiction, as set out in the Terms.',
    ],
  },
  {
    heading: 'Changes',
    body: [
      'If this policy changes materially we will say so in the app before the change takes effect, not only by editing this page.',
    ],
  },
];

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getDictionary(locale);

  return (
    <LegalPage
      locale={locale}
      t={t.legal}
      title={t.legal.privacyTitle}
      updated={UPDATED}
      intro={`${site.name} is an expense ledger. It only works if it holds a record of what people spent, so this page says plainly what is held, where it sits, who else touches it and how to get rid of it.`}
      sections={sections}
    />
  );
}
