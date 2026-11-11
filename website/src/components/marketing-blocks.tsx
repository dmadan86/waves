/*
 * Trust and referral copy for the English-only marketing pages. Each line is
 * taken from the live privacy policy or the referral rules in
 * packages/db (migration 20261115090000_referral_credits); change them together.
 */
import Link from 'next/link';

const trust = [
  [
    'Never sold',
    'We do not sell your data or share it with data brokers, and your expenses, groups and balances never go to advertisers.',
  ],
  [
    'Encrypted on your phone',
    'The copy on your phone is encrypted at rest, with a key kept in the device keystore.',
  ],
  [
    'Locked down on the server',
    'The shared ledger sits in a managed Postgres database with row-level security, so a request only reaches groups you are in. It is not end-to-end encrypted, and the policy says so.',
  ],
  [
    'No money held',
    'Waves works out who pays whom and hands it to your payment app. It is not a bank.',
  ],
  ['You can leave', 'Delete your account from inside the app or from the delete-account page.'],
];

export function TrustList() {
  return (
    <section aria-labelledby="trust-h" className="mt-10">
      <h2 id="trust-h" className="text-[1.25rem] font-semibold tracking-[-0.02em] text-ink">
        Privacy at a glance
      </h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {trust.map(([title, body]) => (
          <li key={title} className="rounded-xl bg-surface px-4 py-3 shadow-[var(--w-shadow-sm)]">
            <h3 className="text-[0.95rem] font-semibold text-ink">{title}</h3>
            <p className="mt-1 text-[0.9rem] leading-[1.6] text-ink-2">{body}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[0.85rem] text-ink-2">
        Read the full{' '}
        <Link href="/en/privacy" className="text-blue underline">
          privacy policy
        </Link>
        .
      </p>
    </section>
  );
}

export function ReferralNote() {
  return (
    <p className="mt-6 rounded-sm bg-blue/5 px-4 py-3 text-[0.85rem] leading-relaxed text-ink-2">
      Invite a friend from Settings. When they join as a new user and add their first expense in a
      group of two or more people, you both get 50 credits. You can be paid for up to 10 friends.
    </p>
  );
}
