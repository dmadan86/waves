/**
 * Whether the dashboard should remind somebody, today, to back up.
 *
 * The personal ledger lives on the phone and in the person's own Drive, never
 * on Waves' servers, so a phone that is lost before a backup takes everything
 * since the last one with it. Automatic backup is off by default, and the only
 * other way to it is ••• on Home, then Backup. So once a day, when there is
 * something a backup would actually save, the app asks.
 *
 * At most once a day: "Back up now" and "Not now" both answer today's question,
 * and the reminder is back tomorrow if the answer was "not now" and nothing has
 * been backed up since. A backup inside the last day — by hand or by the
 * automatic schedule — means there is nothing to remind about.
 */

/** A day, for "backed up recently enough that there is nothing to say". */
export const REMINDER_FRESH_MS = 24 * 60 * 60 * 1000;

export interface BackupReminderInput {
  readonly signedIn: boolean;
  /** Guests cannot back up — their records live under a throwaway identity. */
  readonly isGuest: boolean;
  /** False in a build with no Drive client id: there is nowhere to back up to. */
  readonly configured: boolean;
  /** Personal records on this phone. None means nothing for a backup to save. */
  readonly recordCount: number;
  /** When the last backup landed (epoch ms), or null if there has never been one. */
  readonly lastBackupAt: number | null;
  /** The local day the reminder was last answered on, or null. */
  readonly answeredOn: string | null;
  /** Today, as `localDay()` spells it. */
  readonly today: string;
  /** Now, epoch ms. */
  readonly now: number;
  /**
   * Every input above has been read for real: the stored answers for this
   * account, and the ledger past its first sync. Until then the answer is no.
   */
  readonly settled: boolean;
}

export function wantsBackupReminder(input: BackupReminderInput): boolean {
  if (!input.settled || !input.signedIn || input.isGuest || !input.configured) return false;
  if (input.recordCount <= 0) return false;
  if (input.answeredOn === input.today) return false;
  if (input.lastBackupAt !== null && input.now - input.lastBackupAt < REMINDER_FRESH_MS) {
    return false;
  }
  return true;
}
