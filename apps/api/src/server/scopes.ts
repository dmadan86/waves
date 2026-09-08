/**
 * What a token is allowed to be used for.
 *
 * The catalogue is duplicated in SQL (`waves_api_known_scopes`) rather than
 * imported from one place, and that is the right kind of duplication: the
 * database has to refuse an unknown scope at the moment a token is written,
 * because a scope list that only TypeScript validates is a scope list an
 * attacker can write directly. The pair is kept honest by a test, not by trust.
 *
 * Scopes only ever *narrow*. Every request still runs as the person the token
 * names, with their row-level security intact, so `expenses.write` does not
 * grant the ability to write an expense in a group they are not in — it grants
 * the ability to write one they could already have written from the app. A
 * scope is a promise the token holder made to the person, not a permission the
 * server granted the token.
 */

export const SCOPES = [
  'identity.read',
  'identity.write',
  'groups.read',
  'groups.write',
  'expenses.read',
  'expenses.write',
  'settlements.read',
  'settlements.write',
  'friends.read',
  'categories.read',
  'categories.write',
  'offline_access',
] as const;

export type Scope = (typeof SCOPES)[number];

/**
 * What each scope actually lets somebody do, in a sentence a person deciding
 * whether to approve an application can read. These are shown on the consent
 * screen, so they describe consequences rather than endpoints.
 */
export const SCOPE_SUMMARY: Record<Scope, string> = {
  // These are the sentences a person reads before approving, so each has to
  // cover everything the scope reaches. `identity.read` returns the payment
  // handle — somebody's UPI address — and saying "name, avatar and currency"
  // would be asking for consent to less than is given.
  'identity.read': 'See your name, avatar, country, language, default currency and payment handle.',
  'identity.write': 'Change your name, country, language and default currency.',
  'groups.read': 'See your groups, who is in them and what each person is owed.',
  'groups.write':
    'Create groups, change their settings, add and remove people, and archive or delete a group.',
  'expenses.read': 'See the expenses in your groups.',
  'expenses.write': 'Add, edit and delete expenses in your groups.',
  'settlements.read': 'See payments recorded between you and other people.',
  'settlements.write': 'Record and confirm payments on your behalf.',
  'friends.read': 'See who you owe and who owes you, across every group.',
  'categories.read': 'See your expense categories.',
  'categories.write': 'Add, change and hide your expense categories.',
  offline_access: 'Stay connected without asking you again.',
};

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

/**
 * Parse an OAuth `scope` parameter: space-separated, order-insensitive,
 * duplicates collapsed. An unknown entry fails the whole request rather than
 * being dropped — silently granting less than was asked for is how a client
 * ends up mysteriously unable to do the thing it thought it had permission for.
 */
export function parseScopes(raw: string | null | undefined): Scope[] | null {
  const parts = (raw ?? '').split(/[\s+]+/).filter(Boolean);
  if (parts.length === 0) return null;
  const seen = new Set<Scope>();
  for (const part of parts) {
    if (!isScope(part)) return null;
    seen.add(part);
  }
  return [...seen];
}

/** Every scope named is known, the list is not empty, nothing repeats. */
export function validScopeList(values: readonly unknown[]): values is Scope[] {
  if (values.length === 0 || values.length > SCOPES.length) return false;
  const seen = new Set<unknown>();
  for (const value of values) {
    if (typeof value !== 'string' || !isScope(value) || seen.has(value)) return false;
    seen.add(value);
  }
  return true;
}
