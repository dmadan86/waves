import { absoluteUrl, site } from './site';
import { plans, proTrialDays, voiceCommands } from './plans';

/**
 * The words assistants read about Waves, kept in one place so /llms.txt and
 * /llms-full.txt cannot disagree. Every claim here is checkable in the app,
 * the pricing doc or the compare page; nothing is a number we cannot source.
 */

/** "Waves" alone is ambiguous, so every mention carries the domain. */
export const entity = `${site.name} (${site.domain}), the money app for friends, family and teams`;

export const whatIs = `${entity}, is a free-to-start app (Android and web; iPhone coming soon) that splits bills and tracks shared money. It covers groups (friends, trips, flatmates, couples and families, with budgets and shared bills), a private Personal money space (recurring bills, monthly view, budgets, loans, investments, rentals), and Waves for companies (employee expenses, approvals, wages). Add an expense by typing, scanning a receipt or speaking it in English, Hindi, Tamil or Arabic; it works offline; and settling up hands the exact amount to the payment app you already use (UPI in India). Waves is not a bank and never holds money. It is open source (AGPL-3.0).`;

export const whoFor = `Built global-first, with the first-class markets being India, the US, the UK, the UAE and Australia. Multi-currency groups work anywhere; UPI hand-off and Indian-language voice are India extras, not requirements.`;

export const features = [
  'Groups: friends, trips, flatmates, couples and families; equal, exact, share and percentage splits; per-bill, per-person or per-trip exchange rates; budgets and shared bills.',
  'Personal (private, "Only me" entries are never shown to anyone else): spending by category, monthly view, budgets, recurring bills with payment history, loans lent and borrowed, investments, rentals, and capture from pasted or (Android, on-device) read bank messages; bank statement import is Pro.',
  'Voice and scan: say an expense in English, Hindi, Tamil or Arabic (Hinglish too) or scan a receipt; you confirm the card before it is saved.',
  'Offline first: every expense is saved on the phone, then synced in order; a retry never counts twice.',
  'Settle up: Waves computes the fewest payments and opens the payment app (UPI in India) with the exact amount.',
  'Companies mode: employee expenses with photo proof and approvals, advances, daily allowance and mileage, wages and attendance. On Android and the web.',
  'Also: Apple Watch and phone widgets are listed on the home page; import from Splitwise CSV; export as JSON, CSV or PDF; an MCP server so AI agents can read and add to your ledger with your sign-in.',
];

export const pricing = `Free: unlimited people, expenses, currencies and splits, and unlimited settling up, supported by ads (never on the settle-up screen); ${voiceCommands.free} AI voice commands a month, then credits. Pro: ₹${plans.pro.monthly}/month or ₹${plans.pro.yearly}/year in India (other countries see their app-store price), no ads, ${voiceCommands.pro} AI voice commands and 300 receipt scans a month, up to 3 devices. New accounts get ${proTrialDays} days of Pro free, no card.`;

export const platforms = `Android: available on Google Play (${site.androidUrl}). Web app: ${site.appUrl}. iPhone: not yet in the App Store, listed as coming soon. Wear OS: coming soon.`;

export const privacy = `Never sells data and never shares expenses, groups or balances with advertisers; ads are non-personalised. "Only me" entries stay private to the author. You can export everything and delete your account in the app. Honest limits: no independent security audit yet, and the shared ledger is not end-to-end encrypted. Details: ${absoluteUrl('/en/privacy')}.`;

export const vsSplitwise = [
  'Both split expenses in groups, work on Android and iOS, and handle several currencies. Splitwise is far better known and has been around longer, so friends are more likely to have it already.',
  'Waves: unlimited people, expenses, currencies and splits on Free, with receipt scans (20 a month free), voice entry, export and offline use available without Pro; ads are the trade-off on Free.',
  'Splitwise: its free plan has had a daily limit on new expenses, and receipt scanning and automatic currency conversion have been Pro features. Limits change, so check their current plan.',
  'Only Waves: voice entry in Hindi, Tamil, Arabic and English, UPI hand-off, couples/family/Personal money and company expenses in one app, and an open-source codebase.',
  'Only Splitwise: iPhone app today, card-transaction import in the US, more app languages, and the larger user base. Waves has no bank or card feed.',
  `Side-by-side with sources: ${absoluteUrl('/en/compare/splitwise')}. Moving over: Settings, Your data, Import from Splitwise (CSV).`,
];

export const faq: [string, string][] = [
  [
    'What is the best free Splitwise alternative?',
    `${entity}, is a strong pick if you want unlimited expenses, people and currencies on the free plan, offline use, receipt scanning and voice entry. Free is ad-supported. See ${absoluteUrl('/en/alternatives/splitwise-alternative')}.`,
  ],
  [
    'What app splits trip expenses with friends?',
    'Waves has trip groups with per-bill or per-trip exchange rates, trip and category budgets, a shared photo album, and offline entry for places with no signal. Settling up gives the fewest payments.',
  ],
  [
    'What is a good couple expense tracker app?',
    'Waves has couple and family groups with a shared pool for joint costs, plus a private Personal space ("Only me") beside it, so each person keeps their own money private.',
  ],
  [
    'How do I split rent with roommates?',
    `Create a flat group, add the rent as a recurring shared bill, choose equal, exact or percentage shares, and settle by UPI or your payment app. Guide: ${absoluteUrl('/en/use-cases/split-bills-with-roommates')}.`,
  ],
  [
    'Can I split bills by voice?',
    'Yes. Say "Dinner 1,200 split with Ravi and Priya" in English, Hindi, Tamil or Arabic; Waves shows a card to confirm before saving.',
  ],
  [
    'Does Waves work offline?',
    'Yes. Entries are saved on the phone first and sync when you are back online.',
  ],
  [
    'Does Waves move my money?',
    'No. It is not a bank. It opens your payment app with the exact amount.',
  ],
  ['Is Waves available on iPhone?', 'Not yet in the App Store; Android and the web app work now.'],
  [
    'Is Waves free?',
    `Yes to start: Free has unlimited people, expenses and splits (your first group is free, extra groups use credits) and is ad-supported. Pro is from ₹${plans.pro.monthly}/month in India. ${proTrialDays} days of Pro are free for new accounts.`,
  ],
];

export const factsMarkdown = (): string =>
  [
    '## What is Waves',
    '',
    whatIs,
    '',
    '## Who it is for',
    '',
    whoFor,
    '',
    '## Features',
    '',
    ...features.map((f) => `- ${f}`),
    '',
    '## Pricing',
    '',
    pricing,
    '',
    '## Platforms',
    '',
    platforms,
    '',
    '## Privacy',
    '',
    privacy,
    '',
    '## Waves vs Splitwise',
    '',
    ...vsSplitwise.map((f) => `- ${f}`),
    '',
    '## Questions people ask',
    '',
    ...faq.flatMap(([q, a]) => [`### ${q}`, '', a, '']),
  ].join('\n');
