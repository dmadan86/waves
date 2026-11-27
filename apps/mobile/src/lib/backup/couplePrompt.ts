/** Sign-out guard for shared rentals: they live only on the partners' phones, so a backup is the one copy that outlasts this one. */

const RECENT_MS = 7 * 24 * 3_600_000;

export function shouldPromptCoupleBackup(input: {
  coupleRecords: number;
  /** Epoch ms of the last successful backup, or null for never. */
  lastBackupAt: number | null;
  /** Pending encrypted changes not yet delivered to every device. */
  outboxCount?: number;
  /** Latest local record edit time derived from the stored HLCs. */
  lastLocalChangeAt?: number | null;
  now: number;
}): boolean {
  if (input.coupleRecords === 0) return false;
  if ((input.outboxCount ?? 0) > 0) return true;
  if (input.lastBackupAt !== null && (input.lastLocalChangeAt ?? 0) > input.lastBackupAt)
    return true;
  return input.lastBackupAt === null || input.now - input.lastBackupAt > RECENT_MS;
}
