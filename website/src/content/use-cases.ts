/**
 * Use-case landing pages (English only, like /compare). Every claim here maps
 * to something the app or the privacy policy really does; nothing is a
 * statistic, a testimonial or a rating.
 */
export type UseCase = {
  slug: string;
  title: string; // <title>, kept near 60 characters
  description: string;
  eyebrow: string;
  h1: string;
  intro: string;
  steps: { title: string; body: string }[];
  points: { title: string; body: string }[];
  faq: { q: string; a: string }[];
};

export const useCases: UseCase[] = [
  {
    slug: 'split-bills-with-roommates',
    title: 'Split bills with roommates, free and unlimited | Waves',
    description:
      'Split rent, groceries, wifi and utilities with roommates. Unlimited people and expenses on Free, works offline, settle up with UPI or any payment app.',
    eyebrow: 'Roommates and flatmates',
    h1: 'Split bills with roommates without the awkward asking',
    intro:
      'One group for the flat. Everyone adds what they paid, Waves keeps a running balance, and at the end of the month it tells each person who pays whom.',
    steps: [
      {
        title: 'Make a group for the flat',
        body: 'Share a link or QR code. Roommates join in a browser or the app, with a free account made in a minute with Google, Apple or email.',
      },
      {
        title: 'Add bills as they happen',
        body: 'Type an expense, scan the receipt or say it out loud. Adding works with no signal and syncs when you reconnect.',
      },
      {
        title: 'Settle up when you like',
        body: 'Waves calculates simplified suggested payments, then hands the amount to your payment app. Settling up is unlimited and never has ads.',
      },
    ],
    points: [
      {
        title: 'Uneven shares are fine',
        body: 'Split equally, by exact amounts, shares, percentages, itemised or by family, so the person with the bigger room or the vegetarian can pay their fair part.',
      },
      {
        title: 'No limit on people or expenses',
        body: 'People, expenses, currencies and splits are unlimited on the Free plan, so a flat of six is not a paid feature.',
      },
      {
        title: 'Everyone sees the same numbers',
        body: 'Each expense keeps its edit history and comments, so a disputed bill has an answer instead of an argument.',
      },
    ],
    faq: [
      {
        q: 'Does every roommate need to install Waves?',
        a: 'No. They can join from a link or QR code and see the group in a browser. Joining needs a free account.',
      },
      {
        q: 'Is it free for a whole flat?',
        a: 'Yes. People, expenses, splits and settling up are unlimited on Free. Free is ad-supported, with banner ads on some screens, never on the settle-up screen.',
      },
      {
        q: 'Does Waves collect the rent from my roommates?',
        a: 'No. Waves never holds money. It works out who owes whom and hands the amount to your payment app.',
      },
    ],
  },
  {
    slug: 'trip-expense-splitter',
    title: 'Trip expense splitter for groups, any currency | Waves',
    description:
      'Split trip costs with friends in any currency. Fix the exchange rate you actually got, add expenses offline, and settle up at the end. Free and unlimited.',
    eyebrow: 'Trips and holidays',
    h1: 'A trip expense splitter that works abroad',
    intro:
      'Flights, stays, dinners and cab rides across a few currencies and patchy signal. Waves records each cost on your phone first, so the trip carries on even when the network does not.',
    steps: [
      {
        title: 'Start a group for the trip',
        body: 'Invite everyone by link or QR code, including people who will not install anything.',
      },
      {
        title: 'Log costs wherever you are',
        body: 'Every amount is stored in the currency it was spent in. Add expenses offline and they sync when you are back on a network.',
      },
      {
        title: 'Settle once, at the end',
        body: 'Waves simplifies the balances into suggested payments, then hands each one to a payment app: UPI, bank transfer, Venmo, PayPal, PayNow, Pix, SEPA or cash.',
      },
    ],
    points: [
      {
        title: 'Real exchange rates',
        body: 'Fix the rate you actually got for one bill, for one person or for the whole trip. Every ISO 4217 currency is supported.',
      },
      {
        title: 'Scan or speak it',
        body: 'Scan a receipt or add an expense by voice. On Free these cost credits you earn by watching a short ad; Pro includes a monthly allowance.',
      },
      {
        title: 'Fair splits for real groups',
        body: 'Not everyone ate the same. Split by exact amount, shares, percentage or itemised, or by family when one household travels together.',
      },
    ],
    faq: [
      {
        q: 'Can I split a trip in more than one currency?',
        a: 'Yes. Amounts are stored in the currency they were spent in as whole minor units, and you can set the exchange rate for one bill, one person or the whole trip.',
      },
      {
        q: 'Does it work without internet?',
        a: 'Adding, editing and splitting keep working offline. Waves syncs in the background when you reconnect.',
      },
      {
        q: 'Which languages does the app support?',
        a: 'English, Hindi, Tamil and Arabic, with Arabic laid out right to left.',
      },
    ],
  },
  {
    slug: 'split-rent-india',
    title: 'Split rent in India with UPI settle-up | Waves',
    description:
      'Split rent, electricity, wifi and groceries with flatmates in India. Free group expense tracker in Hindi and Tamil, with UPI settle-up and no daily limits.',
    eyebrow: 'Flatmates in India',
    h1: 'Split rent in India and settle up with UPI',
    intro:
      'Rent, maid, electricity, wifi, gas cylinder, groceries. Put it all in one group, see who is owed what, and hand the final amount to the UPI app you already use.',
    steps: [
      {
        title: 'Add each shared cost',
        body: 'Type it, scan the bill or say it. Choose who paid and how it splits. Amounts are in rupees, and other currencies are supported if you need them.',
      },
      {
        title: 'Watch the balances',
        body: 'Waves keeps a live balance for every flatmate and simplifies it into the fewest payments.',
      },
      {
        title: 'Pay through UPI',
        body: 'Waves hands the amount to your UPI app. The payment happens between you and that app; Waves is not a bank and never holds your money.',
      },
    ],
    points: [
      {
        title: 'In your language',
        body: 'The app speaks English, Hindi and Tamil, so the whole flat can follow the numbers.',
      },
      {
        title: 'Free with no daily cap',
        body: 'Unlimited people, expenses and settling up on the Free plan. Pro is Rs 79 a month or Rs 699 a year if you want no ads.',
      },
      {
        title: 'Your data is not for sale',
        body: 'We never sell your data and there are no tracking pixels on this site or in the ledger. The privacy policy spells out every provider we use.',
      },
    ],
    faq: [
      {
        q: 'Does Waves collect rent through UPI?',
        a: 'No. It works out who pays whom and opens your payment app with the amount. The transfer is between you and your bank or UPI app.',
      },
      {
        q: 'Can I move my group over from Splitwise?',
        a: 'Yes. See the Splitwise alternative page for how the import works.',
      },
      {
        q: 'Is Waves free in India?',
        a: 'Yes. The Free plan never expires. Pro is Rs 79 a month or Rs 699 a year; new accounts get 15 days of Pro free with no card.',
      },
    ],
  },
  {
    slug: 'split-expenses-with-friends',
    title: 'Split expenses with friends: free group tracker | Waves',
    description:
      'Split expenses with friends and keep a group expense tracker everyone can see. Unlimited people and expenses on Free, offline entry, any currency, any payment app.',
    eyebrow: 'Friends and groups',
    h1: 'Split expenses with friends and keep everyone square',
    intro:
      'Dinners, weekends away, a shared gift. Put it in one group, let everyone add what they paid, and Waves keeps the running balance so nobody has to remember who covered what.',
    steps: [
      {
        title: 'Start a group and invite friends',
        body: 'Share a link or QR code. Friends join in a browser or the app with a free account.',
      },
      {
        title: 'Add what you paid',
        body: 'Type it, scan the receipt or say it. Choose who shared it and how it splits.',
      },
      {
        title: 'Settle up when it suits you',
        body: 'Waves suggests the fewest payments, then hands the amount to your payment app. Waves never holds your money.',
      },
    ],
    points: [
      {
        title: 'Unlimited on Free',
        body: 'People, expenses, currencies and splits are unlimited on the Free plan.',
      },
      {
        title: 'Splits that match real life',
        body: 'Equally, by exact amounts, shares, percentages or itemised, so a friend who skipped the starter does not pay for it.',
      },
      {
        title: 'Works with no signal',
        body: 'Expenses are saved on your phone first and sync when you are back online.',
      },
    ],
    faq: [
      {
        q: 'Is there a free app to split expenses with friends?',
        a: 'Yes. Waves is free to start, with no limit on people, expenses or currencies. Free is ad-supported; Pro removes ads.',
      },
      {
        q: 'Do my friends need to install Waves?',
        a: 'They can open the invite link in a browser. Joining needs a free account.',
      },
      {
        q: 'Can I move a group over from Splitwise?',
        a: 'Yes. Export the group as CSV from Splitwise and use Import from Splitwise under Settings, Your data.',
      },
    ],
  },
  {
    slug: 'couple-expense-tracker',
    title: 'Couple expense tracker: share bills and budgets | Waves',
    description:
      'A couple expense tracker for two: add shared bills, see who paid what and keep it fair. Free with no limit on expenses, works offline, private to the two of you.',
    eyebrow: 'Couples',
    h1: 'A couple expense tracker for sharing money without keeping score',
    intro:
      'Rent, groceries, trips, the gift for your parents. Make a group for the two of you, add costs as they happen, and see the balance whenever you want it.',
    steps: [
      {
        title: 'Make a couple group',
        body: 'Pick Couple when you create the group and invite your partner by link.',
      },
      {
        title: 'Add costs as they happen',
        body: 'Type, scan or speak each expense. Choose who paid and how it is shared.',
      },
      {
        title: 'Check in or settle',
        body: 'See who is ahead, and settle with any payment app when you like.',
      },
    ],
    points: [
      {
        title: 'Unlimited and free',
        body: 'People, expenses and currencies are unlimited on the Free plan.',
      },
      {
        title: 'Any split you agree on',
        body: 'Equally, by percentage or by exact amounts, chosen per expense.',
      },
      {
        title: 'Your own money stays yours',
        body: 'Personal spending, budgets and loans live in a separate area that other people in your groups cannot see.',
      },
    ],
    faq: [
      {
        q: 'Is Waves a good household budget app for two?',
        a: 'Waves tracks shared costs between you and keeps your own spending and budgets separately. It is not a bank and has no bank feed.',
      },
      {
        q: 'Does my partner need an account?',
        a: 'Yes, a free one, made with Google, Apple or email. They can join from your invite link.',
      },
      {
        q: 'Is it free?',
        a: 'Yes. The Free plan never expires and has no limit on expenses. Free is ad-supported; Pro removes ads.',
      },
    ],
  },
];

export const findUseCase = (slug: string) => useCases.find((u) => u.slug === slug);
