/**
 * Everything the /compare pages say, in one place. The pages are generated from
 * this file, so a fact is edited once.
 *
 * Rules for editing:
 *   - A competitor fact needs a source in `sources` and a row in
 *     docs/competitors/research.md. If it is not sourced, it is not here.
 *   - "Not listed" means we did not find it in the sources we checked. It does
 *     not claim the product lacks it.
 *   - Waves facts mirror en.json, docs/pricing.md and the app. Pro-only things
 *     say so.
 *   - No superlatives ("best", "#1"), no logos: names in text only.
 */

/** true renders a tick, false a cross, a string renders as text. */
export type Cell = boolean | string;

export type Row = { feature: string; waves: Cell; them: Cell };
export type Source = { label: string; url: string };
export type Faq = { q: string; a: string };

export type Competitor = {
  slug: string;
  name: string;
  /** One line for the /compare index. */
  blurb: string;
  /** <title>, 60 characters or fewer. */
  seoTitle: string;
  /** Meta description, 155 characters or fewer. */
  seoDescription: string;
  /** Exactly two lines, shown under the H1. */
  summary: [string, string];
  rows: Row[];
  switchReasons: { title: string; body: string }[];
  theyAreBetter: { title: string; body: string }[];
  move: { title: string; steps: string[] };
  faq: Faq[];
  sources: Source[];
};

/** When the competitor facts were last checked. */
export const CHECKED_ON = '25 October 2026';
export const CHECKED_MONTH = 'October 2026';

export const disclaimer = `Competitor details from their public sites and app-store listings as of ${CHECKED_ON}; trademarks belong to their owners. "Not listed" means we did not find it in the sources we checked, not that it is missing. Plans and prices change, so check their site before you decide.`;

const NL = 'Not listed';

/** Waves cells reused across pages so a change is made once. */
const W = {
  price:
    'Free forever. Pro is ₹79/month or ₹699/year in India; other countries priced in the app store',
  limits: 'No limit on groups, people, expenses or currencies',
  ads: 'Free: optional reward ads only. Pro: none',
  offline: 'Yes, every expense is saved on the phone first and syncs later',
  currency: 'Every ISO 4217 currency, free. Fix the rate per bill, person or trip',
  receipts: 'Yes: 20 scans a month Free, 300 on Pro',
  voice: 'English, Hindi, Tamil, Arabic and Hinglish: 10 AI commands a month Free, 100 on Pro',
  upi: 'Opens your UPI app with the exact amount. Also Venmo, PayPal, PayNow, Pix and more. Waves never holds money',
  export: 'JSON, CSV and PDF, free',
  signup: 'Join a group from a link in a browser with no account (guest access is time-limited)',
  languages: 'English, Hindi, Tamil and Arabic (right to left)',
  platforms: 'Android, iOS and web, plus Apple Watch and home-screen widgets',
  privacy: 'Never sold. The shared ledger is on our server and is not end-to-end encrypted',
  families: 'Yes: split by family with per-family amounts',
} as const;

const moveSplitwise = {
  title: 'Move from Splitwise to Waves',
  steps: [
    'In Splitwise, export the group you want to bring over as a CSV file (see Splitwise help for where the export lives).',
    'In Waves, open Settings, then Your data, then Import from Splitwise, and pick the file.',
    'Match each name in the file to a person in Waves. The preview shows what will be created before anything is saved.',
    'Check the balances. They carry over to the paisa. Splitwise files do not record who paid on each row, so Waves reconstructs the payer and tells you so in the preview.',
  ],
};

const moveGeneric = (name: string): Competitor['move'] => ({
  title: `Move from ${name} to Waves`,
  steps: [
    `Waves has no one-tap import from ${name}, but it can import a CSV or spreadsheet. If ${name} lets you export your group as one, download it.`,
    'In Waves, create a group, open it and choose Import. Waves reads the columns, you match each name to a person, and you review every row before anything is saved. Results depend on the file, so check the totals.',
    `No export? Create the group, add the same people and start from today's balances, one expense per person. Waves exports its own data as JSON, CSV or PDF at any time.`,
  ],
});

export const competitors: Competitor[] = [
  {
    slug: 'splitwise',
    name: 'Splitwise',
    blurb:
      'The best-known splitter. Daily limit on the free plan, Pro for scanning and currency conversion.',
    seoTitle: 'Waves vs Splitwise: free limits, features, price',
    seoDescription:
      'Waves and Splitwise compared: free-plan limits, ads, receipt scanning, offline, currencies, UPI and languages, plus an honest list of where Splitwise wins.',
    summary: [
      'Splitwise is the best-known expense splitter, with about 29K ratings on the iOS App Store. Its free plan has a daily limit on new expenses, and scanning and currency conversion are on Pro.',
      'Waves keeps groups, expenses, currencies and export unlimited on Free, works offline first, and adds UPI hand-off and Indian-language voice entry. It is newer and smaller.',
    ],
    rows: [
      {
        feature: 'Free plan limits',
        waves: W.limits,
        them: 'A daily limit on new expenses (count not published); Pro removes it',
      },
      {
        feature: 'Price',
        waves: W.price,
        them: 'Pro is a paid subscription; store prices vary by country',
      },
      { feature: 'Ads', waves: W.ads, them: 'Free has ads; Pro is ad-free' },
      { feature: 'Works offline', waves: true, them: 'Yes, offline mode with cloud sync' },
      {
        feature: 'Multi-currency',
        waves: W.currency,
        them: '100+ currencies; automatic conversion is Pro',
      },
      { feature: 'Receipt scanning', waves: W.receipts, them: 'Pro only' },
      { feature: 'Voice entry', waves: W.voice, them: NL },
      { feature: 'UPI hand-off', waves: W.upi, them: NL },
      { feature: 'Data export', waves: W.export, them: 'CSV; JSON backup on Pro' },
      { feature: 'Languages', waves: W.languages, them: '12 on iOS, no Indian language listed' },
      { feature: 'Platforms', waves: W.platforms, them: 'iOS, Android and web' },
      { feature: 'Family splits', waves: W.families, them: NL },
    ],
    switchReasons: [
      {
        title: 'No daily cap on Free',
        body: 'Add as many expenses as the day needs. Groups, people, expenses and currencies are unlimited on Waves Free.',
      },
      {
        title: 'Scan and convert without paying',
        body: 'Currency handling is free, and Free includes 20 receipt scans a month. On Splitwise, scanning and automatic conversion sit behind Pro.',
      },
      {
        title: 'Built for India first, not only India',
        body: 'Waves opens your UPI app with the exact amount, and understands "Ravi ne 300 diye chai ke liye" in Hindi, Tamil, Arabic or Hinglish.',
      },
      {
        title: 'Ads are your choice',
        body: 'On Free, ads are optional rewarded videos you pick for extra scans or voice commands. They never appear on balances, groups or settling up.',
      },
    ],
    theyAreBetter: [
      {
        title: 'Reach and track record',
        body: 'Splitwise is far more widely used, so your friends may already have it. Waves is newer and smaller, so expect a shorter track record.',
      },
      {
        title: 'Card transaction import',
        body: 'Splitwise Pro can import card transactions in the US. Waves has no bank or card feed.',
      },
      {
        title: 'More app languages in Europe and Asia',
        body: 'Its app lists 12 languages. Waves has four: English, Hindi, Tamil and Arabic.',
      },
    ],
    move: moveSplitwise,
    faq: [
      {
        q: 'Is Waves a good Splitwise alternative?',
        a: 'If you want unlimited expenses on a free plan, offline-first entry, UPI hand-off and Indian-language voice, Waves is worth trying. If your group already lives in Splitwise and nobody wants to move, staying is a fair choice.',
      },
      {
        q: 'Can I import my Splitwise data into Waves?',
        a: 'Yes. Export your Splitwise group as a CSV and use Import from Splitwise under Settings, Your data. Balances carry over; the payer on each row is reconstructed because Splitwise files do not record it, and Waves tells you that in the preview.',
      },
      {
        q: 'Does Waves have a daily expense limit?',
        a: 'No. Groups, people, expenses and currencies are unlimited on Free. The limits are on receipt scans (20 a month Free, 300 on Pro) and AI voice commands (10 a month Free, 100 on Pro).',
      },
      {
        q: 'Does everyone in my group have to switch?',
        a: 'No. Anyone can open a Waves group from a link or QR code in a browser without an account, though guest access is limited in time.',
      },
      {
        q: 'How much does Waves Pro cost compared with Splitwise Pro?',
        a: 'Waves Pro is ₹79 a month or ₹699 a year in India, and other countries are priced by the app stores. Splitwise Pro prices vary by country in the app stores, so compare the price your store shows.',
      },
      {
        q: 'Does Waves show ads?',
        a: 'Only optional rewarded videos on Free, which you choose to watch for extra scans or voice commands. Pro has no ads.',
      },
    ],
    sources: [
      { label: 'Splitwise home page', url: 'https://www.splitwise.com' },
      { label: 'Splitwise Pro page', url: 'https://www.splitwise.com/pro' },
      {
        label: 'Splitwise: why am I seeing an expense limit',
        url: 'https://feedback.splitwise.com/knowledgebase/articles/2010350-why-am-i-seeing-an-expense-limit',
      },
      {
        label: 'Splitwise on the App Store',
        url: 'https://apps.apple.com/us/app/splitwise/id458023433',
      },
    ],
  },
  {
    slug: 'tricount',
    name: 'Tricount',
    blurb:
      'Free with no ads or daily cap, no sign-up to try. Premium and in-app export were retired.',
    seoTitle: 'Waves vs Tricount: features, export, languages',
    seoDescription:
      'Waves and Tricount compared: price, ads, offline, receipt scanning, voice, UPI, export and languages. Includes where Tricount is the simpler choice.',
    summary: [
      'Tricount is free with no ads or daily expense cap, and you can try it without signing up. It is a simple, well-liked splitter on iOS and Android.',
      'Waves adds receipt scanning, voice entry, UPI hand-off and built-in export, at the cost of a paid Pro tier for the heavier features.',
    ],
    rows: [
      { feature: 'Price', waves: W.price, them: 'Free. Its former Premium plan has been retired' },
      { feature: 'Ads and limits', waves: W.ads, them: 'No ads, no daily expense cap' },
      { feature: 'Works offline', waves: true, them: 'Yes, with later sync' },
      { feature: 'Multi-currency', waves: W.currency, them: 'Yes, with conversion' },
      {
        feature: 'Receipt scanning',
        waves: W.receipts,
        them: 'Receipt photo attachments; scanning not listed',
      },
      { feature: 'Voice entry', waves: W.voice, them: NL },
      { feature: 'UPI hand-off', waves: W.upi, them: NL },
      {
        feature: 'Data export',
        waves: W.export,
        them: 'In-app CSV/PDF export was removed with Premium; ask support',
      },
      { feature: 'Sign-up', waves: W.signup, them: 'You can try it without signing up' },
      { feature: 'Languages', waves: W.languages, them: '37 on iOS, including Hindi' },
      { feature: 'Platforms', waves: W.platforms, them: 'iOS and Android' },
    ],
    switchReasons: [
      {
        title: 'Export you control',
        body: 'Waves exports JSON, CSV and PDF from the app on the free plan. Tricount removed in-app CSV and PDF export when it retired Premium.',
      },
      {
        title: 'Scan and speak',
        body: 'Point the camera at a bill or say it in your language. Tricount lists receipt photo attachments but not scanning or voice.',
      },
      {
        title: 'UPI hand-off',
        body: 'Waves opens your UPI app with the exact amount to settle. We did not find a UPI hand-off listed for Tricount.',
      },
      {
        title: 'Tamil and Arabic',
        body: 'Waves is available in Tamil and Arabic, with full right-to-left layout.',
      },
    ],
    theyAreBetter: [
      {
        title: 'Fewer limits to think about',
        body: 'Tricount is free, with no ads and no daily cap. Waves Free is generous but scanning and AI voice have monthly limits, and Pro costs money.',
      },
      { title: 'More languages', body: 'Tricount lists 37 languages on iOS. Waves has four.' },
      {
        title: 'Nothing to learn',
        body: 'If all you want is a quick tab for one trip, Tricount is very light. Waves does more, so there is more to look at.',
      },
    ],
    move: moveGeneric('Tricount'),
    faq: [
      {
        q: 'Is Waves free like Tricount?',
        a: 'The core of Waves is free forever: unlimited groups, people, expenses and currencies. Pro (₹79 a month in India) adds more scans, devices and AI voice commands, and removes ads.',
      },
      {
        q: 'Can I import a Tricount into Waves?',
        a: "There is no one-tap import. If it can export a CSV or spreadsheet, use Import inside a Waves group; otherwise start from today's balances.",
      },
      {
        q: 'Does Waves need a sign-up?',
        a: 'You can open a group from a shared link in a browser without an account. To use the full app you create an account; new accounts get 15 days of Pro free.',
      },
      {
        q: 'Does Waves work offline?',
        a: 'Yes. Every expense is saved on your phone first and syncs when you are back online.',
      },
      {
        q: 'Which has export?',
        a: 'Waves exports JSON, CSV and PDF from the app. Tricount directs export requests to its support.',
      },
    ],
    sources: [
      { label: 'Tricount home page', url: 'https://tricount.com/en' },
      { label: 'Tricount FAQ', url: 'https://help.tricount.com/en/articles/tricount-faqs' },
      {
        label: 'Tricount on the App Store',
        url: 'https://apps.apple.com/us/app/tricount-split-settle-bills/id349866256',
      },
    ],
  },
  {
    slug: 'settle-up',
    name: 'Settle Up',
    blurb:
      'Offline-friendly with link and QR sharing. Ads on Free, Premium or per-group plans to remove them.',
    seoTitle: 'Waves vs Settle Up: price, ads, offline, languages',
    seoDescription:
      'Waves and Settle Up compared: free-plan ads, Premium prices, offline, currencies, receipts, voice, UPI and languages, and where Settle Up is stronger.',
    summary: [
      'Settle Up works offline, handles several currencies and shares groups by link or QR code. Its free version has ads and Premium removes them.',
      'Waves does not put ads on money screens, adds receipt scanning and voice entry, and opens your UPI app to settle.',
    ],
    rows: [
      {
        feature: 'Price',
        waves: W.price,
        them: 'Free with ads. Premium $3.99/month or $19.99/year (US App Store); ₹399/month or ₹1,999/year (India App Store); group plans too',
      },
      { feature: 'Ads', waves: W.ads, them: 'Free contains ads; Premium removes them' },
      { feature: 'Works offline', waves: true, them: 'Yes, syncs later' },
      { feature: 'Multi-currency', waves: W.currency, them: 'Yes, with exchange rates' },
      {
        feature: 'Receipt scanning',
        waves: W.receipts,
        them: 'Receipt photos on Premium; scanning not listed',
      },
      { feature: 'Voice entry', waves: W.voice, them: NL },
      { feature: 'UPI hand-off', waves: W.upi, them: NL },
      { feature: 'Data export', waves: W.export, them: 'CSV; Excel on Premium' },
      {
        feature: 'Sharing without the app',
        waves: W.signup,
        them: 'Share by link or QR; others can view balances without the app',
      },
      { feature: 'Languages', waves: W.languages, them: '16 on iOS, none Indian' },
      { feature: 'Platforms', waves: W.platforms, them: 'iOS, Android and web' },
    ],
    switchReasons: [
      {
        title: 'No ads on the money screens',
        body: 'Waves Free has only optional reward videos. Settle Up lists ads on its free version.',
      },
      {
        title: 'Export and scanning in the free app',
        body: 'Waves exports JSON, CSV and PDF on Free and includes 20 receipt scans a month. Settle Up puts receipt photos and Excel export on Premium.',
      },
      {
        title: 'UPI and Indian languages',
        body: 'Waves opens a UPI app with the exact amount, and offers Hindi and Tamil in the app and in voice.',
      },
    ],
    theyAreBetter: [
      {
        title: 'A long track record',
        body: 'Settle Up is well established and rated 4.8 from about 1.8K ratings on the App Store at the time we checked.',
      },
      {
        title: 'Pay once for one group',
        body: 'Settle Up sells per-group premium for a week, month, year or lifetime, which suits a single trip. Waves Pro is a subscription.',
      },
      {
        title: 'Statistics and recurring tools',
        body: 'Premium lists statistics, recurring and future expenses and custom categories.',
      },
    ],
    move: moveGeneric('Settle Up'),
    faq: [
      {
        q: 'Does Settle Up have ads?',
        a: 'Its free version contains ads and Premium removes them, per its store listings. Waves Free has no ads on money screens, only optional rewarded videos.',
      },
      {
        q: 'Can I import from Settle Up?',
        a: "There is no one-tap import. If it can export a CSV or spreadsheet, use Import inside a Waves group; otherwise start from today's balances.",
      },
      {
        q: 'Does Waves work offline like Settle Up?',
        a: 'Yes. Expenses are saved on the phone first and sync later.',
      },
      {
        q: 'Can people see balances without installing Waves?',
        a: 'Yes. A shared link or QR opens the group in a browser with no account, though guest access is limited in time.',
      },
    ],
    sources: [
      {
        label: 'Settle Up on the App Store (US)',
        url: 'https://apps.apple.com/us/app/settle-up-group-expenses/id737534985',
      },
      {
        label: 'Settle Up on the App Store (India)',
        url: 'https://apps.apple.com/in/app/settle-up-group-expenses/id737534985',
      },
      {
        label: 'Settle Up on Google Play',
        url: 'https://play.google.com/store/apps/details?id=cz.destil.settleup',
      },
    ],
  },
  {
    slug: 'splid',
    name: 'Splid',
    blurb:
      'Free, no sign-up, offline groups and 150+ currencies. Excel export is an in-app purchase.',
    seoTitle: 'Waves vs Splid: offline, currencies, export, price',
    seoDescription:
      'Waves and Splid compared: free features, Splid Plus price, offline groups, currencies, export and languages. See where Splid is the lighter choice.',
    summary: [
      'Splid is free to download, needs no sign-up and supports offline groups and 150+ currencies. Extras such as Excel export are in-app purchases.',
      'Waves goes further on capture, with receipt scanning and voice, and on settling, with UPI hand-off. Splid is lighter and simpler.',
    ],
    rows: [
      {
        feature: 'Price',
        waves: W.price,
        them: 'Free to download; Splid Plus $3.99 / ₹399 (iOS in-app purchase)',
      },
      { feature: 'Works offline', waves: true, them: 'Yes, offline groups or online sync' },
      {
        feature: 'Multi-currency',
        waves: W.currency,
        them: '150+ currencies with automatic conversion',
      },
      { feature: 'Receipt scanning', waves: W.receipts, them: NL },
      { feature: 'Voice entry', waves: W.voice, them: NL },
      { feature: 'UPI hand-off', waves: W.upi, them: NL },
      { feature: 'Data export', waves: W.export, them: 'PDF summaries; Excel via in-app purchase' },
      { feature: 'Sign-up', waves: W.signup, them: 'No sign-up required' },
      {
        feature: 'Languages',
        waves: W.languages,
        them: 'English, French, German, Italian and Spanish on iOS',
      },
      { feature: 'Platforms', waves: W.platforms, them: 'iOS and Android' },
    ],
    switchReasons: [
      {
        title: 'Scan and say it',
        body: 'Waves reads receipts and takes voice entry in four languages plus Hinglish. We did not find either listed for Splid.',
      },
      { title: 'Hand-off to UPI', body: 'Waves opens your UPI app with the amount filled in.' },
      {
        title: 'Indian languages',
        body: 'Hindi and Tamil are in the app, and Arabic is laid out right to left.',
      },
      {
        title: 'Excel-style export built in',
        body: 'CSV and PDF export are in Waves Free; Splid sells Excel export as an add-on.',
      },
    ],
    theyAreBetter: [
      {
        title: 'Account-free from the start',
        body: 'Splid needs no sign-up at all. Waves lets friends join by link, but guest access is time-limited.',
      },
      {
        title: 'Lightweight',
        body: 'If you only want a clean tally on a trip, Splid is a smaller thing to learn.',
      },
      {
        title: '150+ currencies with automatic conversion',
        body: 'Waves supports every ISO 4217 currency, but you set the rate you actually got.',
      },
    ],
    move: moveGeneric('Splid'),
    faq: [
      {
        q: 'Is Splid free?',
        a: 'It is free to download; Splid Plus and extras are in-app purchases, per its App Store listing.',
      },
      {
        q: 'Can I import from Splid?',
        a: "There is no one-tap import. If it can export a CSV or spreadsheet, use Import inside a Waves group; otherwise start from today's balances.",
      },
      {
        q: 'Does Waves need sign-up?',
        a: 'Friends can open a group by link without an account. The full app uses an account, and new accounts get 15 days of Pro free.',
      },
      { q: 'Does Waves work offline?', a: 'Yes. Every expense is saved on your phone first.' },
    ],
    sources: [
      { label: 'Splid website', url: 'https://splid.app/english' },
      {
        label: 'Splid on the App Store (US)',
        url: 'https://apps.apple.com/us/app/splid-split-group-bills/id991473495',
      },
      {
        label: 'Splid on the App Store (India)',
        url: 'https://apps.apple.com/in/app/splid-split-group-bills/id991473495',
      },
    ],
  },
  {
    slug: 'spliit',
    name: 'Spliit',
    blurb: 'Free, open source, no ads and no account. Anyone with the group link can edit.',
    seoTitle: 'Waves vs Spliit: open source vs full app, compared',
    seoDescription:
      'Waves and Spliit compared: price, ads, accounts, receipt scanning, privacy, export and languages. Spliit is free and open source; see what each is better at.',
    summary: [
      'Spliit is a free, open-source splitter with no ads and no account, available in 24 languages and with AI receipt scanning in beta.',
      'Waves adds offline-first sync, voice and UPI hand-off, with an optional paid Pro tier.',
    ],
    rows: [
      { feature: 'Price', waves: W.price, them: 'Free, open source' },
      { feature: 'Ads', waves: W.ads, them: 'No ads' },
      { feature: 'Account', waves: W.signup, them: 'No account needed' },
      {
        feature: 'Receipt scanning',
        waves: W.receipts,
        them: 'AI receipt scan (beta) on the web; on-device recognition in the iPhone app',
      },
      { feature: 'Voice entry', waves: W.voice, them: NL },
      { feature: 'UPI hand-off', waves: W.upi, them: NL },
      {
        feature: 'Data export',
        waves: W.export,
        them: 'CSV/JSON on the web, per the project roadmap',
      },
      {
        feature: 'Privacy',
        waves: W.privacy,
        them: 'Anyone with a group link can read and edit it; web receipt images are sent to OpenAI',
      },
      { feature: 'Languages', waves: W.languages, them: '24, translated by volunteers' },
    ],
    switchReasons: [
      {
        title: 'Offline-first sync',
        body: 'Waves saves each expense on the phone first and syncs it in order. We did not find offline entry listed for Spliit.',
      },
      {
        title: 'Voice and UPI',
        body: 'Say an expense in Hindi, Tamil, Arabic or English, then settle through your UPI app.',
      },
      {
        title: 'Edit history',
        body: 'Waves keeps a full edit history and comments on every expense, so nothing changes quietly.',
      },
    ],
    theyAreBetter: [
      { title: 'Open source', body: 'You can read, run and change Spliit yourself.' },
      {
        title: 'Free with nothing behind it',
        body: 'No ads, no accounts, no tiers. Waves has Pro for scanning, devices and voice limits.',
      },
      { title: '24 languages', body: 'Spliit lists 24 languages, far more than Waves.' },
    ],
    move: moveGeneric('Spliit'),
    faq: [
      {
        q: 'Is Spliit really free?',
        a: 'Yes, per its site: free, open source, no ads and no account.',
      },
      {
        q: 'Why choose Waves over an open-source option?',
        a: 'Choose Waves if you want offline-first entry, voice, receipt scanning on Free and Pro, and UPI hand-off. Choose Spliit if open source and zero accounts matter most.',
      },
      {
        q: 'Can I import from Spliit?',
        a: "There is no one-tap import. If it can export a CSV or spreadsheet, use Import inside a Waves group; otherwise start from today's balances.",
      },
      {
        q: 'Who sees my data on Waves?',
        a: 'Your shared ledger is on our server and is not end-to-end encrypted. We never sell data. See the privacy policy for detail.',
      },
    ],
    sources: [
      { label: 'Spliit website', url: 'https://spliit.app' },
      { label: 'Spliit privacy policy', url: 'https://spliit.app/privacy-policy' },
      {
        label: 'Spliit iOS repository roadmap',
        url: 'https://github.com/spliit-app/spliit-ios/blob/main/ROADMAP.md',
      },
    ],
  },
  {
    slug: 'kittysplit',
    name: 'Kittysplit',
    blurb:
      'Free for up to 9 people; Super Kitty is a one-time per-group payment for more people and currencies.',
    seoTitle: 'Waves vs Kittysplit: group size, currencies, price',
    seoDescription:
      'Waves and Kittysplit compared: group size limits, per-group pricing, currencies, receipts, export and languages. Plus where Kittysplit is the easier pick.',
    summary: [
      'Kittysplit is a web, iOS and Android splitter where nobody has to register. Free groups hold up to 9 people, and Super Kitty (₹299 once per group) lifts that to 100 and adds currencies.',
      'Waves has no group-size or currency limits on Free, and adds offline-first entry, receipt scanning and voice.',
    ],
    rows: [
      {
        feature: 'Price',
        waves: W.price,
        them: 'Free up to 9 people; Super Kitty ₹299 once per group',
      },
      {
        feature: 'Group size',
        waves: 'No limit on people',
        them: 'Up to 9 free; up to 100 with Super Kitty',
      },
      { feature: 'Multi-currency', waves: W.currency, them: 'Super Kitty only' },
      {
        feature: 'Receipt attachments',
        waves: W.receipts,
        them: 'Receipt and photo attachments on Super Kitty',
      },
      { feature: 'Voice entry', waves: W.voice, them: NL },
      { feature: 'UPI hand-off', waves: W.upi, them: NL },
      { feature: 'Data export', waves: W.export, them: 'XLSX' },
      { feature: 'Account', waves: W.signup, them: 'No account required, including to upgrade' },
      { feature: 'Languages', waves: W.languages, them: '8 on the website, none Indian' },
      { feature: 'Platforms', waves: W.platforms, them: 'Web, iOS and Android' },
    ],
    switchReasons: [
      {
        title: 'No people cap',
        body: 'A hostel or a wedding party is not a problem on Waves Free; Kittysplit asks for Super Kitty beyond 9 people.',
      },
      {
        title: 'Currencies on the free plan',
        body: 'Waves handles any currency and a rate you set. Kittysplit lists several currencies only on Super Kitty.',
      },
      {
        title: 'UPI and local languages',
        body: 'Waves opens a UPI app with the amount, and speaks Hindi and Tamil.',
      },
    ],
    theyAreBetter: [
      {
        title: 'Pay once, per group',
        body: 'Super Kitty is a single payment shared by everyone in the group, with no subscription.',
      },
      { title: 'Nobody registers', body: 'The whole flow works with no account, in a browser.' },
    ],
    move: moveGeneric('Kittysplit'),
    faq: [
      { q: 'How many people can be in a Waves group?', a: 'There is no people limit on Free.' },
      {
        q: 'Does Waves charge per group?',
        a: 'No. Waves Free has no per-group fee. Pro is a subscription for higher scan, voice and device limits.',
      },
      {
        q: 'Can I import from Kittysplit?',
        a: "There is no one-tap import. If it can export a CSV or spreadsheet, use Import inside a Waves group; otherwise start from today's balances.",
      },
      {
        q: 'Do people need an account to join?',
        a: 'A shared link opens a group in a browser with no account, although guest access is limited in time.',
      },
    ],
    sources: [
      { label: 'Kittysplit pricing', url: 'https://www.kittysplit.com/en/pricing' },
      { label: 'Kittysplit help', url: 'https://www.kittysplit.com/en/help' },
      { label: 'Kittysplit website', url: 'https://www.kittysplit.com/en' },
    ],
  },
  {
    slug: 'splitkaro',
    name: 'Splitkaro',
    blurb:
      'Bengaluru-built splitter with Splitwise import, UPI share and SMS tracking. English only.',
    seoTitle: 'Waves vs Splitkaro: Indian expense splitters compared',
    seoDescription:
      'Waves and Splitkaro compared: free receipt scans, Premium price, UPI import, export, languages and offline, with where Splitkaro does more for India.',
    summary: [
      'Splitkaro is an India-built splitter with Splitwise import, UPI share import and, as rolling out, automatic tracking from SMS. Its app is in English.',
      'Waves offers Hindi, Tamil and Arabic, voice entry in those languages, JSON, CSV and PDF export on Free, and more receipt scans on Free.',
    ],
    rows: [
      {
        feature: 'Price',
        waves: W.price,
        them: 'Free; Premium from ₹37.50/month equivalent, billed annually or quarterly',
      },
      {
        feature: 'Receipt scanning',
        waves: W.receipts,
        them: '3 scans a month Free; unlimited on Premium',
      },
      { feature: 'Voice entry', waves: W.voice, them: NL },
      {
        feature: 'UPI',
        waves: W.upi,
        them: 'Imports shared UPI payment details; unlimited on Premium (India)',
      },
      { feature: 'Data export', waves: W.export, them: 'PDF export is Premium' },
      { feature: 'Ads', waves: W.ads, them: 'Premium is ad-free' },
      {
        feature: 'Works offline',
        waves: true,
        them: 'Offline-added expenses sync, per its release notes',
      },
      { feature: 'Splitwise import', waves: 'Yes, from a Splitwise CSV export', them: 'Yes' },
      { feature: 'Languages', waves: W.languages, them: 'English only on iOS' },
      { feature: 'Platforms', waves: W.platforms, them: 'iOS and Android' },
    ],
    switchReasons: [
      {
        title: 'More free scans',
        body: 'Waves Free includes 20 receipt scans a month; Splitkaro Free lists 3.',
      },
      {
        title: 'Indian-language voice',
        body: 'Hold the mic and speak in Hindi, Tamil, English, Arabic or Hinglish.',
      },
      { title: 'Export on Free', body: 'JSON, CSV and PDF export are all in the free plan.' },
    ],
    theyAreBetter: [
      {
        title: 'Built around Indian payment habits',
        body: 'Splitkaro lists UPI share import, which adds expenses from UPI apps, and its release notes describe SMS-based tracking. Waves uses UPI for settling up.',
      },
      {
        title: 'Lower entry price',
        body: 'Premium starts around ₹37.50 a month on annual billing. Waves Pro is ₹79 a month or ₹699 a year.',
      },
    ],
    move: {
      title: 'Move from Splitkaro to Waves',
      steps: [
        'If your group came from Splitwise, import the original Splitwise CSV into Waves (Settings, Your data, Import from Splitwise).',
        "Otherwise create a group in Waves, add the same people and start from today's balances, or import a CSV or spreadsheet into the group if you have one.",
      ],
    },
    faq: [
      {
        q: 'Is Splitkaro free?',
        a: 'Yes, with optional Premium. Free lists 3 receipt scans a month, per its Premium FAQ.',
      },
      {
        q: 'Does Waves open UPI apps?',
        a: 'Yes. Waves works out who pays whom and opens your UPI app with the exact amount. It never holds or moves the money.',
      },
      {
        q: 'Does Waves support Hindi and Tamil?',
        a: 'Yes, in the app and for voice entry, along with Arabic and English.',
      },
      {
        q: 'Can I import from Splitkaro?',
        a: "No one-tap import. Use Import inside a Waves group if you have a CSV or spreadsheet; otherwise start from today's balances.",
      },
    ],
    sources: [
      { label: 'Splitkaro Premium FAQ', url: 'https://www.splitkaro.com/faq/premium' },
      { label: 'Splitkaro on the App Store', url: 'https://apps.apple.com/us/app/-/id1573115695' },
      { label: 'Splitkaro FAQ', url: 'https://www.splitkaro.com/faq' },
    ],
  },
  {
    slug: 'google-pay',
    name: 'Google Pay split',
    blurb:
      "Group expenses inside India's Google Pay app, settled to the bill creator's bank account.",
    seoTitle: 'Waves vs Google Pay split bills: what each does',
    seoDescription:
      'Waves vs Google Pay split bills in India: group tracking, UPI settle-up, currencies, history, export and languages, and what Google Pay does better.',
    summary: [
      'Google Pay in India lets members of a group chat track shared expenses and settle with one tap inside the payment app.',
      'Waves is a dedicated ledger: any currency, offline-first, receipt scanning, voice and export, handing the final payment to Google Pay or any UPI app.',
    ],
    rows: [
      {
        feature: 'What it is',
        waves: 'A dedicated expense-splitting app',
        them: 'A feature inside a payments app',
      },
      { feature: 'Price', waves: W.price, them: 'Free app; no split-specific fee listed' },
      {
        feature: 'Settling up',
        waves: W.upi,
        them: "Settles through Google Pay to the bill creator's linked bank account",
      },
      { feature: 'Multi-currency', waves: W.currency, them: NL },
      { feature: 'Works offline', waves: true, them: NL },
      { feature: 'Receipt scanning', waves: W.receipts, them: NL },
      { feature: 'Voice entry', waves: W.voice, them: NL },
      { feature: 'Data export', waves: W.export, them: NL },
      {
        feature: 'Languages',
        waves: W.languages,
        them: 'English plus 12 Indian languages including Hindi and Tamil, on iOS',
      },
      {
        feature: 'Privacy',
        waves: W.privacy,
        them: "Only the bill creator sees each person's payment status",
      },
    ],
    switchReasons: [
      {
        title: 'A ledger, not a one-off request',
        body: 'Waves keeps a running balance, edit history and comments per group, across trips and flats.',
      },
      {
        title: 'Any currency, offline',
        body: 'Record spend abroad or with no signal, set the rate, and settle later.',
      },
      {
        title: 'Use it with Google Pay',
        body: 'Waves does not replace Google Pay. It works out who pays whom, then opens your UPI app, Google Pay included, with the amount.',
      },
    ],
    theyAreBetter: [
      {
        title: 'Everything in one app',
        body: 'If everyone already uses Google Pay, tracking and paying in the same place is simpler.',
      },
      {
        title: 'Indian-language coverage',
        body: 'Google Pay lists 12 Indian languages; Waves has Hindi and Tamil.',
      },
      {
        title: 'Direct payments',
        body: 'Google Pay moves the money itself. Waves never holds or moves money.',
      },
    ],
    move: {
      title: 'Use Waves alongside Google Pay',
      steps: [
        'Create a group in Waves and add the same people.',
        'Add expenses as they happen, in any currency, even offline.',
        'When it is time to settle, tap the amount; Waves opens your UPI app with the exact amount and the payee filled in.',
      ],
    },
    faq: [
      {
        q: 'Does Waves replace Google Pay?',
        a: 'No. Waves tracks and splits; payments happen in your UPI app, Google Pay included.',
      },
      {
        q: 'Is Google Pay split still available?',
        a: 'Google India support pages document group expense tracking as of our check. Features and rules for UPI requests change, so check the app.',
      },
      {
        q: 'Do my friends need Waves?',
        a: 'They can open a group by link in a browser without an account, with time-limited guest access.',
      },
      {
        q: 'Can Waves settle with people outside India?',
        a: 'It can hand off to rails such as Venmo, PayPal, PayNow and PayID as well as UPI. Waves never holds the money.',
      },
    ],
    sources: [
      {
        label: 'Google Pay India: group expenses',
        url: 'https://support.google.com/pay/india/answer/12025420?hl=en-IN',
      },
      {
        label: 'Google Pay India: split a bill',
        url: 'https://support.google.com/pay/india/answer/11420982?hl=en-gb',
      },
      {
        label: 'Google Pay on the App Store (India)',
        url: 'https://apps.apple.com/in/app/google-pay-upi-cards-loans/id1193357041',
      },
    ],
  },
  {
    slug: 'phonepe',
    name: 'PhonePe split',
    blurb: 'Split Expense inside PhonePe, with groups or contacts you already have on the app.',
    seoTitle: 'Waves vs PhonePe Split Expense: compared',
    seoDescription:
      'Waves vs PhonePe Split Expense in India: running ledger, currencies, offline, receipts, voice, export and languages, and where PhonePe is more convenient.',
    summary: [
      'PhonePe Split Expense lets you split a payment with a group or contacts on PhonePe and notifies them what they owe.',
      'Waves keeps a full group ledger over time, in any currency and offline, then opens your UPI app, PhonePe included, to settle.',
    ],
    rows: [
      {
        feature: 'What it is',
        waves: 'A dedicated expense-splitting app',
        them: 'A feature inside a payments app',
      },
      { feature: 'Price', waves: W.price, them: 'Free app; no split-specific fee listed' },
      { feature: 'Who can take part', waves: W.signup, them: 'Groups or contacts on PhonePe' },
      { feature: 'Settling up', waves: W.upi, them: 'Settle through PhonePe' },
      { feature: 'Multi-currency', waves: W.currency, them: NL },
      { feature: 'Works offline', waves: true, them: NL },
      {
        feature: 'Receipt scanning',
        waves: W.receipts,
        them: 'Receipt sharing advertised; scanning not listed',
      },
      { feature: 'Voice entry', waves: W.voice, them: NL },
      { feature: 'Data export', waves: W.export, them: NL },
      {
        feature: 'Languages',
        waves: W.languages,
        them: 'English plus 10 Indian languages, including Hindi and Tamil, on iOS',
      },
    ],
    switchReasons: [
      {
        title: 'Not tied to one payments app',
        body: 'Anyone can take part by link; they do not need PhonePe, and pay with whichever UPI app they use.',
      },
      {
        title: 'A ledger over time',
        body: 'Running balances, edit history and comments, by group.',
      },
      { title: 'Travel-ready', body: 'Any currency, and works with no network.' },
    ],
    theyAreBetter: [
      {
        title: 'It is already there',
        body: 'If your group lives in PhonePe, splitting and paying in the same app is one fewer app.',
      },
      {
        title: 'More Indian languages',
        body: 'PhonePe lists 10 Indian languages; Waves has Hindi and Tamil.',
      },
    ],
    move: {
      title: 'Use Waves alongside PhonePe',
      steps: [
        'Create a group in Waves and add the same people.',
        'Add expenses as they happen.',
        'To settle, Waves opens your UPI app, PhonePe included, with the amount.',
      ],
    },
    faq: [
      {
        q: 'Does Waves replace PhonePe?',
        a: 'No. Waves tracks and splits; payments happen in your UPI app.',
      },
      {
        q: 'Do my friends need PhonePe?',
        a: 'Not for Waves. A shared link opens the group in a browser, with time-limited guest access.',
      },
      { q: 'Can I export my Waves data?', a: 'Yes, as JSON, CSV or PDF, free.' },
    ],
    sources: [
      {
        label: 'PhonePe Split Expense help',
        url: 'https://cms.phonepe.com/en/myhelp/money-transfers/spilt-expense/what-split-expense-phonepe/',
      },
      { label: 'PhonePe payments page', url: 'https://www.phonepe.com/payments/' },
      {
        label: 'PhonePe on the App Store (India)',
        url: 'https://apps.apple.com/in/app/phonepe-upi-payment-recharge/id1170055821',
      },
    ],
  },
  {
    slug: 'venmo',
    name: 'Venmo Groups',
    blurb: 'Groups inside the US payments app. Up to 30 members, Venmo account required.',
    seoTitle: 'Waves vs Venmo Groups: shared expenses compared',
    seoDescription:
      'Waves vs Venmo Groups: members, accounts, currencies, offline, receipt scanning, voice and export, with where Venmo is more convenient for US friends.',
    summary: [
      'Venmo Groups tracks ongoing shared expenses inside Venmo, with up to 30 members, and settles in the Venmo app.',
      'Waves works outside one payments network, in any currency and offline, and can hand off to Venmo as one of many ways to pay.',
    ],
    rows: [
      {
        feature: 'What it is',
        waves: 'A dedicated expense-splitting app',
        them: 'A feature inside a payments app',
      },
      { feature: 'Account', waves: W.signup, them: 'Venmo account required' },
      { feature: 'Group size', waves: 'No limit on people', them: 'Up to 30 members' },
      { feature: 'Settling up', waves: W.upi, them: 'Settle in Venmo' },
      { feature: 'Multi-currency', waves: W.currency, them: NL },
      { feature: 'Works offline', waves: true, them: NL },
      { feature: 'Receipt scanning', waves: W.receipts, them: NL },
      { feature: 'Voice entry', waves: W.voice, them: NL },
      { feature: 'Languages', waves: W.languages, them: 'English only on iOS' },
      { feature: 'Privacy', waves: W.privacy, them: 'Group activity is visible to group members' },
    ],
    switchReasons: [
      {
        title: 'Not tied to one network',
        body: 'Your friends can pay by Venmo, PayPal, a bank transfer or UPI; Waves hands the amount to the app they choose.',
      },
      {
        title: 'International groups',
        body: 'Any currency, any country. Venmo Groups is part of the Venmo app.',
      },
      {
        title: 'Offline and scanning',
        body: 'Save the bill without signal, scan receipts and speak expenses.',
      },
    ],
    theyAreBetter: [
      {
        title: 'Pay in the same app',
        body: 'If everyone has Venmo, tracking and paying in one place is the smoothest path.',
      },
      {
        title: 'No extra app',
        body: 'If everyone in the group already has Venmo, there is nothing new to install.',
      },
    ],
    move: {
      title: 'Use Waves alongside Venmo',
      steps: [
        'Create a group in Waves and add the same people.',
        'Add expenses as they happen.',
        'To settle, pick Venmo as the payment method in Waves and it opens Venmo with the amount.',
      ],
    },
    faq: [
      {
        q: 'Does Waves replace Venmo?',
        a: 'No. Waves tracks and splits; payments happen in Venmo or whichever app you pick.',
      },
      {
        q: 'Does Waves work in the US?',
        a: 'Yes, it supports USD and hands off to Venmo or PayPal. Waves never holds the money.',
      },
      {
        q: 'Do my friends need Waves?',
        a: 'They can open a group from a link in a browser with no account, with time-limited guest access.',
      },
    ],
    sources: [
      { label: 'Venmo: start sending and receiving', url: 'https://venmo.com/send-receive/start' },
      {
        label: 'Venmo help: group members',
        url: 'https://help.venmo.com/cs/articles/adding-or-removing-members-for-a-group-vhel153',
      },
      {
        label: 'Venmo Groups launch coverage (Nov 2023)',
        url: 'https://www.fox32chicago.com/news/venmo-groups-splitwise-alternative-bill-calculator',
      },
    ],
  },
  {
    slug: 'spreadsheets',
    name: 'Spreadsheets and WhatsApp notes',
    blurb: 'The manual way: Excel, Google Sheets or a note in a chat.',
    seoTitle: 'Waves vs spreadsheets and WhatsApp notes for splitting',
    seoDescription:
      'Splitting bills in Excel, Google Sheets or a WhatsApp note versus an app: what you build yourself, where it breaks, and when a sheet is still enough.',
    summary: [
      'A spreadsheet or a chat note costs nothing and fits any odd arrangement, but you write the maths, keep the history and chase the settlement yourself.',
      'Waves does the split arithmetic, keeps balances in every currency and hands the final payment to your payment app.',
    ],
    rows: [
      {
        feature: 'Who owes whom',
        waves: 'Calculated for you, with the fewest payments',
        them: 'Formulas you write and keep correct, or by hand',
      },
      {
        feature: 'Uneven splits',
        waves: 'Equal, exact, shares, percentage, itemised and by family',
        them: 'Anything you can build',
      },
      { feature: 'Several currencies', waves: W.currency, them: 'You convert and track the rate' },
      { feature: 'Receipts', waves: W.receipts, them: 'Paste or attach photos yourself' },
      { feature: 'Speaking an expense', waves: W.voice, them: 'Type it' },
      { feature: 'Settling up', waves: W.upi, them: 'Work out the amounts and pay separately' },
      {
        feature: 'History',
        waves: 'Edit history and comments on each expense',
        them: 'Whatever the tool keeps',
      },
      { feature: 'Cost', waves: W.price, them: 'Free tools you probably already have' },
    ],
    switchReasons: [
      {
        title: 'No formulas to break',
        body: 'Splits always add back to the bill, to the last paisa, and nobody edits a cell by accident.',
      },
      {
        title: 'One shared truth',
        body: 'Everyone sees the same balance. Changes are listed in Activity.',
      },
      {
        title: 'Capture in the moment',
        body: 'Scan, speak or type at the table, even with no signal.',
      },
    ],
    theyAreBetter: [
      {
        title: 'Total flexibility',
        body: 'A sheet can model any arrangement: shared rent with odd rules, a one-off event budget, anything.',
      },
      { title: 'Nothing to install', body: 'Everyone already has a chat app or a browser.' },
      {
        title: 'Good for a one-time tally',
        body: 'For one dinner among three friends, a note is plenty.',
      },
    ],
    move: {
      title: 'Move from a sheet or a chat to Waves',
      steps: [
        'Create a group in Waves and add the people.',
        'Add the expenses by hand, or tidy the sheet into columns (date, description, amount, currency, paid by, split between). In the group, choose Import and Waves gives you a template to match.',
        "Or start from today's balances, one expense per person.",
      ],
    },
    faq: [
      {
        q: 'When is a spreadsheet enough?',
        a: 'For a one-off tally among a few people. It struggles when expenses arrive over weeks, in several currencies, or when people edit the same file.',
      },
      {
        q: 'Can I import my spreadsheet into Waves?',
        a: 'Yes, if it is a CSV or spreadsheet. Open the group and choose Import: Waves gives you a template, reads the columns, and lets you match people and review every row before saving. Results depend on the file.',
      },
      { q: 'Is Waves free?', a: 'Yes, the core is free forever. Pro is optional.' },
      {
        q: 'Can I still export to a spreadsheet?',
        a: 'Yes. Waves exports JSON, CSV and PDF, free.',
      },
    ],
    sources: [{ label: 'Waves pricing and features', url: 'https://wavs.co.in/en' }],
  },
];

export const bySlug = (slug: string) => competitors.find((c) => c.slug === slug);

/** `/compare/waves-vs-splitwise` */
export const compareSlug = (c: Competitor) => `waves-vs-${c.slug}`;
export const comparePath = (c: Competitor) => `/en/compare/${compareSlug(c)}`;
