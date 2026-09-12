/**
 * What the end of a session is allowed to destroy.
 *
 * ## The bug this module exists for
 *
 * The wipe used to run on one condition: the session became null. That is not
 * the same event as somebody signing out, and the gap between the two is a
 * data-loss bug.
 *
 * `supabase-js` removes the stored session — and emits the same `SIGNED_OUT`,
 * with the same null session, that a deliberate sign-out emits — in five
 * places, only one of which is a person asking to leave (`GoTrueClient`):
 * `_signOut` (the deliberate one), `_callRefreshToken` when the refresh token
 * is rejected and the access token has already expired, `__loadSession` and
 * `_recoverAndRefresh` when the stored session does not validate, and
 * `getUser` when the JWT names a session the server no longer has. A revoked
 * token, a refresh expired past recovery, an account signed out from another
 * device, a server that has moved — every one of them arrived at the wipe, and
 * the wipe deletes `pending_mutations`. So an expense entered in a dead zone,
 * which by definition has reached nobody, was destroyed without anybody being
 * asked, along with every draft, and then the key that could have opened them.
 *
 * That defeats the rest of the queue's design, which is careful about exactly
 * this: client-generated ids so a replay is idempotent, dead-lettering rather
 * than dropping, quarantine rather than deletion for a row that will not open,
 * and the rule written into the engine after a refused `group.create` took the
 * group with it — *a refusal is not a deletion*. A session ending is not one
 * either.
 *
 * ## The line this draws
 *
 * The device keeps what only it has, and destroys what the server can give
 * back. Concretely, an involuntary loss drops the mirror and the cursors — a
 * readable copy of a ledger that is safe on the server, so keeping it buys
 * nothing and costs privacy — and keeps the mutation queue, the drafts and the
 * receipt bytes, which exist nowhere else in the world.
 *
 * A deliberate sign-out is untouched: it still destroys everything, key
 * included. That is a security promise (the next person to hold this phone
 * must find nothing), a person who taps sign-out is warned about exactly this
 * loss by `SignOutSheet` and offered two ways to keep it, and account deletion
 * comes through the same door.
 *
 * ## The key, and what keeping it costs
 *
 * Keeping the queue is worthless if the key that opens it is destroyed, so an
 * involuntary loss keeps the key too. That is the real trade, and it is worth
 * stating plainly rather than burying: after an involuntary loss this device
 * holds, readable, the expenses and drafts that were never sent — for one
 * account, for a bounded window — where before it held nothing. What it does
 * *not* hold is the ledger: that goes with the mirror, immediately, on every
 * path. The crypto-erase is not weakened where it was doing its job; it is
 * simply no longer triggered by an event that is not a departure.
 *
 * Three things bound the exposure, and all three are decided here:
 *
 * 1. **It is stamped with an owner.** Retained work belongs to the account that
 *    made it. Somebody else signing in on this phone destroys it before their
 *    session starts — a queue replayed into another account would write one
 *    person's spending into another person's groups, which is worse than
 *    losing it.
 * 2. **It is stamped with a time.** Past {@link RETENTION_WINDOW_MS} it is a
 *    liability rather than a rescue, and the next launch destroys it whether
 *    anybody signs in or not.
 * 3. **An unreadable stamp is not a claim.** No marker, or one that will not
 *    parse, means nothing here is attributable, and unattributable data is
 *    discarded rather than adopted.
 *
 * Pure, and tested without a device, for the reason `lib/backup/restorePrompt`
 * is: every branch below is a sentence about whether somebody's records still
 * exist, and there is no version of getting one wrong that is cosmetic.
 */

/** How a session stopped being a session. */
export enum SessionEnd {
  /**
   * Somebody chose to leave: the sign-out sheet, or the last step of deleting
   * the account (which signs out through the same call).
   */
  SignedOut = 'signed-out',
  /**
   * Nobody asked. A refresh token revoked or expired past recovery, a stored
   * session that no longer validates, a server that has moved. The person is
   * still whoever they were a second ago, and is about to be shown a door they
   * did not choose to walk through.
   */
  Lost = 'lost',
}

/**
 * The account's data on this device, in the five groups that have different
 * rights. True means "this session ending destroys it".
 */
export interface LocalDataScope {
  /** `mirror_rows` and `sync_cursors` — the server's ledger, copied here. */
  readonly mirror: boolean;
  /**
   * `pending_mutations`, `drafts` and the parked receipt bytes: work that has
   * reached nobody, and that nothing else in the world holds a copy of.
   */
  readonly unsent: boolean;
  /** This account's cloud-backup grant and its recovery key. */
  readonly credentials: boolean;
  /** Downloaded images. Derived, re-fetchable, never the only copy. */
  readonly cache: boolean;
  /**
   * The mirror's data-encryption key — the crypto-erase. Destroying it is what
   * makes ciphertext still sitting in the WAL or the free list unrecoverable.
   */
  readonly key: boolean;
}

/**
 * What this ending may destroy.
 *
 * The key follows `unsent` exactly, and must: destroying the key while keeping
 * the queue leaves a queue nobody can read, and keeping the key while
 * destroying the queue leaves a crypto-erase that erased nothing.
 */
export function destroyedBy(reason: SessionEnd): LocalDataScope {
  switch (reason) {
    case SessionEnd.SignedOut:
      return { mirror: true, unsent: true, credentials: true, cache: true, key: true };
    case SessionEnd.Lost:
      // The ledger and the cache go on this path too — they are the server's
      // to hand back, and holding a readable ledger on a phone nobody is signed
      // into is the thing the wipe was always for.
      return { mirror: true, unsent: false, credentials: false, cache: true, key: false };
  }
}

/** Unsent work held for an account that is no longer signed in. */
export interface RetainedWork {
  /** Whose it is. The queue may only ever be drained back into this account. */
  readonly ownerId: string;
  /** When the session was lost, ISO-8601. */
  readonly retainedAt: string;
}

/**
 * How long unsent work may wait for its owner to come back.
 *
 * Thirty days covers a trip, a replaced SIM, a forgotten password and a support
 * round trip — every ordinary reason somebody does not sign in again today. It
 * is also short enough that a phone which has genuinely moved on is not still
 * holding a stranger's expenses a year later. There is no right number; there
 * is only the requirement that one exist, because "until the disk fills" is not
 * a retention policy.
 */
export const RETENTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** What to do with retained work when somebody signs in. */
export enum Retention {
  /** Nothing is being held. The overwhelmingly common answer. */
  Nothing = 'nothing',
  /** The same account, inside the window: hydrate it and let the queue drain. */
  Adopt = 'adopt',
  /** Somebody else, or too long ago: destroy it before this session starts. */
  Discard = 'discard',
}

/**
 * Has retained work outlived the window?
 *
 * A stamp that will not parse counts as expired: an unreadable date is not a
 * claim on the disk. A stamp in the *future* does not — a phone whose clock has
 * been wrong, or moved across a timezone by a careless OS, is not a reason to
 * destroy somebody's unsent expenses, and the window will catch it soon enough
 * once the clock is right.
 */
export function retentionExpired(retained: RetainedWork, now: number): boolean {
  const at = Date.parse(retained.retainedAt);
  if (Number.isNaN(at)) return true;
  return now - at >= RETENTION_WINDOW_MS;
}

/**
 * Whether the account now signing in may have what the last session left here.
 *
 * The owner check is the one that must never be got wrong. A queue carries
 * expenses addressed to groups, written as the account that made them; draining
 * it under a different session would post one person's spending into whatever
 * that session can reach. So the answer is identity, not similarity, and
 * anything that is not a plain match of the stored owner id is a discard.
 */
export function retentionVerdict(
  retained: RetainedWork | null,
  signingInAs: string,
  now: number,
): Retention {
  if (!retained) return Retention.Nothing;
  if (!retained.ownerId || retained.ownerId !== signingInAs) return Retention.Discard;
  if (retentionExpired(retained, now)) return Retention.Discard;
  return Retention.Adopt;
}

// ── which ending this was ───────────────────────────────────────────────────

/**
 * The one bit the auth layer knows and the sync layer cannot infer.
 *
 * Everything downstream of `onAuthStateChange` sees the same thing for all five
 * ways a session can end — `SIGNED_OUT`, session null — so the intent has to be
 * recorded at the only place it exists: the call that asks for it.
 * `lib/auth`'s `signOut` marks it immediately before `backend.auth.signOut()`,
 * and `SyncProvider` consumes it when the session goes.
 *
 * Two guards, because the failure mode of a stale mark is the bug this whole
 * module is about, in reverse — an involuntary loss misread as a departure, and
 * the wipe running anyway:
 *
 * * It is consumed. One mark answers one ending.
 * * It goes stale. A sign-out that threw before the session actually ended
 *   would otherwise leave the mark armed indefinitely, and the next revoked
 *   token minutes later would spend it. A real sign-out is a local storage
 *   write that happens in the same breath as the mark.
 *
 * `SyncProvider` also clears it whenever a session is established, so a mark
 * that outlived its call cannot survive a sign-in either.
 */
const DELIBERATE_WINDOW_MS = 60_000;

let deliberateAt: number | null = null;

/** Record that the sign-out about to happen is one somebody asked for. */
export function markDeliberateSignOut(now: number = Date.now()): void {
  deliberateAt = now;
}

/** Forget any unspent mark. Called when a session starts. */
export function forgetSignOutMark(): void {
  deliberateAt = null;
}

/** Why the session that just ended ended, consuming the mark. */
export function takeSessionEnd(now: number = Date.now()): SessionEnd {
  const marked = deliberateAt;
  deliberateAt = null;
  if (marked === null) return SessionEnd.Lost;
  return now - marked <= DELIBERATE_WINDOW_MS ? SessionEnd.SignedOut : SessionEnd.Lost;
}
