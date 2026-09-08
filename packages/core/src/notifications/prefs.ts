/**
 * What somebody agrees to be told about.
 *
 * Stored as one JSON blob on `profiles.notification_prefs` rather than as
 * columns, because the set of things worth being told about changes with the
 * product and a migration per switch would be a migration per idea (ADR-010,
 * TDR §7). Per-account, not per-group: granularity that fine was considered and
 * not built.
 *
 * It lives in `@waves/core` because three places were carrying it and they had
 * already drifted — `apps/mobile/src/data/api.ts` and
 * `packages/api-client/src/rows.ts` each declared their own copy, and the SQL
 * that actually obeys these keys read one (`email`) that appeared in neither.
 * A preference the server enforces and no client can set is a preference
 * nobody has; the way that happens is three lists nobody diffs.
 *
 * **The database is the enforcer, not this file.** The keys here are honoured
 * in `waves_claim_push_notifications` (via `waves_pref_key_for_kind`),
 * `waves_claim_email_notifications`, `waves_trip_nudges` and
 * `waves_enqueue_weekly_digest`. Adding a key here does nothing on its own —
 * it needs a reader in SQL, or it is another switch wired to a switch.
 */
export interface NotificationPrefs {
  /**
   * Push for things that involve me: an expense I am in, a balance that moved,
   * somebody claiming a place in a group I run. The default that stops the
   * noise.
   */
  involvesMe: boolean;
  /** The batched "what happened in this group" summary. */
  groupActivityDigest: boolean;
  /** Somebody says they paid me, or answered a payment I said I made. */
  settlementRequests: boolean;
  /** A reminder — sent by a person, or by a trip that is still running. */
  nudges: boolean;
  /**
   * The master switch on the email door.
   * `waves_claim_email_notifications` has read this key since M4 and suppressed
   * every mail when it is false; it was in no type and on no screen until the
   * switch was added, so the one thing it governed was unreachable.
   *
   * Two things beat it, both deliberately. A hard suppression — a bounce, a
   * complaint, an unsubscribe click — wins, because that is the mailbox
   * refusing rather than the person choosing. And `new_device_login` ignores it
   * by name: turning off ledger mail does not mean "stop telling me when my
   * account is opened somewhere".
   */
  email: boolean;
  /** Monday morning's summary of the week. The one switch that starts off. */
  weeklyEmail: boolean;
}

/**
 * What an account that has never touched the screen means.
 *
 * Every push switch is on and the email door is open, matching the
 * `COALESCE(..., TRUE)` the SQL applies to an absent key — so a profile written
 * before a switch existed reads as on, which is what it has been. `weeklyEmail`
 * is the exception and starts off: a summary nobody asked for arriving every
 * Monday is how a sender gets filtered.
 */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  involvesMe: true,
  groupActivityDigest: true,
  settlementRequests: true,
  nudges: true,
  email: true,
  weeklyEmail: false,
};
