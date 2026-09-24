/**
 * Carrying a guest's groups across a switch to the account they already have.
 *
 * Opening a join link makes a guest account in this browser (ADR-006). If that
 * person then signs in with a Google or Apple login that already belongs to a
 * Waves account, Supabase refuses to attach it to the guest — one login, one
 * account — and the browser comes back with `identity_already_exists`. The
 * useful answer is to switch to the account they have and join the same groups
 * again as themselves, so this keeps two small lists in `localStorage`:
 *
 * - **guest joins**: the join tokens this browser's guest accepted, tagged
 *   with the guest's id so a list left by a different guest is never used;
 * - **after sign-in**: what to do once the next sign-in lands — join these
 *   groups again, or reopen a join link that was waiting on the sign-in.
 *
 * A join token is the key to a group, so nothing here leaves the browser, and
 * the lists are cleared as soon as they are used. Every read tolerates a
 * missing, blocked or corrupt store: the worst case is somebody re-opening the
 * invite link themselves.
 */

const GUEST_JOINS = 'waves.guestJoins';
const AFTER_SIGN_IN = 'waves.afterSignIn';

/** The slice of `Storage` this needs, so tests can hand in a map. */
export type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** What to do once the next sign-in has landed. */
export type AfterSignIn =
  /** Join these groups again, as the account just signed into. */
  | { kind: 'rejoin'; tokens: string[] }
  /** Go back to a join link that was waiting for somebody to sign in first. */
  | { kind: 'join'; token: string };

function browserStore(): KeyValue | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readJson(store: KeyValue | null, key: string): unknown {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function write(store: KeyValue | null, key: string, value: unknown): void {
  if (!store) return;
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the switch still works, it just cannot rejoin.
  }
}

function isTokenList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item !== '');
}

/** Note a join token this guest accepted. Deduplicated. */
export function rememberGuestJoin(
  guestId: string,
  token: string,
  store: KeyValue | null = browserStore(),
): void {
  const current = readJson(store, GUEST_JOINS) as { guestId?: unknown; tokens?: unknown } | null;
  const tokens = current?.guestId === guestId && isTokenList(current.tokens) ? current.tokens : [];
  if (tokens.includes(token)) return;
  write(store, GUEST_JOINS, { guestId, tokens: [...tokens, token] });
}

/** The join tokens this guest accepted; empty for any other guest. */
export function guestJoins(guestId: string, store: KeyValue | null = browserStore()): string[] {
  const current = readJson(store, GUEST_JOINS) as { guestId?: unknown; tokens?: unknown } | null;
  return current?.guestId === guestId && isTokenList(current.tokens) ? current.tokens : [];
}

/**
 * How long a queued action waits for its sign-in. The switch is one round trip
 * to Google or Apple; anything older is a switch somebody abandoned, and must
 * not be applied to whoever signs in on this browser next.
 */
export const QUEUE_TTL_MS = 30 * 60 * 1000;

/** How many times a group that would not rejoin is tried again. */
export const MAX_REJOIN_ATTEMPTS = 3;

/**
 * The guest has chosen to switch accounts: queue their groups to be joined
 * again after the sign-in, and forget the guest's list.
 */
export function queueRejoin(
  guestId: string,
  store: KeyValue | null = browserStore(),
  now: number = Date.now(),
): void {
  const tokens = guestJoins(guestId, store);
  write(
    store,
    AFTER_SIGN_IN,
    tokens.length > 0 ? { kind: 'rejoin', tokens, at: now, attempts: 0 } : null,
  );
  write(store, GUEST_JOINS, null);
}

/** Somebody on a join link chose to sign in first: bring them back to it. */
export function queueJoinAfterSignIn(
  token: string,
  store: KeyValue | null = browserStore(),
  now: number = Date.now(),
): void {
  write(store, AFTER_SIGN_IN, { kind: 'join', token, at: now });
}

/** Drop whatever is queued: the switch it was for did not happen. */
export function clearAfterSignIn(store: KeyValue | null = browserStore()): void {
  write(store, AFTER_SIGN_IN, null);
}

/** What was queued for this sign-in, removed as it is read. Stale queues are dropped. */
export function takeAfterSignIn(
  store: KeyValue | null = browserStore(),
  now: number = Date.now(),
): (AfterSignIn & { attempts: number }) | null {
  const value = readJson(store, AFTER_SIGN_IN) as {
    kind?: unknown;
    tokens?: unknown;
    token?: unknown;
    at?: unknown;
    attempts?: unknown;
  } | null;
  write(store, AFTER_SIGN_IN, null);
  if (typeof value?.at !== 'number' || now - value.at > QUEUE_TTL_MS || value.at > now) {
    return null;
  }
  const attempts = typeof value.attempts === 'number' ? value.attempts : 0;
  if (value.kind === 'rejoin' && isTokenList(value.tokens) && value.tokens.length > 0) {
    return { kind: 'rejoin', tokens: value.tokens, attempts };
  }
  if (value.kind === 'join' && typeof value.token === 'string' && value.token !== '') {
    return { kind: 'join', token: value.token, attempts };
  }
  return null;
}

/**
 * Put back the groups that would not rejoin, to be tried on the next load:
 * a dropped connection must not cost somebody their groups. Given up on after
 * `MAX_REJOIN_ATTEMPTS`, since a revoked or used-up invite will never take.
 */
export function requeueFailed(
  tokens: string[],
  attempts: number,
  store: KeyValue | null = browserStore(),
  now: number = Date.now(),
): void {
  if (tokens.length === 0 || attempts + 1 >= MAX_REJOIN_ATTEMPTS) return;
  write(store, AFTER_SIGN_IN, { kind: 'rejoin', tokens, at: now, attempts: attempts + 1 });
}

/**
 * Join each queued group again as the signed-in account.
 *
 * One refused token (an invite since revoked, a group since deleted) does not
 * stop the rest. Returns where to go (the first group that took, else home)
 * and the tokens that failed, so they can be tried again.
 */
export async function rejoin(
  tokens: string[],
  accept: (token: string) => Promise<{ group: { id: string }; pending?: boolean }>,
  onError: (caught: unknown) => void = () => {},
): Promise<{ to: string; failed: string[] }> {
  let first: string | null = null;
  const failed: string[] = [];
  for (const token of tokens) {
    try {
      const accepted = await accept(token);
      if (!first && !accepted.pending) first = `/g/${accepted.group.id}`;
    } catch (caught) {
      failed.push(token);
      onError(caught);
    }
  }
  return { to: first ?? '/', failed };
}

const PROVIDER = 'waves.oauthProvider';

/** Which provider the redirect about to happen is for, so the answer can name it. */
export function rememberProvider(
  provider: 'google' | 'apple',
  store: KeyValue | null = browserStore(),
): void {
  write(store, PROVIDER, provider);
}

/** The provider of the last redirect sign-in; Google when unknown. */
export function lastProvider(store: KeyValue | null = browserStore()): 'google' | 'apple' {
  return readJson(store, PROVIDER) === 'apple' ? 'apple' : 'google';
}
